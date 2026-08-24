import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  UnattendedCampaign,
  StateCorruptionError,
  ResourceLedger,
  type WorkItem,
  type WorkItemExecutor,
  type WorkItemResult,
} from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";

/**
 * M12 F5: restart/recovery guarantees survive REAL-work execution. The fake
 * fixture soak (SOAK-J1) proves scheduler-level exactly-once under lease
 * chaos; this matrix proves the same guarantees when items run the actual
 * exploration engines through @inspector/workflows: abrupt termination between
 * evidence persistence and completion recording, ledger/budget continuity
 * across controller lives, corrupted-state fail-closed behavior, terminal
 * campaigns refusing duplicate work, and stop/resume determinism.
 */

function fresh(name: string): string {
  return mkdtempSync(join(tmpdir(), `inspector-m12-restart-${name}-`));
}

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

describe("M12 F5: restart matrix over real-workflow execution", () => {
  it("dies between evidence persistence and completion recording; restarted controller completes exactly once with budget continuity", { timeout: 240_000 }, async () => {
    const base = fresh("after-work");
    try {
      const items: WorkItem[] = [
        { id: "hunt-fake-1", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 41, steps: 12 },
      ];
      // One shared hook across ALL controller lives: exactly one simulated
      // death, then normal execution for the retry.
      let died = false;
      const innerExecutor = new InspectorWorkflowExecutor({ campaignId: base });
      const hooked: WorkItemExecutor = {
        id: innerExecutor.id,
        capabilities: () => innerExecutor.capabilities(),
        async execute(item, ctx): Promise<WorkItemResult> {
          const result = await innerExecutor.execute(item, ctx);
          if (!died && result.ok) {
            died = true;
            throw new Error("simulated abrupt controller death after evidence persistence");
          }
          return result;
        },
      };
      const makeCampaign = (): UnattendedCampaign =>
        new UnattendedCampaign(
          {
            stateDir: join(base, "state"),
            workerCount: 1,
            items,
            usagePerStep: USAGE,
            globalBudget: { maxActions: 400 },
            executor: hooked,
            keepItemWorkspaces: true,
          },
          join(base, "artifacts"),
        );

      let campaign = makeCampaign();
      // Life 1: evidence becomes durable in the item's own store/workspace,
      // then the controller "dies" before any completion is recorded.
      const report1 = await campaign.run();
      campaign.dispose();
      expect(report1.completed).toEqual([]);
      const wsRootLife1 = join(base, "artifacts", "items", "hunt-fake-1");
      const attemptsLife1 = readdirSync(wsRootLife1);
      let life1Findings = 0;
      for (const attempt of attemptsLife1) {
        const runsDb = join(wsRootLife1, attempt, ".inspector", "runs.db");
        if (!existsSync(runsDb)) continue;
        const { Store } = await import("@inspector/store-sqlite");
        const itemStore = Store.open(runsDb);
        try {
          const runs = itemStore.listRuns(10);
          for (const r of runs) life1Findings += itemStore.listFindings(100).filter((f) => f.runId === r.id).length;
        } finally {
          itemStore.close();
        }
      }
      expect(life1Findings).toBeGreaterThanOrEqual(1); // evidence survived the death
      const ledgerAfterLife1 = new ResourceLedger(join(base, "state")).totals().actions;
      expect(ledgerAfterLife1).toBeGreaterThan(0);

      // Life 2: fresh controller requeues the un-executed item and finishes.
      campaign = makeCampaign();
      try {
        const report2 = await campaign.run();
        expect(report2.completed).toEqual(["hunt-fake-1"]);
        expect(report2.executions.filter((e) => e.itemId === "hunt-fake-1")).toHaveLength(1);
        // Budget did NOT reset across lives: totals include both lives' spend.
        const totalsAfterLife2 = new ResourceLedger(join(base, "state")).totals().actions;
        expect(totalsAfterLife2).toBeGreaterThan(ledgerAfterLife1);

        // A retained attempt workspace holds standard evidence bundles.
        const wsRoot = join(base, "artifacts", "items", "hunt-fake-1");
        const attempts = readdirSync(wsRoot);
        expect(attempts.length).toBeGreaterThanOrEqual(1);
        for (const attempt of attempts) {
          const bundlesRoot = join(wsRoot, attempt, ".inspector", "bundles");
          if (!existsSync(bundlesRoot)) continue;
          const [runDir] = readdirSync(bundlesRoot);
          if (!runDir) continue;
          const files = readdirSync(join(bundlesRoot, runDir));
          if (files.length === 0) continue;
          const bundle = JSON.parse(readFileSync(join(bundlesRoot, runDir, files[0]!), "utf8")) as {
            schema?: string;
          };
          expect(bundle.schema).toBe("inspector-evidence/1");
        }
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("corrupted durable campaign state fails closed instead of resetting", () => {
    const base = fresh("corrupt-state");
    try {
      writeFileSync(join(base, "campaign.json"), "{ truncated...", "utf8");
      const items: WorkItem[] = [
        { id: "x", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 },
      ];
      expect(
        () =>
          new UnattendedCampaign({
            stateDir: base,
            workerCount: 1,
            items,
            usagePerStep: USAGE,
          }),
      ).toThrow(StateCorruptionError);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("terminal campaigns refuse inappropriate re-execution of completed work", { timeout: 120_000 }, async () => {
    const base = fresh("terminal");
    try {
      const items: WorkItem[] = [
        { id: "hunt-done", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 9, steps: 8 },
      ];
      const makeCampaign = (): UnattendedCampaign =>
        new UnattendedCampaign(
          {
            stateDir: join(base, "state"),
            workerCount: 1,
            items,
            usagePerStep: USAGE,
            executor: new InspectorWorkflowExecutor({ campaignId: base }),
            keepItemWorkspaces: true,
          },
          join(base, "artifacts"),
        );
      let campaign = makeCampaign();
      const first = await campaign.run();
      campaign.dispose();
      expect(first.completed).toEqual(["hunt-done"]);

      // A restarted controller over the terminal campaign executes nothing.
      campaign = makeCampaign();
      try {
        const second = await campaign.run();
        expect(second.completed.sort()).toEqual(["hunt-done"]);
        expect(second.executions.filter((e) => e.itemId === "hunt-done")).toHaveLength(1);
        expect(second.usage.actions).toBe(first.usage.actions); // zero additional spend
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("stop produces a deterministic final state and resume never repeats completed work", { timeout: 180_000 }, async () => {
    const base = fresh("stop-race");
    try {
      const items: WorkItem[] = [
        { id: "hunt-stop-1", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 77, steps: 40 },
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
        join(base, "artifacts"),
      );
      try {
        const runPromise = campaign.run();
        await new Promise((r) => setTimeout(r, 120));
        campaign.stop("operator-stop");
        const stoppedReport = await runPromise;
        // Deterministic final state regardless of where the stop landed:
        // completed work counts once, nothing is duplicated or lost.
        expect(stoppedReport.stopReason).toBe("operator-stop");
        expect(stoppedReport.executions.filter((e) => e.itemId === "hunt-stop-1").length).toBeLessThanOrEqual(1);

        campaign.resume();
        const resumed = await campaign.run();
        expect(resumed.completed).toEqual(["hunt-stop-1"]);
        expect(resumed.executions.filter((e) => e.itemId === "hunt-stop-1")).toHaveLength(1);
        // Budget accounting is monotonic: real executed actions are charged
        // exactly once regardless of how many lives the controller needed.
        expect(resumed.usage.actions).toBe(40 * 3);
        expect(resumed.usage.actions).toBeGreaterThanOrEqual(stoppedReport.usage.actions);
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
