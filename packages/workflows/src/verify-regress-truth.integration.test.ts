import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem, type ExecutionContext, type WorkItemResult } from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";
import { Store } from "@inspector/store-sqlite";

/**
 * HARDENING_5 H5-D7 / H5-D8 / H5-D10 regression: verification and regression
 * truth. A negative product conclusion (RESOLVED / clean) requires POSITIVE
 * execution evidence; environment/adapter/provenance failures are indeterminate,
 * never "fixed" or "clean". Replay budget units must go through
 * admit-before-consume.
 *
 * Uses the universally-available `fake` family so the lane executes on any
 * host (no real browser/device/UIA/Electron required). The executor is also
 * invoked directly with a hand-built context so the verify/regress notes can be
 * asserted precisely.
 */

const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-h5-vr-${name}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

function makeCtx(artifactsDir: string, workspaceDir: string, itemId: string): ExecutionContext {
  const ctrl = new AbortController();
  return {
    itemId,
    workerId: "worker-test",
    attempt: 1,
    workspaceDir,
    artifactsDir,
    charge: () => true,
    admit: () => true,
    renewLease: () => true,
    signal: ctrl.signal,
    persistPartial: () => {},
    progress: () => {},
    now: () => Date.now(),
  };
}

describe("HARDENING_5 H5-D7/D8/D10: verify/regress outcome truth", () => {
  it(
    "reproduced verify leaves a CONFIRMED finding open and regress keeps clean/error/executed distinct",
    { timeout: 180_000 },
    async () => {
      const base = fresh("truth");
      const artifactsDir = join(base, "artifacts");
      const items: WorkItem[] = [
        {
          id: "fake-producer",
          priority: 1,
          mode: "hunt",
          target: "fake",
          adapterFamily: "fake",
          seed: 22,
          steps: 30,
          budgets: { maxActions: 60, maxWallMs: 90_000 },
        },
      ];
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items,
          usagePerStep: USAGE,
          executor,
          keepItemWorkspaces: true,
        },
        artifactsDir,
      );
      try {
        const report = await campaign.run();
        expect(report.failed, JSON.stringify(report.failureDetails)).toEqual([]);
        expect(report.completed).toEqual(["fake-producer"]);

        const wsBase = join(artifactsDir, "items", "fake-producer", "1", ".inspector");
        const store = Store.open(join(wsBase, "runs.db"));
        try {
          const confirmed = store.listFindings(100).filter((f) => f.status === "CONFIRMED");
          expect(confirmed.length).toBeGreaterThanOrEqual(1);

          // Direct executor invocation so we can read verify/regress notes.
          const verifyItem: WorkItem = {
            id: "fake-verify",
            priority: 2,
            mode: "verify",
            target: "fake",
            adapterFamily: "fake",
            seed: 22,
            steps: 1,
            targetConfig: { sourceItemId: "fake-producer", attempts: 2 },
          };
          const verifyCtx = makeCtx(artifactsDir, join(base, "ws-verify"), "fake-verify");
          const verifyResult: WorkItemResult = await executor.execute(verifyItem, verifyCtx);
          const verifyNotes = verifyResult.notes?.verify as
            | { classification: string; reproducedCount: number; errorCount: number; cleanCount: number }
            | undefined;
          expect(verifyNotes).toBeDefined();
          // D7: the fake driver reproduces, so verify must classify
          // "reproduced" and NOT resolve the finding.
          expect(verifyNotes!.classification).toBe("reproduced");
          expect(verifyNotes!.reproducedCount).toBeGreaterThanOrEqual(1);
          expect(verifyNotes!.errorCount).toBe(0);

          const stillConfirmed = store.listFindings(100).filter((f) => f.status === "CONFIRMED");
          expect(stillConfirmed.length).toBeGreaterThanOrEqual(1);

          const regressItem: WorkItem = {
            id: "fake-regress",
            priority: 3,
            mode: "regress",
            target: "fake",
            adapterFamily: "fake",
            seed: 22,
            steps: 1,
            targetConfig: { sourceItemId: "fake-producer" },
          };
          const regressCtx = makeCtx(artifactsDir, join(base, "ws-regress"), "fake-regress");
          const regressResult: WorkItemResult = await executor.execute(regressItem, regressCtx);
          const regressNotes = regressResult.notes?.regress as
            | { scenariosReplayed: number; executed: number; reproduced: number; clean: number; errors: number }
            | undefined;
          expect(regressNotes).toBeDefined();
          // D8: clean/error/executed are distinct; the reproducing fake driver
          // yields reproduced > 0 and clean === 0, and executed is the honest
          // sum of valid scenarios (never counting errors as clean).
          expect(regressNotes!.executed).toBe(regressNotes!.reproduced + regressNotes!.clean);
          expect(regressNotes!.clean).toBe(0);
          expect(regressNotes!.reproduced).toBeGreaterThanOrEqual(1);
          expect(regressNotes!.errors).toBe(0);
        } finally {
          store.close();
        }
      } finally {
        campaign.dispose();
      }
    },
  );

  it("regress with no retained source workspace is refused, never reported as clean", async () => {
    const base = fresh("missing-src");
    const artifactsDir = join(base, "artifacts");
    const executor = new InspectorWorkflowExecutor({ campaignId: base });
    const regressItem: WorkItem = {
      id: "regress-orphan",
      priority: 1,
      mode: "regress",
      target: "fake",
      adapterFamily: "fake",
      seed: 1,
      steps: 1,
      targetConfig: { sourceItemId: "does-not-exist" },
    };
    const ctx = makeCtx(artifactsDir, join(base, "ws"), "regress-orphan");
    const result: WorkItemResult = await executor.execute(regressItem, ctx);
    // No retained producer workspace: refused with a typed class, never an
    // OK-clean regression result.
    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe("target-incompatible");
  });
});
