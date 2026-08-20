import { spawn, type ChildProcess } from "node:child_process";
import { LineChannel, type RpcResponse, type RpcNotification } from "./jsonrpc.js";

export interface AdapterClientOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class AdapterClient {
  private channel: LineChannel | null = null;
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, Pending>();
  private eventHandler: ((method: string, params: unknown) => void) | null = null;
  private closed = false;

  private constructor() {}

  onEvent(handler: (method: string, params: unknown) => void): void {
    this.eventHandler = handler;
  }

  static async spawn(opts: AdapterClientOptions): Promise<AdapterClient> {
    const client = new AdapterClient();
    client.proc = spawn(opts.command, opts.args ?? [], {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "inherit"],
    });
    client.attach(client.proc.stdout!, client.proc.stdin!);
    // Wait briefly for the subprocess stdio to be usable.
    await new Promise((r) => setTimeout(r, 50));
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
  }

  private onMessage(msg: RpcResponse | RpcNotification): void {
    if ("id" in msg && msg.id !== null && msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
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
    if (!("id" in msg)) {
      if (this.eventHandler) this.eventHandler(msg.method, msg.params);
    }
  }

  async request<T = unknown>(method: string, params: unknown, deadlineMs = 10000): Promise<T> {
    if (!this.channel) throw new Error("adapter client not connected");
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`deadline-exceeded: ${method}`));
      }, deadlineMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
    });
    this.channel.send({ jsonrpc: "2.0", id, method, params });
    if (this.proc) {
      this.proc.on("close", () => {
        const p = this.pending.get(id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(id);
          p.reject(new Error("adapter-crash"));
        }
      });
    }
    return promise;
  }

  async notify(method: string, params: unknown): Promise<void> {
    this.channel?.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("adapter-crash"));
    }
    this.pending.clear();
    this.channel?.close();
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* noop */
      }
      this.proc = null;
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
