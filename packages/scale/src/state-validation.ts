import type { CampaignAssignmentRecord, CampaignRefusal } from "./campaign.js";
import type { WorkerCapabilitySnapshot, WorkItemFailureClass } from "./executor.js";
import type { Finding } from "@inspector/finding";
import type { UsageEntry } from "./types.js";
import type { LeaseRecord } from "./types.js";

/**
 * Semantic validation for durable control-plane state (HARDENING_2 D8).
 *
 * `JSON.parse()` success is NOT valid campaign state. These validators run at
 * every {@link StateFile} load boundary: syntactically valid JSON with wrong
 * types, impossible values, duplicate identities, invalid generations, or
 * negative counters throws — failing closed — instead of being silently
 * normalized into empty/default state.
 *
 * Deliberate backward compatibility: fields that were legitimately ABSENT in
 * older schemas (pre-M12 campaign state) are migrated with documented
 * defaults here. Corruption (present-but-invalid) never migrates.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(state: string, detail: string): never {
  throw new TypeError(`invalid ${state}: ${detail}`);
}

function strArray(state: string, value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(state, `${field} must be an array`);
  return value.map((x, i) => {
    if (typeof x !== "string") fail(state, `${field}[${i}] must be a string`);
    return x;
  });
}

function nonNegativeInt(state: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(state, `${field} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The failure taxonomy; unknown classes are corruption, not extension points. */
const FAILURE_CLASSES: readonly WorkItemFailureClass[] = [
  "capability-unavailable",
  "target-incompatible",
  "environment-unavailable",
  "target-config-invalid",
  "execution-failure",
  "policy-refusal",
  "budget-exhausted",
];

function failureClass(state: string, value: unknown, field: string): WorkItemFailureClass {
  if (typeof value !== "string" || !FAILURE_CLASSES.includes(value as WorkItemFailureClass)) {
    fail(state, `${field} has unknown failure class ${JSON.stringify(value)}`);
  }
  return value as WorkItemFailureClass;
}

export interface CampaignStateDocument {
  queue: string[];
  executions: Array<{ itemId: string; workerId: string; runIds?: string[] }>;
  findings: Finding[];
  failed: string[];
  failureDetails: Record<string, { class: WorkItemFailureClass; detail: string }>;
  refusals: CampaignRefusal[];
  assignments: CampaignAssignmentRecord[];
  restarts: number;
  staleCompletions: number;
  stopReason: string | null;
  startedAtMs: number | null;
  workerCaps: Record<string, WorkerCapabilitySnapshot>;
}

/**
 * Validate + migrate one durable campaign state document. Missing M12-additive
 * fields default (documented legacy migration); present-but-impossible values
 * throw.
 */
export function validateCampaignState(raw: unknown): CampaignStateDocument {
  const S = "campaign state";
  if (!isRecord(raw)) fail(S, "expected an object");
  const out = raw as unknown as CampaignStateDocument;

  out.queue = strArray(S, raw.queue ?? [], "queue");
  if (!Array.isArray(raw.executions)) fail(S, "executions must be an array");
  out.executions = (raw.executions as unknown[]).map((e, i) => {
    if (!isRecord(e)) fail(S, `executions[${i}] must be an object`);
    if (typeof e.itemId !== "string") fail(S, `executions[${i}].itemId must be a string`);
    if (typeof e.workerId !== "string") fail(S, `executions[${i}].workerId must be a string`);
    return e as CampaignStateDocument["executions"][number];
  });
  // Duplicate completion identities would make exactly-once undecidable.
  const seenExec = new Set<string>();
  for (const e of out.executions) {
    if (seenExec.has(e.itemId)) fail(S, `duplicate execution record for item '${e.itemId}'`);
    seenExec.add(e.itemId);
  }

  if (!Array.isArray(raw.findings)) fail(S, "findings must be an array");
  out.findings = raw.findings as Finding[];

  out.failed = strArray(S, raw.failed ?? [], "failed");
  const executed = new Set(out.executions.map((e) => e.itemId));
  for (const id of out.failed) {
    if (executed.has(id)) fail(S, `item '${id}' cannot be both executed and failed`);
  }

  if (!isRecord(raw.failureDetails ?? {})) fail(S, "failureDetails must be an object");
  const rawFailureDetails = (raw.failureDetails ?? {}) as Record<string, unknown>;
  const failureDetails: CampaignStateDocument["failureDetails"] = {};
  for (const [itemId, detail] of Object.entries(rawFailureDetails)) {
    if (!isRecord(detail)) fail(S, `failureDetails[${itemId}] must be an object`);
    failureDetails[itemId] = {
      class: failureClass(S, detail.class, `failureDetails[${itemId}].class`),
      detail: typeof detail.detail === "string" ? detail.detail : String(detail.detail ?? ""),
    };
  }
  out.failureDetails = failureDetails;

  if (raw.restarts !== undefined) nonNegativeInt(S, raw.restarts, "restarts");
  out.restarts = raw.restarts === undefined ? 0 : (raw.restarts as number);
  if (raw.staleCompletions !== undefined) nonNegativeInt(S, raw.staleCompletions, "staleCompletions");
  out.staleCompletions = raw.staleCompletions === undefined ? 0 : (raw.staleCompletions as number);

  if (raw.stopReason !== undefined && raw.stopReason !== null && typeof raw.stopReason !== "string") {
    fail(S, "stopReason must be a string or null");
  }
  out.stopReason = (raw.stopReason ?? null) as string | null;

  if (raw.startedAtMs !== undefined && raw.startedAtMs !== null) {
    const n = nullableNumber(raw.startedAtMs);
    if (n === null || n < 0) fail(S, `startedAtMs must be a non-negative finite number or null, got ${JSON.stringify(raw.startedAtMs)}`);
  }
  out.startedAtMs = (raw.startedAtMs ?? null) as number | null;

  if (!Array.isArray(raw.refusals ?? [])) fail(S, "refusals must be an array");
  out.refusals = ((raw.refusals ?? []) as unknown[]).map((r, i) => {
    if (!isRecord(r)) fail(S, `refusals[${i}] must be an object`);
    if (typeof r.itemId !== "string") fail(S, `refusals[${i}].itemId must be a string`);
    return {
      itemId: r.itemId,
      class: failureClass(S, r.class, `refusals[${i}].class`),
      detail: typeof r.detail === "string" ? r.detail : "",
      at: typeof r.at === "string" ? r.at : new Date(0).toISOString(),
    };
  });

  if (!Array.isArray(raw.assignments ?? [])) fail(S, "assignments must be an array");
  out.assignments = ((raw.assignments ?? []) as unknown[]).map((a, i) => {
    if (!isRecord(a)) fail(S, `assignments[${i}] must be an object`);
    if (typeof a.itemId !== "string") fail(S, `assignments[${i}].itemId must be a string`);
    if (typeof a.workerId !== "string") fail(S, `assignments[${i}].workerId must be a string`);
    if (typeof a.at !== "string") fail(S, `assignments[${i}].at must be a string`);
    return a as unknown as CampaignAssignmentRecord;
  });

  if (!isRecord(raw.workerCaps ?? {})) fail(S, "workerCaps must be an object");
  out.workerCaps = { ...((raw.workerCaps ?? {}) as CampaignStateDocument["workerCaps"]) };

  return out;
}

interface LedgerFileState {
  entries: UsageEntry[];
  stopped: boolean;
}

const USAGE_NUMERIC_FIELDS = [
  "modelRequests",
  "tokens",
  "costUsd",
  "actions",
  "resets",
  "artifactBytes",
] as const;

export function validateLedgerState(raw: unknown): LedgerFileState {
  const S = "ledger state";
  if (!isRecord(raw)) fail(S, "expected an object");
  if (!Array.isArray(raw.entries)) fail(S, "entries must be an array");
  const entries = (raw.entries as unknown[]).map((e, i) => {
    if (!isRecord(e)) fail(S, `entries[${i}] must be an object`);
    if (typeof e.workerId !== "string") fail(S, `entries[${i}].workerId must be a string`);
    for (const f of USAGE_NUMERIC_FIELDS) {
      const v = e[f];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        fail(S, `entries[${i}].${f} must be a non-negative finite number, got ${JSON.stringify(v)}`);
      }
    }
    return e as unknown as UsageEntry;
  });
  const stopped = raw.stopped === undefined ? false : raw.stopped;
  if (typeof stopped !== "boolean") fail(S, "stopped must be a boolean");
  return { entries, stopped };
}

export interface ValidatableLeasesState {
  leases: Record<string, LeaseRecord>;
  done: string[];
}

export function validateLeasesState(raw: unknown): ValidatableLeasesState {
  const S = "lease state";
  if (!isRecord(raw)) fail(S, "expected an object");
  if (!isRecord(raw.leases ?? {})) fail(S, "leases must be an object");
  const leases: Record<string, LeaseRecord> = {};
  for (const [itemId, l] of Object.entries(raw.leases ?? {})) {
    if (!isRecord(l)) fail(S, `leases[${itemId}] must be an object`);
    if (typeof l.workerId !== "string") fail(S, `leases[${itemId}].workerId must be a string`);
    const generation = l.generation;
    if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) {
      fail(S, `leases[${itemId}].generation must be a positive integer, got ${JSON.stringify(generation)}`);
    }
    for (const t of ["acquiredAtMs", "expiresAtMs"] as const) {
      if (typeof l[t] !== "number" || !Number.isFinite(l[t]) || (l[t] as number) < 0) {
        fail(S, `leases[${itemId}].${t} must be a non-negative finite number`);
      }
    }
    leases[itemId] = l as unknown as LeaseRecord;
  }
  const done = strArray(S, raw.done ?? [], "done");
  const leaseIds = new Set(Object.keys(leases));
  for (const id of done) {
    if (leaseIds.has(id)) fail(S, `item '${id}' cannot be both leased and done`);
  }
  return { leases, done };
}
