import { spawn, type ChildProcess } from "node:child_process";
import { LineChannel, type RpcResponse, type RpcNotification } from "./jsonrpc.js";
import { PROTOCOL_VERSION, validateCapabilityDoc } from "@inspector/protocol";

/** Why an adapter client refuses or fails requests. */
export type AdapterClientFailureReason = "spawn-failed" | "crashed" | "closed";

/** Typed failure for dead/closed clients. The "crashed" variant keeps the
 * historical "adapter-crash" message so downstream classification holds. */
export class AdapterClientError extends Error {
  readonly reason: AdapterClientFailureReason;

  constructor(reason: AdapterClientFailureReason, message: string) {
    super(message);
    this.name = "AdapterClientError";
    this.reason = reason;
  }
}

/** The adapter returned a payload that violates the protocol contract. */
export class AdapterProtocolError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "AdapterProtocolError";
    this.details = details;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Grace window before escalating termination to SIGKILL. */
const CLOSE_GRACE_MS = 2000;
/** How long spawn waits for subprocess stdio to become usable. */
const SPAWN_SETTLE_MS = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AdapterClientOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export class AdapterClient {
  private channel: LineChannel | null = null;
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, Pending>();
  private eventHandler: ((method: string, params: unknown) => void) | null = null;
  private closed = false;
  /** First fatal error observed via the global watchers, if any. */
  private deathErr: AdapterClientError | null = null;
  private deathSignalResolve: (() => void) | null = null;
  private deathWaiter: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

  private constructor() {}

  onEvent(handler: (method: string, params: unknown) => void): void {
    this.eventHandler = handler;
  }

  static async spawn(opts: AdapterClientOptions): Promise<AdapterClient> {
    const client = new AdapterClient();
    const proc = spawn(opts.command, opts.args ?? [], {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "inherit"],
    });
    client.proc = proc;
    client.attach(proc.stdout!, proc.stdin!);
    // Wait briefly for the subprocess stdio to be usable, aborting early if
    // the child fails to spawn or exits during the settle window.
    await Promise.race([sleep(SPAWN_SETTLE_MS), client.deathSignal()]);
    if (client.deathErr) {
      await client.close();
      throw client.deathErr;
    }
    return client;
  }

  static overStreams(readable: NodeJS.ReadableStream, writable: NodeJS.WritableStream): AdapterClient {
    const client = new AdapterClient();
    client.attach(readable, writable);
    return client;
  }

  private attach(readable: NodeJS.ReadableStream, writable: NodeJS.WritableStream): void {
    this.channel = new LineChannel(readable, writable);
    this.channel.onMessage((msg) => this.onMessage(msg));
    void this.deathSignal();
    // Global watchers: registered once per client, never per request.
    readable.on("close", () => this.markDead(crashError()));
    readable.on("error", () => this.markDead(crashError()));
    if (this.proc) {
      this.proc.once("error", (err) =>
        this.markDead(new AdapterClientError("spawn-failed", `adapter spawn failed: ${err.message}`)),
      );
      this.proc.once("close", () => this.markDead(crashError()));
    }
  }

  private deathSignal(): Promise<void> {
    if (!this.deathWaiter) {
      this.deathWaiter = new Promise((resolve) => {
        this.deathSignalResolve = resolve;
      });
    }
    return this.deathWaiter;
  }

  private markDead(err: AdapterClientError): void {
    if (this.deathErr) return;
    this.deathErr = err;
    this.failPending(err);
    this.deathSignalResolve?.();
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onMessage(msg: RpcResponse | RpcNotification): void {
    if ("id" in msg && msg.id !== null && msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) return; // Unknown/stale id: drop silently.
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message);
        (err as Error & { code?: number }).code = msg.error.code;
        (err as Error & { data?: unknown }).data = msg.error.data;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (!("id" in msg) && typeof msg.method === "string") {
      if (this.eventHandler) this.eventHandler(msg.method, msg.params);
    }
  }

  /** Typed error to throw immediately, if the client cannot carry requests. */
  private immediateFailure(): AdapterClientError | null {
    if (this.closed) return new AdapterClientError("closed", "adapter client is closed");
    if (this.deathErr) return this.deathErr;
    if (!this.channel) return new AdapterClientError("closed", "adapter client not connected");
    return null;
  }

  async request<T = unknown>(method: string, params: unknown, deadlineMs = 10000): Promise<T> {
    const failure = this.immediateFailure();
    if (failure) throw failure;
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`deadline-exceeded: ${method}`));
        this.cancelOnDeadline(method, params);
      }, deadlineMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
    });
    const sent = this.channel!.send({ jsonrpc: "2.0", id, method, params });
    if (!sent) {
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
      }
      throw this.deathErr ?? new AdapterClientError("crashed", "adapter-crash");
    }
    const result = await promise;
    if (method === "initialize") this.assertInitializeResult(result);
    return result;
  }

  /** Best-effort cancel notification when an act request runs out of time. */
  private cancelOnDeadline(method: string, params: unknown): void {
    if (method !== "act") return;
    const actionId = (params as { action?: { id?: unknown } } | null)?.action?.id;
    if (typeof actionId === "string") void this.notify("cancel", { actionId });
  }

  /** ADR 0002: the initialize result must be a current-version capability doc. */
  private assertInitializeResult(result: unknown): void {
    const version = (result as { protocolVersion?: unknown } | null)?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      throw new AdapterProtocolError(
        `protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`,
        [`protocolVersion: expected ${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`],
      );
    }
    const v = validateCapabilityDoc(result);
    if (!v.ok) {
      throw new AdapterProtocolError(
        `invalid capability document: ${v.errors.join("; ")}`,
        v.errors,
      );
    }
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (this.closed || this.deathErr || !this.channel) return;
    this.channel.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.failPending(new AdapterClientError("closed", "adapter client is closed"));
    this.channel?.close();
    const proc = this.proc;
    this.proc = null;
    if (!proc) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    this.closePromise = this.terminate(proc);
    return this.closePromise;
  }

  /** Await child exit within a grace window, then escalate to SIGKILL.
   * SIGKILL is Windows-safe: Node maps it to TerminateProcess. */
  private async terminate(proc: ChildProcess): Promise<void> {
    const exited = new Promise<void>((resolve) => proc.once("close", () => resolve()));
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    const finished = await Promise.race([
      exited.then(() => true),
      sleep(CLOSE_GRACE_MS).then(() => false),
    ]);
    if (!finished) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      await Promise.race([exited, sleep(CLOSE_GRACE_MS)]);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

function crashError(): AdapterClientError {
  return new AdapterClientError("crashed", "adapter-crash");
}
