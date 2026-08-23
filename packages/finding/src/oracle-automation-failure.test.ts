import { describe, expect, it } from "vitest";
import { OracleEngine } from "./engine.js";
import type { ActionOutcome, ReplayResult } from "./types.js";

describe("target-failure oracle discipline", () => {
  it.each([
    ["hidden element", "ACTION_FAILED"],
    ["stale selector", "ACTION_FAILED"],
    ["failed UIA resolution", "ACTION_FAILED"],
    ["failed ADB selector", "ACTION_FAILED"],
    ["PTY action failure", "ACTION_FAILED"],
    ["generic adapter miss", "CAPABILITY_DENIED"],
  ])("does not promote %s into a reproduced target defect", (_label, code) => {
    const result: ReplayResult = {
      outcomes: [outcome("automation-miss", code as ErrorCode)],
      signals: [],
      observations: [],
    };
    expect(OracleEngine.defaults().evaluate(result).reproduced).toBe(false);
  });

  it("promotes a true target crash even when no separate signal was emitted", () => {
    const result: ReplayResult = {
      outcomes: [outcome("crash", "TARGET_FAILURE")],
      signals: [],
      observations: [],
    };
    const evaluation = OracleEngine.defaults().evaluate(result);
    expect(evaluation.reproduced).toBe(true);
    expect(evaluation.matchedOracleIds).toContain("target-failure");
  });

  it("keeps explicit page-error evidence as a target defect signal", () => {
    const result: ReplayResult = {
      outcomes: [outcome("click", "ACTION_FAILED")],
      signals: [{ kind: "PAGE_ERROR", detail: "application exception" }],
      observations: [],
    };
    expect(OracleEngine.defaults().evaluate(result).reproduced).toBe(true);
  });
});

type ErrorCode = NonNullable<ActionOutcome["error"]>["code"];

function outcome(actionId: string, code: ErrorCode): ActionOutcome {
  return {
    actionId,
    runId: "run_oracle",
    environmentId: "env_oracle",
    status: "target-failure",
    observedAt: new Date(0).toISOString(),
    error: { code, message: code },
  };
}
