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
  LifecycleOp,
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRpcId(value: unknown): value is string | number {
  return (
    (typeof value === "string" || typeof value === "number") &&
    (typeof value !== "number" || Number.isFinite(value))
  );
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
    const hasId = hasOwn(msg, "id");
    const id = msg.id;
    const requestErrors: string[] = [];
    if (msg.jsonrpc !== "2.0") requestErrors.push("jsonrpc must be '2.0'");
    if (typeof msg.method !== "string" || msg.method.length === 0) {
      requestErrors.push("method must be a non-empty string");
    }
    if (hasId && !isRpcId(id)) {
      requestErrors.push("id must be a finite number or string when present");
    }
    if (requestErrors.length > 0) {
      // A null, object, or otherwise invalid id cannot safely be echoed in a
      // JSON-RPC response. Notifications and malformed ids stay silent.
      if (isRpcId(id)) {
        this.sendError(id, {
          code: JSON_RPC_INVALID_REQUEST,
          message: "invalid request",
          data: requestErrors,
        });
      }
      return;
    }
    const req = msg as unknown as RpcRequest;
    const notification = !hasId;
    try {
      const result = await this.handle(req.method, req.params);
      if (!notification) this.channel.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      if (err instanceof AdapterCrashError) {
        if (!notification) {
          this.sendError(req.id, {
            code: JSON_RPC_INTERNAL_ERROR,
            message: err.message,
          });
        }
        this.close();
        return;
      }
      if (notification) return;
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
      case "initialize": {
        const p = params === undefined ? {} : this.requireObject(params, "initialize");
        if (p.adapter !== undefined && typeof p.adapter !== "string") {
          throw invalidParams(["/adapter must be a string"]);
        }
        return this.handler.initialize(p as InitializeRequest);
      }
      case "observe": {
        const p = this.requireObject(params, "observe") as unknown as ObserveRequest;
        const v = validateObserveRequest(p);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.observe(p);
      }
      case "act": {
        const p = this.requireObject(params, "act") as unknown as ActRequest;
        const v = validateAction(p?.action);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.act(p);
      }
      case "lifecycle": {
        const p = this.requireObject(params, "lifecycle");
        if (!isLifecycleOp(p.op)) throw invalidParams(["/op must be create, reset, or close"]);
        if (p.options !== undefined && !isPlainObject(p.options)) {
          throw invalidParams(["/options must be an object"]);
        }
        return this.handler.lifecycle(p as unknown as LifecycleRequest);
      }
      case "health": {
        const p = params === undefined ? {} : this.requireObject(params, "health");
        if (p.echo !== undefined && typeof p.echo !== "string") {
          throw invalidParams(["/echo must be a string"]);
        }
        return this.handler.health(p as HealthRequest);
      }
      case "cancel": {
        const p = this.requireObject(params, "cancel");
        if (typeof p.actionId !== "string" || p.actionId.length === 0) {
          throw invalidParams(["/actionId must be a non-empty string"]);
        }
        await this.handler.cancel({ actionId: p.actionId });
        return null;
      }
      default:
        throw Object.assign(new Error(`method not found: ${method}`), {
          code: JSON_RPC_METHOD_NOT_FOUND,
        });
    }
  }

  private requireObject(params: unknown, method: string): Record<string, unknown> {
    if (!isPlainObject(params)) {
      throw invalidParams([`/${method} params must be an object`]);
    }
    return params;
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

function isLifecycleOp(value: unknown): value is LifecycleOp {
  return value === "create" || value === "reset" || value === "close";
}
