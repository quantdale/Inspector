export interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: RpcError;
}

export type RpcInbound = RpcRequest | RpcNotification;
export type RpcOutbound = RpcResponse | RpcNotification;

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

/** Classification of a transport-level protocol violation. */
export type LineProtocolErrorKind =
  | "invalid-message"
  | "line-overflow"
  | "invalid-trailing"
  | "write-failed";

/** Typed error for framing-level problems (garbage, overflow, write failure). */
export class LineProtocolError extends Error {
  readonly kind: LineProtocolErrorKind;

  constructor(kind: LineProtocolErrorKind, message: string) {
    super(message);
    this.name = "LineProtocolError";
    this.kind = kind;
  }
}

export interface LineChannelOptions {
  /** Maximum bytes buffered for a single line before it is discarded. */
  maxLineBytes?: number;
}

/** Default cap: large enough for big uiTree observations, small enough to
 * bound memory against runaway or hostile peers. */
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Line-delimited JSON-RPC 2.0 transport over a readable/writable stream pair.
 * Each message is a single JSON object terminated by a newline.
 *
 * Hardening guarantees:
 *  - only plain-object payloads reach the message handler (primitives, arrays
 *    and other garbage are dropped and reported via onError);
 *  - the line buffer is bounded; oversized lines are discarded with a typed
 *    error and framing resumes at the next newline;
 *  - the TextDecoder is flushed at end of stream and a trailing unterminated
 *    message is delivered if parsable, surfaced otherwise;
 *  - send() reports failure via its boolean return value instead of swallowing
 *    write errors.
 */
export class LineChannel {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly maxLineBytes: number;
  private messageHandler: ((msg: RpcInbound) => void) | null = null;
  private errorHandler: ((err: LineProtocolError) => void) | null = null;
  private closed = false;
  private ended = false;
  /** True while we are discarding an oversized line up to its newline. */
  private discarding = false;

  constructor(
    private readonly readable: NodeJS.ReadableStream,
    private readonly writable: NodeJS.WritableStream,
    options: LineChannelOptions = {},
  ) {
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.readable.on("data", (chunk: Buffer) => this.onData(chunk));
    this.readable.on("close", () => this.onEnd());
    this.readable.on("end", () => this.onEnd());
    this.readable.on("error", () => {
      this.closed = true;
      this.onEnd();
    });
  }

  onMessage(handler: (msg: RpcInbound) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (err: LineProtocolError) => void): void {
    this.errorHandler = handler;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    try {
      if (typeof (this.writable as { end?: () => void }).end === "function") {
        (this.writable as { end: () => void }).end();
      }
    } catch {
      /* noop */
    }
  }

  /** Returns false when the channel is closed or the write failed. A false
   * from backpressure still counts as accepted (the chunk is queued). */
  send(msg: RpcOutbound): boolean {
    if (this.closed) return false;
    try {
      this.writable.write(JSON.stringify(msg) + "\n");
      return true;
    } catch (err) {
      this.closed = true;
      this.emitError(
        new LineProtocolError(
          "write-failed",
          `write failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return false;
    }
  }

  private emitError(err: LineProtocolError): void {
    if (this.errorHandler) this.errorHandler(err);
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.discarding) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) {
        this.buffer = "";
        return;
      }
      this.buffer = this.buffer.slice(nl + 1);
      this.discarding = false;
    }
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      this.handleLine(line);
    }
    // The remainder is a partial line; bound it.
    if (this.buffer.length > this.maxLineBytes) {
      this.emitError(
        new LineProtocolError(
          "line-overflow",
          `line exceeds ${this.maxLineBytes} bytes; discarding until next newline`,
        ),
      );
      this.discarding = true;
      this.buffer = "";
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.send({
        jsonrpc: "2.0",
        id: null as unknown as string,
        error: { code: JSON_RPC_PARSE_ERROR, message: "parse error" },
      });
      return;
    }
    if (!isPlainObject(parsed)) {
      this.emitError(
        new LineProtocolError("invalid-message", `dropped non-object payload: ${line.slice(0, 64)}`),
      );
      return;
    }
    if (this.messageHandler) this.messageHandler(parsed as unknown as RpcInbound);
  }

  /** Flush the decoder and deliver/surface any trailing unterminated data. */
  private onEnd(): void {
    this.closed = true;
    if (this.ended) return;
    this.ended = true;
    this.discarding = false;
    this.buffer += this.decoder.decode();
    const trailing = this.buffer.trim();
    this.buffer = "";
    if (!trailing) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trailing);
    } catch {
      this.emitError(
        new LineProtocolError("invalid-trailing", `unparsable trailing data: ${trailing.slice(0, 64)}`),
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      this.emitError(
        new LineProtocolError("invalid-trailing", `non-object trailing data: ${trailing.slice(0, 64)}`),
      );
      return;
    }
    if (this.messageHandler) this.messageHandler(parsed as unknown as RpcInbound);
  }
}
