import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem } from "@inspector/scale";
import { PolicyEngine, RunManager } from "@inspector/core";
import { ElectronReplayDriver } from "@inspector/electron-adapter";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { EXPLORER_VERSION, ExploreController } from "@inspector/explore";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";
import { runExploration } from "./exploration.js";
import { loadReplaySubject, replayDriverFor } from "./replay-subject.js";
import { openWorkspace, adapterSpawn } from "./workspace.js";
import { huntPolicy, webExploreConfig } from "./configs.js";
import { buildDurableHuntMeta } from "./meta.js";

/**
 * HARDENING_5 H5.4: Electron replay / verify / regress / resume continuity.
 * Accepted Electron findings must reproduce through the ELECTRON adapter
 * (durable `electron-chromium` provenance), never through web or fake, and
 * resume must reconstruct the same family/backend/target.
 *
 * Deterministic hermetic coverage pins the injectable backend; real-runtime
 * legs stay in the display-gated/Xvfb lanes.
 */

const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-h5-electron-replay-${name}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows handle lag after a failed case must not mask its result */
    }
  }
});

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

function withInjectableBackend<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.INSPECTOR_ELECTRON_BACKEND;
  process.env.INSPECTOR_ELECTRON_BACKEND = "injectable";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.INSPECTOR_ELECTRON_BACKEND;
    else process.env.INSPECTOR_ELECTRON_BACKEND = prev;
  });
}

function electronCapableExecutor(campaignId: string): InspectorWorkflowExecutor {
  return new InspectorWorkflowExecutor({
    campaignId,
    probes: { electron: { ok: true, detail: "injected: electron available" } },
  });
}

describe("HARDENING_5 H5.4: electron replay/verify/regress/resume", () => {
  it(
    "verify and regress reproduce an electron producer's finding through the electron adapter",
    { timeout: 420_000 },
    async () => {
      await withInjectableBackend(async () => {
        const base = fresh("verify-regress");
        // maxFindings:1 pins exactly one CONFIRMED finding so the verify
        // item's deterministic single-subject selection has no ambiguity.
        const items: WorkItem[] = [
          {
            id: "electron-producer",
            priority: 1,
            mode: "hunt",
            target: "electron",
            adapterFamily: "electron",
            seed: 29,
            steps: 4,
            budgets: { maxActions: 200, maxWallMs: 240_000 },
            targetConfig: { maxFindings: 1 },
          },
          {
            id: "electron-verify",
            priority: 2,
            mode: "verify",
            target: "electron",
            adapterFamily: "electron",
            seed: 29,
            steps: 1,
            targetConfig: { sourceItemId: "electron-producer" },
          },
          {
            id: "electron-regress",
            priority: 3,
            mode: "regress",
            target: "electron",
            adapterFamily: "electron",
            seed: 29,
            steps: 1,
            targetConfig: { sourceItemId: "electron-producer" },
          },
        ];
        const campaign = new UnattendedCampaign(
          {
            stateDir: join(base, "state"),
            workerCount: 1,
            items,
            usagePerStep: USAGE,
            executor: electronCapableExecutor(base),
            keepItemWorkspaces: true,
          },
          join(base, "artifacts"),
        );
        try {
          const report = await campaign.run();
          expect(report.failed, JSON.stringify(report.failureDetails)).toEqual([]);
          expect(report.completed.sort()).toEqual([
            "electron-producer",
            "electron-regress",
            "electron-verify",
          ]);

          // Producer durability: one confirmed ELECTRON finding with a bundle.
          const wsBase = join(base, "artifacts", "items", "electron-producer", "1", ".inspector");
          const { Store } = await import("@inspector/store-sqlite");
          const store = Store.open(join(wsBase, "runs.db"));
          let findingId = "";
          try {
            const runs = store.listRuns(10);
            expect(runs[0]?.adapter).toBe("electron-chromium");
            const confirmed = store.listFindings(100).filter((f) => f.status === "CONFIRMED");
            expect(confirmed.length).toBe(1);
            findingId = confirmed[0]!.id;
            expect(existsSync(join(wsBase, "bundles", runs[0]!.id, `${findingId}.json`))).toBe(true);
          } finally {
            store.close();
          }

          // Platform-faithful reproduction: the SAME driver construction the
          // verify/regress items use resolves an ELECTRON replay driver and
          // reproduces the durable finding through it.
          const producerStore = Store.open(join(wsBase, "runs.db"));
          try {
            const subject = loadReplaySubject(producerStore, wsBase, findingId);
            expect(subject.environment.adapter).toBe("electron-chromium");
            const driver = await replayDriverFor(subject, wsBase);
            const result = await driver.replay(subject.bundle.minimizedSteps);
            const evaluation = OracleEngine.defaults().evaluate(result);
            expect(evaluation.reproduced).toBe(true);
          } finally {
            producerStore.close();
          }
        } finally {
          campaign.dispose();
        }
      });
    },
  );

  it("resume reconstructs the same electron target/backend and refuses incompatible provenance", { timeout: 300_000 }, async () => {
    await withInjectableBackend(async () => {
      const base = fresh("resume");
      const req = {
        adapter: "electron" as const,
        seed: 43,
        maxActions: 30,
        maxMinutes: 3,
        maxFindings: 4,
      };

      // Leg 1: start a REAL electron exploration through the production
      // services, commit a few explorer checkpoints, then simulate abrupt
      // process death — the SQLite handle closes WITHOUT ever closing the run.
      let committed = 0;
      {
        const ws = openWorkspace(base);
        // The production service raises policy budgets above the requested
        // exploration budget (huntPolicy); replicate that here so the stop
        // comes from the injected control, not the default policy ceiling.
        const mgr: RunManager = new RunManager(ws.store, ws.artifacts, new PolicyEngine(huntPolicy(req)));
        const run = await mgr.startRun({
          ...adapterSpawn("electron", { INSPECTOR_ELECTRON_BACKEND: "injectable" }),
          runMeta: buildDurableHuntMeta(req, "hunt"),
          exploration: {
            schemaVersion: 1,
            explorerKind: "web",
            explorerVersion: EXPLORER_VERSION,
            config: webExploreConfig(req),
          },
          spawnEnvDelta: { INSPECTOR_ELECTRON_BACKEND: "injectable" },
        });
        const controller = new ExploreController({
          run,
          store: ws.store,
          findingEngine: new FindingEngine(OracleEngine.defaults(), ws.store),
          config: webExploreConfig(req),
          control: {
            stopRequested: () => committed >= 4,
            admit: () => true,
            commit: () => {
              committed += 1;
              return true;
            },
          },
          replayDriverFactory: () =>
            new ElectronReplayDriver({
              backend: "injectable",
            }),
        });
        const partial = await controller.run_();
        expect(partial.stoppedReason).toBe("cancelled");
        expect(committed).toBeGreaterThanOrEqual(4);
        // Death: durable run row stays non-terminal; no graceful close().
        ws.store.close();
      }

      const { Store } = await import("@inspector/store-sqlite");
      const store = Store.open(join(base, ".inspector", "runs.db"));
      try {
        const runs = store.listRuns(10);
        expect(runs.length).toBeGreaterThanOrEqual(1);
        const record = store.getRun(runs[0]!.id)!;
        expect(record.adapter).toBe("electron-chromium");
        const environment = store.getEnvironmentForRun(record.id);
        expect(environment?.adapter).toBe("electron-chromium");
        const spawnEnv = JSON.parse(environment?.spawn_env ?? "{}") as Record<string, unknown>;
        expect(spawnEnv.INSPECTOR_ELECTRON_BACKEND).toBe("injectable");
        const meta = JSON.parse(record.meta_json ?? "{}") as {
          request?: { adapter?: string };
          explorerKind?: string;
        };
        expect(meta.request?.adapter).toBe("electron");
        expect(meta.explorerKind).toBe("web");

        // Incompatible provenance is refused deterministically (the CLI
        // expresses overrides as resume flags).
        const { WorkflowError } = await import("./errors.js");
        let refused = false;
        try {
          await runExploration({
            workspaceDir: base,
            workflow: "hunt",
            request: {
              adapter: "web",
              seed: 43,
              maxActions: 30,
              maxMinutes: 3,
              maxFindings: 4,
              resumeRunId: record.id,
            },
            resumeFlags: { "--adapter": "web" },
          });
        } catch (err) {
          refused =
            err instanceof WorkflowError &&
            (err.kind === "incompatible-run" || err.kind === "incompatible-override");
        }
        expect(refused).toBe(true);

        // Matching-provenance resume is accepted and continues the SAME run
        // (checkpoint identity holds; no fresh-run creation).
        const resumed = await runExploration({
          workspaceDir: base,
          workflow: "hunt",
          request: { ...req, resumeRunId: record.id },
        });
        expect(resumed.resumed).toBe(true);
        expect(resumed.result.runId).toBe(record.id);
        expect(store.getRun(record.id)?.adapter).toBe("electron-chromium");
      } finally {
        store.close();
      }
    });
  });
});
