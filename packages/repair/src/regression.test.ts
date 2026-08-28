import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OracleSuite } from "@inspector/oracle";
import type { Action, ReplayDriver, ReplayResult } from "@inspector/finding";
import { RegressionGenerator } from "./regression.js";
import type { RepairWorkspace } from "./worktree.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function fakeWorkspace(): RepairWorkspace {
  dir = mkdtempSync(join(tmpdir(), "inspector-regression-gate-"));
  return { path: dir } as unknown as RepairWorkspace;
}

const action: Action = {
  id: "act_1",
  runId: "run_1",
  environmentId: "env_1",
  kind: "click",
  risk: "interact",
  deadlineMs: 1000,
  idempotency: "safe-retry",
};

const failingResult: ReplayResult = {
  outcomes: [{
    actionId: action.id,
    runId: action.runId,
    environmentId: action.environmentId,
    status: "success",
    observedAt: new Date().toISOString(),
  }],
  signals: [{ kind: "PAGE_ERROR", detail: "boom" }],
  observations: [],
};

function driverReturning(result: ReplayResult): (ws: RepairWorkspace) => Promise<ReplayDriver> {
  return async () => ({ replay: async () => result });
}

describe("repair gate strictness", () => {
  it("soft-only matches do not authorize the pre-patch regression gate", async () => {
    const gen = new RegressionGenerator({
      driverFor: driverReturning(failingResult),
      // A SOFT oracle that fires on every replay must never flip the gate.
      oracleSuite: new OracleSuite().register({
        id: "soft-page-error",
        kind: "invariant",
        strength: "soft",
        confidence: 0.3,
        description: "weak heuristic",
        detect: (r) => r.signals.some((s) => s.kind === "PAGE_ERROR"),
      }),
    });
    const check = await gen.materialize(fakeWorkspace(), "find-1", [action], "PAGE_ERROR");
    expect(check.failedPrePatch).toBe(false);
    expect(check.prePatchEvidence.disposition).toBe("clean-executed");
    // Soft signals never authorize a clean regression conclusion by themselves.
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: "clean-executed",
    });
  });

  it("hard matches still fail the gate before any patch", async () => {
    const gen = new RegressionGenerator({
      driverFor: driverReturning(failingResult),
      oracleSuite: new OracleSuite().register({
        id: "hard-page-error",
        kind: "invariant",
        strength: "hard",
        confidence: 0.95,
        description: "page error invariant",
        detect: (r) => r.signals.some((s) => s.kind === "PAGE_ERROR"),
      }),
    });
    const check = await gen.materialize(fakeWorkspace(), "find-1", [action], "PAGE_ERROR");
    expect(check.failedPrePatch).toBe(true);
    expect(check.prePatchEvidence.disposition).toBe("reproduced");
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: "reproduced",
    });
  });

  it.each([
    "adapter-crash",
    "cancelled",
    "deadline-exceeded",
    "unknown",
  ] as const)("operational outcome %s can never pass post-patch", async (status) => {
    const gen = new RegressionGenerator({
      driverFor: driverReturning({
        outcomes: [{
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status,
          observedAt: new Date().toISOString(),
        }],
        signals: [],
        observations: [],
      }),
      oracleSuite: new OracleSuite(),
    });
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: status,
    });
  });

  it("mixed required actions are indeterminate when one action is cancelled", async () => {
    const second: Action = { ...action, id: "act_2" };
    const gen = new RegressionGenerator({
      driverFor: driverReturning({
        outcomes: [
          {
            actionId: action.id,
            runId: action.runId,
            environmentId: action.environmentId,
            status: "success",
            observedAt: new Date().toISOString(),
          },
          {
            actionId: second.id,
            runId: second.runId,
            environmentId: second.environmentId,
            status: "cancelled",
            observedAt: new Date().toISOString(),
          },
        ],
        signals: [],
        observations: [],
      }),
      oracleSuite: new OracleSuite(),
    });

    await expect(gen.passes(fakeWorkspace(), [action, second])).resolves.toMatchObject({
      disposition: "cancelled",
      requiredActions: 2,
      executedOutcomes: 2,
    });
  });

  it("retains genuine reproduction evidence when exploration had an earlier automation miss", async () => {
    const second: Action = { ...action, id: "act_2" };
    const gen = new RegressionGenerator({
      driverFor: driverReturning({
        outcomes: [
          {
            actionId: action.id,
            runId: action.runId,
            environmentId: action.environmentId,
            status: "target-failure",
            observedAt: new Date().toISOString(),
            error: { code: "ACTION_FAILED", message: "stale exploratory locator" },
          },
          {
            actionId: second.id,
            runId: second.runId,
            environmentId: second.environmentId,
            status: "target-failure",
            observedAt: new Date().toISOString(),
            error: { code: "TARGET_FAILURE", message: "genuine defect" },
          },
        ],
        signals: [{ kind: "PAGE_ERROR", detail: "genuine defect" }],
        observations: [],
      }),
      oracleSuite: new OracleSuite().register({
        id: "hard-page-error",
        kind: "invariant",
        strength: "hard",
        confidence: 0.95,
        description: "page error invariant",
        detect: (r) => r.signals.some((s) => s.kind === "PAGE_ERROR"),
      }),
    });

    await expect(gen.materialize(fakeWorkspace(), "find-mixed", [action, second], "PAGE_ERROR"))
      .resolves.toMatchObject({
        failedPrePatch: true,
        prePatchEvidence: { disposition: "reproduced" },
      });
  });

  it("driver throws are operational evidence, not a clean regression", async () => {
    const gen = new RegressionGenerator({
      driverFor: async () => ({
        replay: async () => {
          throw new Error("driver exploded");
        },
      }),
      oracleSuite: new OracleSuite(),
    });
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: "operational-failure",
    });
  });

  it("zero outcomes are not-executed even when a hard oracle is absent", async () => {
    const gen = new RegressionGenerator({
      driverFor: driverReturning({
        outcomes: [],
        signals: [{ kind: "PAGE_ERROR" }],
        observations: [],
      }),
      oracleSuite: new OracleSuite().register({
        id: "hard-page-error",
        kind: "invariant",
        strength: "hard",
        confidence: 0.95,
        description: "page error invariant",
        detect: (r) => r.signals.some((s) => s.kind === "PAGE_ERROR"),
      }),
    });
    const check = await gen.materialize(fakeWorkspace(), "find-zero", [action], "PAGE_ERROR");
    expect(check.failedPrePatch).toBe(false);
    expect(check.prePatchEvidence.disposition).toBe("not-executed");
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: "not-executed",
    });
  });

  it("outcomes for a different action cannot certify replay execution", async () => {
    const gen = new RegressionGenerator({
      driverFor: driverReturning({
        outcomes: [{
          ...failingResult.outcomes[0]!,
          actionId: "forged-action",
        }],
        signals: [{ kind: "PAGE_ERROR" }],
        observations: [],
      }),
      oracleSuite: new OracleSuite().register({
        id: "hard-page-error",
        kind: "invariant",
        strength: "hard",
        confidence: 0.95,
        description: "page error invariant",
        detect: (r) => r.signals.some((s) => s.kind === "PAGE_ERROR"),
      }),
    });
    await expect(gen.passes(fakeWorkspace(), [action])).resolves.toMatchObject({
      disposition: "operational-failure",
      reason: expect.stringContaining("does not correspond"),
    });
  });
});
