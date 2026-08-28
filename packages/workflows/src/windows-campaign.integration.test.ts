import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem } from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";

/**
 * HARDENING_5 H5.3: the Windows/UIA fleet lane is REAL end to end. The
 * generic native plumbing (manifest → routing → workflow → adapter spawn →
 * UIA backend → evidence → replay) executes a campaign producer plus
 * verify/regress consumers with durable `windows-uia` identity and recorded
 * backend provenance.
 *
 * Deterministic coverage pins INSPECTOR_WINDOWS_BACKEND=mock (the seeded
 * SeedBank dialog), which is exactly the backend the workflow layer records
 * and the platform-faithful WindowsUiaReplayDriver reconstructs. Hosted
 * Windows runners with an interactive desktop execute the same lane against
 * the real UIA bridge via auto selection; unavailable environments are
 * refused at routing as capability-unavailable — never faked.
 */

const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-h5-windows-${name}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows WAL handle lag must not mask results */
    }
  }
});

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

describe("HARDENING_5 H5.3: windows/uia campaign truth", () => {
  it(
    "runs manifest producer + verify + regress through the windows-uia family with durable backend provenance",
    { timeout: 300_000 },
    async () => {
      const prev = process.env.INSPECTOR_WINDOWS_BACKEND;
      process.env.INSPECTOR_WINDOWS_BACKEND = "mock";
      const base = fresh("campaign");
      const items: WorkItem[] = [
        {
          id: "windows-producer",
          priority: 1,
          mode: "hunt",
          target: "windows",
          adapterFamily: "windows",
          targetUri: "SeedBank",
          seed: 11,
          steps: 4,
          budgets: { maxActions: 60, maxWallMs: 120_000 },
        },
        {
          id: "windows-verify",
          priority: 2,
          mode: "verify",
          target: "windows",
          adapterFamily: "windows",
          seed: 11,
          steps: 1,
          targetConfig: { sourceItemId: "windows-producer" },
        },
        {
          id: "windows-regress",
          priority: 3,
          mode: "regress",
          target: "windows",
          adapterFamily: "windows",
          seed: 11,
          steps: 1,
          targetConfig: { sourceItemId: "windows-producer" },
        },
      ];
      const campaign = new UnattendedCampaign(
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
      try {
        const report = await campaign.run();
        expect(report.failed, JSON.stringify(report.failureDetails)).toEqual([]);
        expect(report.completed.sort()).toEqual([
          "windows-producer",
          "windows-regress",
          "windows-verify",
        ]);

        const wsBase = join(base, "artifacts", "items", "windows-producer", "1", ".inspector");
        const { Store } = await import("@inspector/store-sqlite");
        const store = Store.open(join(wsBase, "runs.db"));
        let findingId = "";
        try {
          const runs = store.listRuns(10);
          expect(runs[0]?.adapter).toBe("windows-uia");
          const environment = store.getEnvironmentForRun(runs[0]!.id);
          expect(environment?.adapter).toBe("windows-uia");
          const createOptions = JSON.parse(environment?.create_options ?? "{}") as Record<string, unknown>;
          expect(createOptions.titleContains).toBe("SeedBank");
          // Backend provenance recorded durably for faithful replay.
          const spawnEnv = JSON.parse(environment?.spawn_env ?? "{}") as Record<string, unknown>;
          expect(spawnEnv.INSPECTOR_WINDOWS_BACKEND).toBe("mock");
          const confirmed = store.listFindings(100).filter((f) => f.status === "CONFIRMED");
          if (confirmed.length > 0) {
            findingId = confirmed[0]!.id;
            expect(confirmed[0]!.adapter ?? "windows-uia").toBe("windows-uia");
            expect(existsSync(join(wsBase, "bundles", runs[0]!.id, `${findingId}.json`))).toBe(true);
          }

          if (findingId !== "") {
            // Platform-faithful reproduction through the SAME construction
            // verify/regress use: WindowsUiaReplayDriver over the mock.
            const { loadReplaySubject, replayDriverFor } = await import("./replay-subject.js");
            const subject = loadReplaySubject(store, wsBase, findingId);
            const driver = await replayDriverFor(subject, wsBase);
            const result = await driver.replay(subject.bundle.minimizedSteps);
            const evaluation = await import("@inspector/finding").then((m) =>
              m.OracleEngine.defaults().evaluate(result),
            );
            expect(evaluation.reproduced).toBe(true);
          }
        } finally {
          store.close();
        }
      } finally {
        campaign.dispose();
        if (prev === undefined) delete process.env.INSPECTOR_WINDOWS_BACKEND;
        else process.env.INSPECTOR_WINDOWS_BACKEND = prev;
      }
    },
  );

  it("records honest real-backend provenance under auto when the UIA bridge is available", { timeout: 120_000 }, async () => {
    const prev = process.env.INSPECTOR_WINDOWS_BACKEND;
    delete process.env.INSPECTOR_WINDOWS_BACKEND;
    const base = fresh("auto-provenance");
    // Use the exact cached capability snapshot that the campaign will route
    // against. A second independent UIA probe can disagree under a loaded
    // desktop broker and would make the assertion test the probe race rather
    // than the campaign's honest refusal/provenance contract.
    const executor = new InspectorWorkflowExecutor({ campaignId: base });
    const realAvailable = (await executor.capabilities()).families.includes("windows");
    const items: WorkItem[] = [
      {
        id: "windows-probe",
        priority: 1,
        mode: "hunt",
        target: "windows",
        adapterFamily: "windows",
        targetUri: "DefinitelyNotARealWindow",
        seed: 5,
        steps: 2,
        budgets: { maxActions: 3, maxWallMs: 45_000 },
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
      if (!realAvailable) {
        // No UIA bridge: refused at routing, never faked.
        expect(report.completed).toEqual([]);
        expect(report.refusals[0]).toMatchObject({
          itemId: "windows-probe",
          class: "capability-unavailable",
        });
      } else {
        // Real bridge: the item RUNS (target-miss is an honest failure or
        // clean exhaustion) and durable provenance records 'real'.
        expect(report.refusals).toEqual([]);
        const wsBase = join(base, "artifacts", "items", "windows-probe", "1", ".inspector");
        const { Store } = await import("@inspector/store-sqlite");
        const store = Store.open(join(wsBase, "runs.db"));
        try {
          const run = store.listRuns(10)[0];
          expect(run?.adapter).toBe("windows-uia");
          const environment = store.getEnvironmentForRun(run!.id);
          const spawnEnv = JSON.parse(environment?.spawn_env ?? "{}") as Record<string, unknown>;
          expect(spawnEnv.INSPECTOR_WINDOWS_BACKEND).toBe("real");
        } finally {
          store.close();
        }
      }
    } finally {
      campaign.dispose();
      if (prev !== undefined) process.env.INSPECTOR_WINDOWS_BACKEND = prev;
    }
  });
});
