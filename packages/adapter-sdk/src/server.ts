import {
  LineChannel,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_INVALID_PARAMS,
  type RpcError,
  type RpcRequest,
} from "./jsonrpc.js";
import { validateAction, validateObserveRequest } from "@inspector/protocol";
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build an invalid-params failure carrying the schema violations as data. */
function invalidParams(errors: string[]): Error & { code: number; data: string[] } {
  return Object.assign(new Error(`invalid params: ${errors.join("; ")}`), {
    code: JSON_RPC_INVALID_PARAMS,
    data: errors,
  });
}

/**
 * Runs an AdapterHandler over a LineChannel, dispatching JSON-RPC requests and
 * emitting adapter events as notifications. Adapter crashes (AdapterCrashError)
 * close the transport so the client can classify them as adapter-crash.
 *
 * Inbound traffic is validated at the boundary (ADR 0002): non-message garbage
 * is dropped, malformed requests get -32600, unknown methods -32601, and
 * act/observe params are schema-validated with -32602 on violation.
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

  private async dispatch(msg: unknown): Promise<void> {
    if (!isPlainObject(msg)) return; // Non-message garbage: ignore.
    if (typeof msg.method !== "string") {
      // Malformed request: only reply when the sender gave us an id to
      // correlate against; otherwise stay silent to avoid response loops.
      if (msg.id !== null && msg.id !== undefined) {
        this.sendError(msg.id as string | number, {
          code: JSON_RPC_INVALID_REQUEST,
          message: "invalid request",
        });
      }
      return;
    }
    if (msg.id === null || msg.id === undefined) {
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
    const req = msg as unknown as RpcRequest;
    try {
      const result = await this.handle(req.method, req.params);
      this.channel.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      if (err instanceof AdapterCrashError) {
        this.sendError(req.id, {
          code: JSON_RPC_INTERNAL_ERROR,
          message: err.message,
        });
        this.close();
        return;
      }
      const code = (err as { code?: unknown }).code;
      const data = (err as { data?: unknown }).data;
      this.sendError(req.id, {
        code: typeof code === "number" ? code : JSON_RPC_INTERNAL_ERROR,
        message: err instanceof Error ? err.message : String(err),
        data,
      });
    }
  }

  private sendError(id: string | number, error: RpcError): void {
    this.channel.send({ jsonrpc: "2.0", id, error });
  }

  private async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handler.initialize((params as InitializeRequest) ?? {});
      case "observe": {
        const p = (params ?? {}) as ObserveRequest;
        const v = validateObserveRequest(p);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.observe(p);
      }
      case "act": {
        const p = (params ?? {}) as ActRequest;
        const v = validateAction(p?.action);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.act(p);
      }
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
