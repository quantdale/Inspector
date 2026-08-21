import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OracleSuite } from "@inspector/oracle";
import type { ReplayDriver, ReplayResult } from "@inspector/finding";
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

const failingResult: ReplayResult = {
  outcomes: [],
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
    const check = await gen.materialize(fakeWorkspace(), "find-1", [], "PAGE_ERROR");
    expect(check.failedPrePatch).toBe(false);
    // Post-patch gate passes trivially when only soft signals fire.
    await expect(gen.passes(fakeWorkspace(), [])).resolves.toBe(true);
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
    const check = await gen.materialize(fakeWorkspace(), "find-1", [], "PAGE_ERROR");
    expect(check.failedPrePatch).toBe(true);
    await expect(gen.passes(fakeWorkspace(), [])).resolves.toBe(false);
  });
});
