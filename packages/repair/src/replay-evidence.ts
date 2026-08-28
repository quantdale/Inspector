import type { Action, ReplayResult } from "@inspector/finding";
import type { ActionOutcomeStatus } from "@inspector/protocol";
import type { OracleVerdict } from "@inspector/oracle";

/**
 * A repair gate's conclusion is about execution as well as oracle output.
 * Keeping the disposition typed prevents a missing/failed replay from being
 * accidentally treated as a boolean "oracle did not fire" result.
 */
export type ReplayEvidenceDisposition =
  | "reproduced"
  | "clean-executed"
  | "operational-failure"
  | "cancelled"
  | "deadline-exceeded"
  | "unknown"
  | "adapter-crash"
  | "incompatible"
  | "not-executed";

export type ReplayEvidenceExpectation = "reproduction" | "clean";

export interface ReplayEvidence {
  disposition: ReplayEvidenceDisposition;
  expectation: ReplayEvidenceExpectation;
  result: ReplayResult | null;
  matchedOracleIds: string[];
  requiredActions: number;
  executedOutcomes: number;
  reason: string;
}

type OperationalStatus = Exclude<ActionOutcomeStatus, "success" | "target-failure">;

const OPERATIONAL_STATUSES: ReadonlySet<OperationalStatus> = new Set([
  "adapter-crash",
  "cancelled",
  "deadline-exceeded",
  "unknown",
]);

const DISALLOWED_CLEAN_SIGNALS = new Set(["TARGET_FAILURE", "ADAPTER_CRASH"]);

/** Classify a driver exception without allowing it to become clean evidence. */
export function replayExceptionEvidence(
  error: unknown,
  expectation: ReplayEvidenceExpectation,
  requiredActions: number,
): ReplayEvidence {
  const reason = error instanceof Error ? error.message : String(error);
  const normalized = reason.toLowerCase();
  let disposition: ReplayEvidenceDisposition = "operational-failure";
  if (normalized.includes("cancel")) disposition = "cancelled";
  else if (normalized.includes("deadline") || normalized.includes("timeout")) {
    disposition = "deadline-exceeded";
  } else if (normalized.includes("unknown")) disposition = "unknown";
  else if (normalized.includes("adapter-crash") || normalized.includes("adapter crash")) {
    disposition = "adapter-crash";
  } else if (normalized.includes("incompatible")) disposition = "incompatible";
  return {
    disposition,
    expectation,
    result: null,
    matchedOracleIds: [],
    requiredActions,
    executedOutcomes: 0,
    reason: `replay driver failed: ${reason}`,
  };
}

/**
 * Assess a returned replay. A clean conclusion requires one outcome for every
 * required action, all outcomes to be `success`, and no hard oracle match.
 * Reproduction also requires complete execution; a target failure is valid
 * only when it is the explicit TARGET_FAILURE class, never an automation miss.
 */
export function assessReplayEvidence(
  result: ReplayResult,
  verdict: OracleVerdict,
  actions: Action[],
  expectation: ReplayEvidenceExpectation,
): ReplayEvidence {
  const base = {
    expectation,
    result,
    matchedOracleIds: verdict.matched.map((m) => m.id),
    requiredActions: actions.length,
    executedOutcomes: result.outcomes.length,
  };
  if (actions.length === 0 || result.outcomes.length === 0) {
    return {
      ...base,
      disposition: "not-executed",
      reason: "replay produced zero required action outcomes",
    };
  }
  if (result.outcomes.length !== actions.length) {
    return {
      ...base,
      disposition: "not-executed",
      reason: `replay executed ${result.outcomes.length} of ${actions.length} required actions`,
    };
  }

  const mismatchIndex = result.outcomes.findIndex((outcome, index) => {
    const action = actions[index];
    return (
      action === undefined ||
      outcome.actionId !== action.id ||
      outcome.runId !== action.runId ||
      outcome.environmentId !== action.environmentId
    );
  });
  if (mismatchIndex >= 0) {
    const mismatched = result.outcomes[mismatchIndex]!;
    const required = actions[mismatchIndex];
    return {
      ...base,
      disposition: "operational-failure",
      reason: `replay outcome ${mismatched.actionId} (${mismatched.runId}/${mismatched.environmentId}) does not correspond to required action ${required?.id ?? "unknown"} (${required?.runId ?? "unknown"}/${required?.environmentId ?? "unknown"})`,
    };
  }

  // A reproduction gate is positive evidence of the defect, not a claim that
  // every preceding exploratory action was benign. A path can contain an
  // automation miss before a later, explicitly classified TARGET_FAILURE;
  // retain that genuine failure as reproduction evidence. The clean branch
  // below remains strict, so the same mixed execution can never authorize a
  // fix or masking-probe conclusion.
  if (
    expectation === "reproduction" &&
    result.outcomes.some(
      (outcome) =>
        outcome.status === "target-failure" &&
        outcome.error?.code === "TARGET_FAILURE",
    ) &&
    verdict.reproduced
  ) {
    return {
      ...base,
      disposition: "reproduced",
      reason: "explicit target failure reproduced; exploratory actions may include non-clean outcomes",
    };
  }

  const operational = result.outcomes.find(
    (outcome): outcome is (typeof outcome & { status: OperationalStatus }) =>
      OPERATIONAL_STATUSES.has(outcome.status as OperationalStatus),
  );
  if (operational) {
    return {
      ...base,
      disposition: operational.status,
      reason: `replay returned ${operational.status} for action ${operational.actionId}`,
    };
  }

  const nonSuccess = result.outcomes.find((outcome) => outcome.status !== "success");
  if (nonSuccess) {
    return {
      ...base,
      disposition: "operational-failure",
      reason: `replay returned non-success outcome ${nonSuccess.status}`,
    };
  }

  // A driver can return success while exposing a low-level failure signal
  // that is not registered in the current oracle suite. It is still unsafe
  // to call a benign-flow probe clean in that state.
  if (
    expectation === "clean" &&
    !verdict.reproduced &&
    result.signals.some((signal) => DISALLOWED_CLEAN_SIGNALS.has(signal.kind))
  ) {
    return {
      ...base,
      disposition: "operational-failure",
      reason: "replay exposed a disallowed target/adapter failure signal",
    };
  }

  if (expectation === "reproduction") {
    return {
      ...base,
      disposition: verdict.reproduced ? "reproduced" : "clean-executed",
      reason: verdict.reproduced
        ? "all required actions executed and the expected hard oracle fired"
        : "all required actions executed but the expected hard oracle did not fire",
    };
  }
  return {
    ...base,
    disposition: verdict.reproduced ? "reproduced" : "clean-executed",
    reason: verdict.reproduced
      ? "all required actions executed but a hard oracle still fired"
      : "all required actions executed successfully and no hard oracle fired",
  };
}

export function isCleanExecuted(evidence: ReplayEvidence): boolean {
  return evidence.disposition === "clean-executed";
}
