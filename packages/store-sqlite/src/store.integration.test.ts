import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./index.js";

let dir: string | null = null;

function tmpDb(): string {
  dir = mkdtempSync(join(tmpdir(), "inspector-store-"));
  return join(dir, "run.db");
}

function removeDir(path: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

afterEach(() => {
  if (dir) {
    removeDir(dir);
    dir = null;
  }
});

describe("sqlite durable store", () => {
  it("preserves ordered steps across reopen and identifies unknown in-flight actions", () => {
    const path = tmpDb();
    const runId = "run_1";
    const envId = "env_1";

    {
      const store = Store.open(path);
      store.createRun({ id: runId, adapter: "adapter-fake" });
      store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });

      for (let i = 0; i < 3; i++) {
        store.commitStep({
          stepId: `step_${i}`,
          runId,
          environmentId: envId,
          sequence: i,
          action: {
            id: `act_${i}`,
            kind: "observe",
            risk: "observe",
            deadlineMs: 5000,
            idempotency: "safe-retry",
            status: "success",
            stateAfter: `state_${i}`,
          },
          observations: [
            {
              id: `obs_${i}`,
              stepId: `step_${i}`,
              sequence: i,
              source: "adapter-fake",
              capturedAt: new Date().toISOString(),
              summary: { index: i },
            },
          ],
        });
      }

      // Simulate an action request that never received a response (crash here).
      store.insertPendingAction({
        id: "act_lost",
        runId,
        environmentId: envId,
        kind: "click",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "never-retry",
      });

      // No finalize -> simulate process crash by simply closing.
      store.close();
    }

    // Restart: reopen and recover.
    const recovered = Store.open(path);
    const inFlight = recovered.markInFlightUnknown(runId);
    expect(inFlight.map((a) => a.id)).toContain("act_lost");
    const lost = recovered.getAction("act_lost");
    expect(lost?.status).toBe("unknown");

    const steps = recovered.getRunSteps(runId);
    expect(steps.map((s) => s.step.sequence)).toEqual([0, 1, 2]);
    expect(steps.every((s) => s.action?.status === "success")).toBe(true);
    expect(steps[0]?.observations[0]?.summary_json).toContain("index");
    recovered.close();
  });

  it("does not duplicate unknown outcomes on recovery", () => {
    const path = tmpDb();
    const runId = "run_dup";
    const envId = "env_dup";
    const store = Store.open(path);
    store.createRun({ id: runId });
    store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });
    store.insertPendingAction({
      id: "act_x",
      runId,
      environmentId: envId,
      kind: "navigate",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "observe-before-retry",
    });
    const first = store.markInFlightUnknown(runId);
    const second = store.markInFlightUnknown(runId);
    expect(first).toHaveLength(1);
    // The lost action remains in-flight (unknown) but is never duplicated.
    expect(second).toHaveLength(1);
    const count = store.raw
      .prepare(`SELECT COUNT(*) AS c FROM actions WHERE run_id = ?`)
      .get(runId) as { c: number };
    expect(count.c).toBe(1);
    store.close();
  });
});
