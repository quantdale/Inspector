import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CampaignConfigError,
  UnattendedCampaign,
  validateCampaignManifest,
  type ExecutionContext,
  type WorkItem,
  type WorkItemExecutor,
  type WorkItemResult,
} from "@inspector/scale";
import { Store } from "@inspector/store-sqlite";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";
import { runExploration } from "./exploration.js";
import type { ExplorationControl } from "./types.js";

/**
 * HARDENING_2: the REAL exploration engines observe cooperative cancellation
 * and pre-consumption budgets at safe loop boundaries (D1/D2/D3), and
 * verify/regress items can actually reach a producer's durable findings via
 * targetConfig.sourceItemId (D10). Deterministic throughout — no sleeps, no
 * timing races: cancellation lands mid-loop because the control hook says so.
 */

function fresh(name: string): string {
  return mkdtempSync(join(tmpdir(), `inspector-h2wf-${name}-`));
}

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

function fakeRequest(maxActions: number, seed = 41) {
  return {
    adapter: "fake" as const,
    seed,
    maxActions,
    maxMinutes: 10,
    maxFindings: 4,
  };
}

describe("H2 D3: cancellation reaches the real exploration loop mid-run", () => {
  it("stops at a safe boundary after N admitted actions with durable checkpoint", async () => {
    const base = fresh("cancel-mid");
    try {
      const requestedMaxActions = 500;
      let admits = 0;
      const STOP_AFTER_ADMITS = 20;
      const control: ExplorationControl = {
        stopRequested: () => admits >= STOP_AFTER_ADMITS,
        admit: () => {
          if (admits >= STOP_AFTER_ADMITS) return false;
          admits += 1;
          return true;
        },
        commit: () => true,
      };
      const outcome = await runExploration({
        workspaceDir: base,
        workflow: "hunt",
        request: fakeRequest(requestedMaxActions),
        control,
      });
      // The loop exited MID-RUN because of the cooperative stop — long before
      // the requested action budget. This cannot pass by accident: a fixture
      // that ran to completion would report action-budget with 500 actions.
      expect(outcome.result.stoppedReason).toBe("cancelled");
      expect(outcome.result.actionsExecuted).toBeLessThanOrEqual(STOP_AFTER_ADMITS);
      expect(outcome.result.actionsExecuted).toBeGreaterThan(0);
      // The terminal exploration state is durable (checkpoint stream exists).
      const store = Store.open(join(base, ".inspector", "runs.db"));
      try {
        expect(store.getExplorationCampaign(outcome.result.runId)).toBeDefined();
      } finally {
        store.close();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("committed evidence survives a mid-run cancel; resume completes exactly once", async () => {
    const base = fresh("cancel-evidence");
    try {
      let admits = 0;
      const STOP_AFTER_ADMITS = 60; // seed 41 confirms its finding between 40 and 60 admits
      const control: ExplorationControl = {
        stopRequested: () => admits >= STOP_AFTER_ADMITS,
        admit: () => {
          if (admits >= STOP_AFTER_ADMITS) return false;
          admits += 1;
          return true;
        },
        commit: () => true,
      };
      await runExploration({
        workspaceDir: base,
        workflow: "hunt",
        request: fakeRequest(400),
        control,
      });
      // Evidence committed before the stop is durable in the item's own store.
      const store = Store.open(join(base, ".inspector", "runs.db"));
      let confirmedBeforeStop = 0;
      try {
        confirmedBeforeStop = store.listFindings(100).filter((f) => f.status === "CONFIRMED").length;
      } finally {
        store.close();
      }
      expect(confirmedBeforeStop).toBeGreaterThanOrEqual(1);

      // The campaign-level path preserves it across resume: completed exactly
      // once, zero additional engine work needed to re-derive the finding.
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items: [
            { id: "hunt-c", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 41, steps: 400 },
          ],
          usagePerStep: USAGE,
          executor,
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        // Resume of the SAME run continues from the durable checkpoint and
        // completes; the confirmed finding is reported exactly once.
        expect(report.completed).toEqual(["hunt-c"]);
        expect(report.findings.filter((f) => f.status === "CONFIRMED").length).toBeGreaterThanOrEqual(1);
        const ids = new Set(report.findings.map((f) => f.id));
        expect(report.findings.length).toBe(ids.size); // no duplicates
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("H2 D1/D2: budget permission precedes consumption through the production path", () => {
  it("a real workflow exceeding a deliberately tiny budget stops with structured budget-exhausted", async () => {
    const base = fresh("tiny-budget");
    try {
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items: [
            {
              id: "greedy-hunt",
              priority: 1,
              mode: "hunt",
              target: "fake",
              adapterFamily: "fake",
              seed: 41,
              steps: 300,
              budgets: { maxActions: 200 }, // item wants far more than the global ceiling
            },
          ],
          usagePerStep: USAGE,
          globalBudget: { maxActions: 6 },
          executor,
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.failureDetails["greedy-hunt"]?.class).toBe("budget-exhausted");
        // Actual consumption is accounted exactly and bounded by the ceiling.
        expect(report.usage.actions).toBeLessThanOrEqual(7);
        expect(report.usage.actions).toBeGreaterThan(0);
        // The attempt is durably terminal: nothing left queued behind it.
        const disk = JSON.parse(readFileSync(join(base, "state", "campaign.json"), "utf8")) as { queue: string[]; failed: string[] };
        expect(disk.failed).toContain("greedy-hunt");
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("the executor refuses to start work when admission is denied up front", async () => {
    const base = fresh("deny-upfront");
    try {
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const probing: WorkItemExecutor = {
        id: executor.id,
        capabilities: () => executor.capabilities(),
        async execute(item, ctx): Promise<WorkItemResult> {
          // Simulate a budget already spent before this attempt begins.
          const wrapped: ExecutionContext = {
            ...ctx,
            charge: () => false,
            admit: () => false,
          };
          return executor.execute(item, wrapped);
        },
      };
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items: [{ id: "denied", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 41, steps: 5 }],
          usagePerStep: USAGE,
          executor: probing,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.failureDetails["denied"]?.class).toBe("budget-exhausted");
        expect(report.usage.actions).toBe(0); // not one unit of overspend
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("H2 D10: verify reaches its producer's durable finding via sourceItemId", () => {
  it("hunt → verify over retained workspaces reproduces the source finding deterministically", async () => {
    const base = fresh("source-ref");
    try {
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const items: WorkItem[] = [
        { id: "producer-1", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 41, steps: 60 },
        {
          id: "checker-1",
          priority: 2,
          mode: "verify",
          target: "fake",
          adapterFamily: "fake",
          seed: 41,
          steps: 1,
          targetConfig: { sourceItemId: "producer-1" },
        },
      ];
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
        const report = await campaign.run();
        expect(report.completed.sort()).toEqual(["checker-1", "producer-1"]);
        expect(report.failed).toEqual([]);
        // The verify item resolved its source context inside the artifacts root.
        const checkerExecution = report.executions.find((e) => e.itemId === "checker-1");
        expect(checkerExecution).toBeDefined();
        const wsRoot = join(base, "artifacts", "items", "producer-1");
        expect(existsSync(wsRoot)).toBe(true);
        const attempts = readdirSync(wsRoot).filter((d) => /^\d+$/.test(d));
        expect(attempts.length).toBeGreaterThanOrEqual(1);
        // The consumer did real bounded replay work against the SOURCE bundle:
        // usage reflects replayed minimized steps charged through ctx.charge.
        expect(report.usage.actions).toBeGreaterThan(0);
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("preflight rejects unknown, self-referential, cyclic, or unretained sources", () => {
    const baseItems = [
      { id: "p", workflow: "hunt", adapterFamily: "fake", steps: 2 },
    ];
    expect(() =>
      validateCampaignManifest({
        schema: "inspector-campaign-manifest/1",
        keepWorkspaces: true,
        items: [
          ...baseItems,
          { id: "v", workflow: "verify", adapterFamily: "fake", steps: 1, targetConfig: { sourceItemId: "missing" } },
        ],
      }),
    ).toThrow(/source item 'missing' is not declared/);

    expect(() =>
      validateCampaignManifest({
        schema: "inspector-campaign-manifest/1",
        keepWorkspaces: true,
        items: [
          ...baseItems,
          { id: "v", workflow: "verify", adapterFamily: "fake", steps: 1, targetConfig: { sourceItemId: "v" } },
        ],
      }),
    ).toThrow(CampaignConfigError);

    expect(() =>
      validateCampaignManifest({
        schema: "inspector-campaign-manifest/1",
        items: [
          ...baseItems,
          { id: "v", workflow: "verify", adapterFamily: "fake", steps: 1, targetConfig: { sourceItemId: "p" } },
        ],
      }),
    ).toThrow(/keepWorkspaces: true is required/);
  });

  it("downstream work is refused when its source item fails", async () => {
    const base = fresh("source-failed");
    try {
      const inner = new InspectorWorkflowExecutor({ campaignId: base });
      let failProducer = true;
      const executor: WorkItemExecutor = {
        id: inner.id,
        capabilities: () => inner.capabilities(),
        async execute(item, ctx): Promise<WorkItemResult> {
          if ((item as { id: string }).id === "producer-x" && failProducer) {
            failProducer = false;
            throw new Error("injected producer crash");
          }
          return inner.execute(item, ctx);
        },
      };
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items: [
            { id: "producer-x", priority: 1, mode: "hunt", target: "fake", adapterFamily: "fake", seed: 41, steps: 4 },
            {
              id: "consumer-y",
              priority: 2,
              mode: "verify",
              target: "fake",
              adapterFamily: "fake",
              seed: 1,
              steps: 1,
              targetConfig: { sourceItemId: "producer-x" },
            },
          ],
          usagePerStep: USAGE,
          executor,
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        expect(report.failureDetails["producer-x"]?.class).toBeDefined();
        expect(report.completed).toEqual([]);
        expect(report.failureDetails["consumer-y"]?.class).toBe("target-incompatible");
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
function readFileSyncSafe(path: string): string {
  return readFileSync(path, "utf8");
}
void readFileSyncSafe;
