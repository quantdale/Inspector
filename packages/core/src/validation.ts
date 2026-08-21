import {
  ProtocolError,
  validateObservation,
  type ActionOutcome,
  type Observation,
} from "@inspector/protocol";

/**
 * Runtime validation at the core/persistence boundary (ADR 0002): nothing an
 * adapter returns is persisted or trusted on a blind cast. Malformed payloads
 * raise ProtocolError with code VALIDATION before any durable state changes.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate an adapter observation against the protocol JSON Schema. */
export function parseAdapterObservation(raw: unknown): Observation {
  const result = validateObservation(raw);
  if (!result.ok) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed observation: ${result.errors.join("; ")}`,
      detail: result.errors,
    });
  }
  return raw as Observation;
}

const OUTCOME_STATUSES: readonly string[] = [
  "success",
  "target-failure",
  "adapter-crash",
  "cancelled",
  "deadline-exceeded",
  "unknown",
];

/**
 * Validate an action outcome before persistence. @inspector/protocol does not
 * yet ship a JSON Schema for ActionOutcome, so the documented shape is
 * enforced structurally here; when a schema lands this guard should delegate
 * to it.
 */
export function parseActionOutcome(raw: unknown): ActionOutcome {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed action outcome: expected object, got ${raw === null ? "null" : typeof raw}`,
      detail: [],
    });
  }
  for (const key of ["actionId", "runId", "environmentId"] as const) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
      errors.push(`${key}: must be a non-empty string`);
    }
  }
  if (typeof raw.status !== "string" || !OUTCOME_STATUSES.includes(raw.status)) {
    errors.push(`status: must be one of ${OUTCOME_STATUSES.join(", ")}`);
  }
  if (
    typeof raw.observedAt !== "string" ||
    Number.isNaN(Date.parse(raw.observedAt))
  ) {
    errors.push("observedAt: must be an ISO date-time string");
  }
  if (raw.stateAfter !== undefined && typeof raw.stateAfter !== "string") {
    errors.push("stateAfter: must be a string when present");
  }
  if (raw.artifactRefs !== undefined) {
    if (
      !Array.isArray(raw.artifactRefs) ||
      !raw.artifactRefs.every((ref) => typeof ref === "string")
    ) {
      errors.push("artifactRefs: must be an array of strings when present");
    }
  }
  if (raw.error !== undefined) {
    if (!isPlainObject(raw.error)) {
      errors.push("error: must be an object when present");
    } else {
      if (typeof raw.error.code !== "string") errors.push("error.code: must be a string");
      if (typeof raw.error.message !== "string") errors.push("error.message: must be a string");
    }
  }
  if (errors.length > 0) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed action outcome: ${errors.join("; ")}`,
      detail: errors,
    });
  }
  return raw as unknown as ActionOutcome;
}
