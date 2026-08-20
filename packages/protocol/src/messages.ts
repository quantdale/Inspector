import { PROTOCOL_NAME, PROTOCOL_VERSION, type ProtocolVersion } from "./version.js";
import type { IapError } from "./errors.js";

export type MessageDirection = "request" | "response" | "event";

export interface IapEnvelope<P = unknown> {
  protocol: typeof PROTOCOL_NAME;
  protocolVersion: ProtocolVersion;
  id: string;
  direction: MessageDirection;
  method?: string;
  inReplyTo?: string;
  timestamp: string;
  deadlineMs?: number;
  payload: P;
  error?: IapError;
}

export interface Action {
  id: string;
  runId: string;
  environmentId: string;
  kind: string;
  risk: "observe" | "interact" | "mutate-test-state" | "modify-source" | "publish";
  deadlineMs: number;
  idempotency: "safe-retry" | "observe-before-retry" | "never-retry";
  target?: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export type ActionOutcomeStatus =
  | "success"
  | "target-failure"
  | "adapter-crash"
  | "cancelled"
  | "deadline-exceeded"
  | "unknown";

export interface ActionOutcome {
  actionId: string;
  runId: string;
  environmentId: string;
  status: ActionOutcomeStatus;
  observedAt: string;
  error?: IapError;
  stateAfter?: string;
  artifactRefs?: string[];
}

export interface Observation {
  id: string;
  runId: string;
  environmentId: string;
  stepId?: string | null;
  sequence: number;
  source: string;
  capturedAt: string;
  summary: Record<string, unknown>;
  artifacts?: Array<{ sha256: string; mime: string; size: number; path: string }>;
}

export type AdapterEventType =
  | "observation"
  | "action-outcome"
  | "health"
  | "log"
  | "artifact"
  | "lifecycle";

export interface AdapterEvent {
  sequence: number;
  runId: string;
  environmentId: string;
  stepId?: string | null;
  type: AdapterEventType;
  timestamp: string;
  payload: unknown;
}

export type LifecycleOp = "create" | "reset" | "close";

export interface InitializeRequest {
  adapter?: string;
  requested?: unknown;
}

export interface ObserveRequest {
  observe: string[];
  options?: Record<string, unknown>;
}

export interface ActRequest {
  action: Action;
}

export interface LifecycleRequest {
  op: LifecycleOp;
  options?: Record<string, unknown>;
}

export interface CancelRequest {
  actionId: string;
}

export interface HealthRequest {
  echo?: string;
}

export interface HealthResponse {
  ok: boolean;
  echo?: string;
  uptimeMs: number;
  now: string;
}

export function makeEnvelope<P>(opts: {
  id: string;
  direction: MessageDirection;
  payload: P;
  method?: string;
  inReplyTo?: string;
  deadlineMs?: number;
  timestamp?: string;
  error?: IapError;
}): IapEnvelope<P> {
  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    id: opts.id,
    direction: opts.direction,
    method: opts.method,
    inReplyTo: opts.inReplyTo,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    deadlineMs: opts.deadlineMs,
    payload: opts.payload,
    error: opts.error,
  };
}
