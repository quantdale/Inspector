import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem } from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";

/**
 * M12 F8: real CLI/PTY portfolio leg. Gated behind INSPECTOR_M12_PTY_E2E=1
 * so default CI stays deterministic (real ConPTY suites elsewhere cover the
 * backend itself); run explicitly to prove the campaign drives a REAL
 * terminal program end-to-end through the standard pipeline.
 */
describe("M12 F8: real CLI/PTTY campaign portfolio leg", () => {
  it("drives a real terminal program as a campaign item when gated on", { timeout: 240_000 }, async () => {
    if (process.env.INSPECTOR_M12_PTY_E2E !== "1") {
      return; // honest skip: real-terminal legs run under the env gate
    }
    const base = mkdtempSync(join(tmpdir(), "inspector-m12-pty-"));
    try {
      const items: WorkItem[] = [
        {
          id: "pty-hunt-1",
          priority: 1,
          mode: "hunt",
          target: "cli",
          adapterFamily: "cli",
          targetUri: "seedcli",
          seed: 13,
          steps: 2,
          budgets: { maxActions: 6, maxWallMs: 90_000 },
        },
      ];
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const caps = await executor.capabilities();
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items,
          usagePerStep: { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 },
          executor,
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        if (!caps.families.includes("cli")) {
          expect(report.refusals).toHaveLength(1);
          expect(report.refusals[0]).toMatchObject({ class: "capability-unavailable" });
        } else {
          expect(report.completed).toEqual(["pty-hunt-1"]);
          expect(report.usage.actions).toBeGreaterThan(0);
          // Real PTY evidence lands in the retained workspace store.
          const wsDb = join(base, "artifacts", "items", "pty-hunt-1", "1", ".inspector", "runs.db");
          const { Store } = await import("@inspector/store-sqlite");
          const store = Store.open(wsDb);
          try {
            expect(store.listRuns(10).length).toBeGreaterThanOrEqual(1);
            expect(store.countRunActions(store.listRuns(10)[0]!.id)).toBeGreaterThan(0);
          } finally {
            store.close();
          }
        }
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
