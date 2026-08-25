import { randomUUID } from "node:crypto";

/**
 * Provider-neutral model runtime contracts (M13 F1/F2, ADR-0013).
 *
 * This package is the lowest-level intelligence boundary: it has ZERO
 * workspace dependencies on purpose. Exploration, oracle, repair, workflows,
 * and CLI consume it directly; none of them needs `@inspector/scale` for
 * model access. Vendor logic stays out of core product semantics — a
 * provider is configuration, not architecture.
 */

/** Explicit roles the runtime routes for. `vision` is a capability path:
 * providers may declare it and future consumers may use it; no built-in
 * consumer requires it. */
export type ModelRole = "planner" | "oracle" | "summarizer" | "repairer" | "vision";

export const MODEL_ROLES: readonly ModelRole[] = [
  "planner",
  "oracle",
  "summarizer",
  "repairer",
  "vision",
];

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === "string" && (MODEL_ROLES as readonly string[]).includes(value);
}

/** Token/cost truth reported by a provider. Every field is optional:
 * an absent field means UNKNOWN and must never be fabricated as zero —
 * spending misrepresentation is worse than honest absence. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cache/read tokens where the provider distinguishes them. */
  cachedInputTokens?: number;
  /** The provider's own total charged token figure when it reports one. */
  totalChargedTokens?: number;
  costUsd?: number;
}

/** Where a call came from. All fields optional so standalone CLI runs,
 * campaign items, and repair flows attribute what they know. */
export interface ModelAttribution {
  runId?: string;
  campaignId?: string;
  itemId?: string;
  workerId?: string;
  findingId?: string;
  repairId?: string;
}

/** Expected response shape. JSON responses are parsed and validated before
 * they reach callers; unparseable/invalid output is classified, never
 * surfaced as trusted structure. */
export type ModelResponseFormat =
  | { kind: "text" }
  | {
      kind: "json";
      /** Logical schema id recorded in durable rows (e.g. "inspector-planner-suggestion/1"). */
      schemaId?: string;
      validate?: (value: unknown) => { ok: true } | { ok: false; detail: string };
    };

/** A fully described model invocation. `prompt` is ALWAYS a bounded,
 * redacted context-packet serialization built by the caller — never a raw
 * transcript. */
export interface ModelRequestSpec {
  role: ModelRole;
  /** Stable request-class label recorded durably (e.g. "exploration-planner"). */
  requestClass: string;
  prompt: string;
  format?: ModelResponseFormat;
  /** Bounded wall-clock budget for ONE attempt (fallbacks get their own). */
  deadlineMs?: number;
  attribution?: ModelAttribution;
  /** Conservative upper bound used for budget reservation when the provider
   * cannot estimate. Absent ⇒ the gate's configured default bound applies. */
  estimate?: { tokens?: number; costUsd?: number };
  /** Redacted, bounded, scalar-only metadata persisted with the call row. */
  metadata?: Record<string, string | number | boolean>;
}

/** One provider attempt handed to {@link ModelProvider.invoke}. */
export interface ModelInvocation {
  requestId: string;
  attemptId: string;
  /** 1-based position within this logical request (fallback ordering). */
  attemptNumber: number;
  spec: ModelRequestSpec;
  signal: AbortSignal;
}

export interface ProviderOutcome {
  text: string;
  usage?: ModelUsage;
  /** Provider-side request id only when storing it is safe/useful. */
  providerRequestId?: string;
}

/** Stable failure taxonomy (ADR-0013). Repository naming follows the
 * lowercase-dashed class vocabulary already used across scale/workflows. */
export type ModelFailureClass =
  | "no-provider"
  | "provider-unhealthy"
  | "budget-denied"
  | "deadline"
  | "cancelled"
  | "transport-error"
  | "provider-error"
  | "malformed-response"
  | "schema-invalid"
  | "unsupported-role"
  | "unknown-after-crash";

/** Providers throw this to classify their own failures precisely; any other
 * thrown value is classified `transport-error`. */
export class ProviderFailure extends Error {
  readonly classification: Extract<ModelFailureClass, "provider-error" | "transport-error">;
  constructor(classification: "provider-error" | "transport-error", message: string) {
    super(message);
    this.name = "ProviderFailure";
    this.classification = classification;
  }
}

export interface ModelProviderMetadata {
  id: string;
  modelId?: string;
  roles: ModelRole[];
  /** Higher preferred; ties broken deterministically by provider id. */
  priority: number;
  modalities?: Array<"text" | "image">;
  /** Provider can pre-estimate tokens/cost for reservations. */
  estimatesUsage?: boolean;
  /** Whether the provider honors abort signals / deadlines internally. */
  deadlineAware?: boolean;
  implementationVersion?: string;
}

export interface ModelProvider {
  meta: ModelProviderMetadata;
  healthy(): boolean;
  /** Optional conservative pre-call estimate used for reservations. */
  estimate?(spec: ModelRequestSpec): { tokens?: number; costUsd?: number } | null;
  invoke(invocation: ModelInvocation): Promise<ProviderOutcome>;
}

/* ------------------------------------------------------------------ *
 * Budget reservation contract (implemented durably in @inspector/scale)
 * ------------------------------------------------------------------ */

export interface ModelBudgetAdmission {
  requestId: string;
  attemptId: string;
  role: ModelRole;
  requestClass: string;
  workerId?: string;
  itemId?: string;
  /** Conservative upper bounds to hold during the call window. */
  estimateTokens?: number;
  estimateCostUsd?: number;
  attribution?: ModelAttribution;
}

export interface ModelBudgetSettlement {
  requestId: string;
  attemptId: string;
  /** Actual usage when known; absent ⇒ settle conservatively at the
   * reserved bound (never silently refund a possibly-consumed call). */
  usage?: ModelUsage;
  outcome: "completed" | "failed" | "denied";
}

/**
 * Durable reservation gate. Admit happens BEFORE provider invocation and
 * holds bounded reservations atomically against global/worker/item ceilings;
 * settlement reconciles actuals. Implementations must make admit/settle
 * crash-safe: abandoned reservations settle conservatively, never silently
 * free.
 */
export interface ModelBudgetGate {
  admit(admission: ModelBudgetAdmission): boolean;
  settle(settlement: ModelBudgetSettlement): void;
}

/* ------------------------------------------------------------------ *
 * Durable sink contract (implemented by @inspector/store-sqlite)
 * ------------------------------------------------------------------ */

export type ModelCallStatus =
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "denied";

/** Durable record of one attempt. Raw prompts/responses are NEVER carried —
 * only hashes, bounded redacted metadata, attribution, and usage truth. */
export interface ModelCallRecord {
  /** Unique per attempt (`<requestId>/a<n>`). */
  id: string;
  requestId: string;
  attemptNumber: number;
  fallbackPosition: number;
  schemaVersion: "inspector-model-call/1";
  status: ModelCallStatus;
  role: ModelRole;
  requestClass: string;
  providerId: string | null;
  modelId: string | null;
  errorClassification: ModelFailureClass | null;
  attribution: ModelAttribution;
  contextSha256: string;
  responseSha256: string | null;
  promptBytes: number;
  responseBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalChargedTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  startedAt: string;
  completedAt: string | null;
  metadataJson: Record<string, string | number | boolean> | null;
}

export interface ModelCallSink {
  /** Persisted BEFORE external inference is attempted; never erased. */
  start(record: ModelCallRecord): void;
  /** Terminal transition (completed/failed/cancelled/denied). */
  finish(record: ModelCallRecord): void;
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type ModelFinishStatus = "completed" | "failed";

export interface ModelAttemptInfo {
  providerId: string;
  modelId?: string;
  attemptNumber: number;
  fallbacksUsed: string[];
}

export interface ModelCallResult {
  requestId: string;
  ok: boolean;
  text?: string;
  json?: unknown;
  usage: ModelUsage;
  latencyMs?: number;
  attempt?: ModelAttemptInfo;
  failure?: { classification: ModelFailureClass; detail: string };
}

/** Aggregate counters exposed for observability (M13 F24). */
export interface ModelRuntimeStats {
  requests: number;
  attempts: number;
  completed: number;
  failed: number;
  fallbacksUsed: number;
  denials: number;
  failuresByClass: Partial<Record<ModelFailureClass, number>>;
}

export function newModelRequestId(): string {
  return `mreq_${randomUUID().replace(/-/g, "")}`;
}
