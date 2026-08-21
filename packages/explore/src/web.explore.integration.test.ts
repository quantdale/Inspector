import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { RunManager } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { ExploreController, WebReplayDriver } from "@inspector/explore";
import { webAdapterSpawn } from "@inspector/adapter-web";

function makeWorkspace(): {
  store: Store;
  artifacts: ArtifactStore;
  close: () => void;
} {
  const base = mkdtempSync(join(tmpdir(), "insp-explore-"));
  const store = Store.open(join(base, "runs.db"));
  const artifacts = new ArtifactStore(join(base, "artifacts"));
  return { store, artifacts, close: () => store.close() };
}

describe("M3 autonomous web exploration", () => {
  it("discovers multiple hidden seeded defects with reproducible evidence", async () => {
    const ws = makeWorkspace();
    try {
      const mgr = new RunManager(ws.store, ws.artifacts);
      const run = await mgr.startRun(webAdapterSpawn());
      const findingEngine = new FindingEngine(
        OracleEngine.defaults(),
        ws.store,
      );

      const controller = new ExploreController({
        run,
        store: ws.store,
        findingEngine,
        config: {
          seed: 7,
          maxActions: 200,
          maxWallMs: 150000,
          maxFindings: 4,
          maxResets: 40,
          reproducibleAttempts: 2,
          reproducibleMinSuccesses: 1,
          enableFaultInjection: false,
          noveltyPlateauLimit: 50,
        },
        replayDriverFactory: () => new WebReplayDriver(),
      });

      const result = await controller.run_();

      // Multiple distinct hidden defects discovered (not hand-authored paths).
      const distinctDefects = new Set(result.anomalies.map((a) => a.classKey));
      expect(result.anomalies.length).toBeGreaterThanOrEqual(2);
      expect(distinctDefects.size).toBeGreaterThanOrEqual(2);

      // And they are reproduced + confirmed with evidence bundles.
      expect(result.findings.length).toBeGreaterThanOrEqual(2);
      expect(result.evidenceBundles.length).toBe(result.findings.length);
      expect(result.findings.every((f) => f.status === "CONFIRMED")).toBe(true);

      await run.close();
    } finally {
      ws.close();
    }
  }, 600000);

  it("is deterministic for a given seed", async () => {
    async function runOnce(seed: number): Promise<string[]> {
      const ws = makeWorkspace();
      try {
        const mgr = new RunManager(ws.store, ws.artifacts);
        const run = await mgr.startRun(webAdapterSpawn());
        const findingEngine = new FindingEngine(
          OracleEngine.defaults(),
          ws.store,
        );
        const controller = new ExploreController({
          run,
          store: ws.store,
          findingEngine,
          config: {
            seed,
            maxActions: 140,
            maxWallMs: 120000,
            maxFindings: 4,
            maxResets: 40,
            skipReproduction: true,
            noveltyPlateauLimit: 50,
          },
          replayDriverFactory: () => new WebReplayDriver(),
        });
        const result = await controller.run_();
        await run.close();
        return result.anomalies.map((a) => a.classKey).sort();
      } finally {
        ws.close();
      }
    }

    const a = await runOnce(123);
    const b = await runOnce(123);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(b).toEqual(a);
  }, 600000);
});
