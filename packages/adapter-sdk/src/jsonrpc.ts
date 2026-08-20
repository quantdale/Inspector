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
export const JSON_RPC_INTERNAL_ERROR = -32603;

/**
 * Line-delimited JSON-RPC 2.0 transport over a readable/writable stream pair.
 * Each message is a single JSON object terminated by a newline.
 */
export class LineChannel {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private messageHandler: ((msg: RpcInbound) => void) | null = null;
  private closed = false;

  constructor(
    private readonly readable: NodeJS.ReadableStream,
    private readonly writable: NodeJS.WritableStream,
  ) {
    this.readable.on("data", (chunk: Buffer) => this.onData(chunk));
    this.readable.on("close", () => {
      this.closed = true;
    });
    this.readable.on("error", () => {
      this.closed = true;
    });
  }

  onMessage(handler: (msg: RpcInbound) => void): void {
    this.messageHandler = handler;
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

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.send({
          jsonrpc: "2.0",
          id: null as unknown as string,
          error: { code: JSON_RPC_PARSE_ERROR, message: "parse error" },
        });
        continue;
      }
      if (this.messageHandler) this.messageHandler(parsed as RpcInbound);
    }
  }

  send(msg: RpcOutbound): void {
    if (this.closed) return;
    try {
      this.writable.write(JSON.stringify(msg) + "\n");
    } catch {
      this.closed = true;
    }
  }
}
