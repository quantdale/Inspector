import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem } from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";

/**
 * HARDENING_5 H5-D0 regression: an Electron campaign item accepted by an
 * Electron-capable executor must execute as ELECTRON — never as fake/web via
 * a silent family fallback. Before H5, `familyAdapter()` collapsed electron
 * to the fake walker and reported a successful run whose durable adapter,
 * environment, evidence, and result notes all claimed `adapter-fake`.
 */

const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-h5-electron-${name}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("HARDENING_5 H5-D0: electron fleet execution truth", () => {
  it(
    "executes an accepted electron hunt item with durable electron identity (never fake)",
    { timeout: 240_000 },
    async () => {
      const base = fresh("identity");
      const items: WorkItem[] = [
        {
          id: "electron-hunt-1",
          priority: 1,
          mode: "hunt",
          target: "electron",
          adapterFamily: "electron",
          seed: 17,
          steps: 4,
          budgets: { maxActions: 10, maxWallMs: 120_000 },
        },
      ];
      // Deterministic injected probe mirrors the repository's injectable-
      // backend pattern: the worker ADVERTISES electron capability exactly
      // like a host with the executable installed.
      const executor = new InspectorWorkflowExecutor({
        campaignId: base,
        probes: { electron: { ok: true, detail: "injected: electron available" } },
      });
      const caps = await executor.capabilities();
      expect(caps.families).toContain("electron");

      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items,
          usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
          executor,
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        expect(report.refusals).toEqual([]);
        expect(report.completed).toEqual(["electron-hunt-1"]);

        const wsBase = join(base, "artifacts", "items", "electron-hunt-1", "1", ".inspector");
        expect(existsSync(join(wsBase, "runs.db"))).toBe(true);
        const { Store } = await import("@inspector/store-sqlite");
        const store = Store.open(join(wsBase, "runs.db"));
        try {
          const runs = store.listRuns(10);
          expect(runs.length).toBeGreaterThanOrEqual(1);
          const run = runs[0]!;
          // The durable RUN identity is Electron — the pre-H5 defect recorded
          // 'adapter-fake' here while the manifest said electron.
          expect(run.adapter).toBe("electron-chromium");
          const meta = JSON.parse(run.meta_json ?? "{}") as {
            request?: { adapter?: string };
            explorerKind?: string;
            campaign?: Record<string, string>;
          };
          expect(meta.request?.adapter).toBe("electron");
          // The explorer engine is the browser-like controller sharing web
          // semantics; identity stays electron through the adapter field.
          expect(meta.explorerKind).toBe("web");
          expect(meta.campaign?.itemId).toBe("electron-hunt-1");

          const environment = store.getEnvironmentForRun(run.id);
          expect(environment).toBeDefined();
          expect(environment?.adapter).toBe("electron-chromium");

          // Bundles live under the electron run id like every other family.
          const bundlesRoot = join(wsBase, "bundles");
          if (existsSync(bundlesRoot)) {
            const [runDir] = readdirSync(bundlesRoot);
            expect(runDir).toBe(run.id);
          }
        } finally {
          store.close();
        }

        // Operator-visible result notes agree with the durable identity.
        const assignments = report.assignments ?? [];
        const noteBlock = assignments.length > 0 ? JSON.stringify(assignments) : "";
        if (noteBlock.includes('"notes"')) {
          expect(noteBlock).toContain('"adapter": "electron"');
          expect(noteBlock).not.toContain('"adapter": "fake"');
        }
        expect(report.usage.actions).toBeGreaterThan(0);
      } finally {
        campaign.dispose();
      }
    },
  );

  it("refuses an electron item honestly when no electron backend is available (never fake fallback)", { timeout: 60_000 }, async () => {
    const base = fresh("refusal");
    const items: WorkItem[] = [
      {
        id: "electron-hunt-2",
        priority: 1,
        mode: "hunt",
        target: "electron",
        adapterFamily: "electron",
        seed: 3,
        steps: 2,
      },
    ];
    const executor = new InspectorWorkflowExecutor({
      campaignId: base,
      probes: { electron: { ok: false, detail: "injected: executable absent" } },
    });
    const caps = await executor.capabilities();
    expect(caps.families).not.toContain("electron");
    const campaign = new UnattendedCampaign(
      {
        stateDir: join(base, "state"),
        workerCount: 1,
        items,
        usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
        executor,
      },
      join(base, "artifacts"),
    );
    try {
      const report = await campaign.run();
      expect(report.completed).toEqual([]);
      expect(report.refusals).toHaveLength(1);
      expect(report.refusals[0]).toMatchObject({
        itemId: "electron-hunt-2",
        class: "capability-unavailable",
      });
    } finally {
      campaign.dispose();
    }
  });

  it("rejects external-target forms on electron items at preflight (seeded fixture is the only supported contract)", { timeout: 60_000 }, async () => {
    const base = fresh("target-refusal");
    const items: WorkItem[] = [
      {
        id: "electron-hunt-3",
        priority: 1,
        mode: "hunt",
        target: "electron",
        adapterFamily: "electron",
        targetUri: "C:/apps/MyApp.exe",
        seed: 3,
        steps: 2,
      },
    ];
    const executor = new InspectorWorkflowExecutor({
      campaignId: base,
      probes: { electron: { ok: true, detail: "injected: electron available" } },
    });
    const campaign = new UnattendedCampaign(
      {
        stateDir: join(base, "state"),
        workerCount: 1,
        items,
        usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
        executor,
      },
      join(base, "artifacts"),
    );
    try {
      const report = await campaign.run();
      expect(report.completed).toEqual([]);
      expect(report.failed).toEqual(["electron-hunt-3"]);
      expect(Object.values(report.failureDetails).map((f) => f.class)).toContain("target-config-invalid");
    } finally {
      campaign.dispose();
    }
  });
});
