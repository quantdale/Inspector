import {
  LineChannel,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INTERNAL_ERROR,
  type RpcRequest,
  type RpcNotification,
} from "./jsonrpc.js";
import type {
  InitializeRequest,
  ObserveRequest,
  ActRequest,
  LifecycleRequest,
  HealthRequest,
  HealthResponse,
  CapabilityDoc,
  Observation,
  ActionOutcome,
} from "@inspector/protocol";

export class AdapterCrashError extends Error {
  constructor(message = "adapter crashed") {
    super(message);
    this.name = "AdapterCrashError";
  }
}

export interface AdapterHandler {
  initialize(params: InitializeRequest): Promise<CapabilityDoc> | CapabilityDoc;
  observe(params: ObserveRequest): Promise<Observation> | Observation;
  act(params: ActRequest): Promise<ActionOutcome> | ActionOutcome;
  lifecycle(params: LifecycleRequest): Promise<{ ok: boolean }> | { ok: boolean };
  health(params: HealthRequest): Promise<HealthResponse> | HealthResponse;
  cancel(params: { actionId: string }): Promise<void> | void;
}

/**
 * Runs an AdapterHandler over a LineChannel, dispatching JSON-RPC requests and
 * emitting adapter events as notifications. Adapter crashes (AdapterCrashError)
 * close the transport so the client can classify them as adapter-crash.
 */
export class AdapterServer {
  private readonly channel: LineChannel;
  private closed = false;

  constructor(
    readable: NodeJS.ReadableStream,
    writable: NodeJS.WritableStream,
    private readonly handler: AdapterHandler,
  ) {
    this.channel = new LineChannel(readable, writable);
    this.channel.onMessage((msg) => {
      void this.dispatch(msg);
    });
  }

  private async dispatch(msg: RpcRequest | RpcNotification): Promise<void> {
    if (!("id" in msg)) {
      // Notification: cancel is the only one we act on.
      if (msg.method === "cancel") {
        try {
          await this.handler.cancel((msg.params as { actionId: string }) ?? { actionId: "" });
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const req = msg as RpcRequest;
    try {
      const result = await this.handle(req.method, req.params);
      this.channel.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      if (err instanceof AdapterCrashError) {
        this.channel.send({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: JSON_RPC_INTERNAL_ERROR, message: err.message },
        });
        this.close();
        return;
      }
      this.channel.send({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: JSON_RPC_INTERNAL_ERROR,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handler.initialize((params as InitializeRequest) ?? {});
      case "observe":
        return this.handler.observe((params as ObserveRequest) ?? { observe: [] });
      case "act":
        return this.handler.act((params as ActRequest) ?? { action: {} as ActRequest["action"] });
      case "lifecycle":
        return this.handler.lifecycle((params as LifecycleRequest) ?? { op: "create" });
      case "health":
        return this.handler.health((params as HealthRequest) ?? {});
      default:
        throw Object.assign(new Error(`method not found: ${method}`), {
          code: JSON_RPC_METHOD_NOT_FOUND,
        });
    }
  }

  emitEvent(method: string, params: unknown): void {
    if (this.closed) return;
    this.channel.send({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    this.closed = true;
    this.channel.close();
  }
}
