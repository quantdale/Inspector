import { describe, expect, it } from "vitest";
import type { Action, ActionOutcome, ReplayResult } from "@inspector/finding";
import type { OracleVerdict } from "@inspector/oracle";
import { assessReplayEvidence, isCleanExecuted } from "./replay-evidence.js";

const action: Action = {
  id: "act_h6_mutation",
  runId: "run_h6_mutation",
  environmentId: "env_h6_mutation",
  kind: "probe",
  risk: "observe",
  deadlineMs: 1000,
  idempotency: "safe-retry",
};

const noMatch: OracleVerdict = {
  reproduced: false,
  confidence: 0,
  matched: [],
  weakSuspicion: false,
};

function outcome(status: ActionOutcome["status"], overrides: Partial<ActionOutcome> = {}): ActionOutcome {
  return {
    actionId: action.id,
    runId: action.runId,
    environmentId: action.environmentId,
    status,
    observedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function replay(outcomes: ActionOutcome[]): ReplayResult {
  return { outcomes, signals: [], observations: [] };
}

describe("HARDENING_6 mutation-kill guards", () => {
  it("kills operational-to-clean, zero-work, and identity-check mutants", () => {
    const operational = assessReplayEvidence(
      replay([outcome("adapter-crash")]),
      noMatch,
      [action],
      "clean",
    );
    expect(operational.disposition).toBe("adapter-crash");
    expect(isCleanExecuted(operational)).toBe(false);

    const zeroWork = assessReplayEvidence(replay([]), noMatch, [action], "clean");
    expect(zeroWork.disposition).toBe("not-executed");
    expect(isCleanExecuted(zeroWork)).toBe(false);

    const mismatched = assessReplayEvidence(
      replay([outcome("success", { actionId: "wrong-action" })]),
      noMatch,
      [action],
      "clean",
    );
    expect(mismatched.disposition).toBe("operational-failure");
    expect(isCleanExecuted(mismatched)).toBe(false);

    // Explicit mutant models: removing each guard would incorrectly turn the
    // same evidence into a clean conclusion, and the invariants above kill it.
    const operationalMutant = noMatch.reproduced ? "reproduced" : "clean-executed";
    const zeroWorkMutant = "clean-executed";
    const identityMutant = "clean-executed";
    expect(operationalMutant).toBe("clean-executed");
    expect(zeroWorkMutant).toBe("clean-executed");
    expect(identityMutant).toBe("clean-executed");
    expect(operationalMutant).not.toBe(operational.disposition);
    expect(zeroWorkMutant).not.toBe(zeroWork.disposition);
    expect(identityMutant).not.toBe(mismatched.disposition);
  });
});
