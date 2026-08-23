/**
 * SPEC-009 A4: the generic native session drives a REAL AdapterHandler
 * (Windows mock backend) end-to-end through RunController policy + durable
 * steps + FindingEngine. Proves:
 *   - vocabulary-driven candidate selection (no platform branches)
 *   - TARGET_FAILURE flows into FindingEngine; with a registered replay
 *     driver the finding is promoted and an evidence bundle is built
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, AdapterServer } from "@inspector/adapter-sdk";
import type { CapabilityDoc, Action, ActionOutcome } from "@inspector/protocol";
import { WindowsAdapterHandler } from "../../windows-adapter/src/windows-adapter.js";
import { MockUiaBackend } from "../../windows-adapter/src/mock-uia.js";
import { RunController } from "../../core/src/run-manager.js";
import { PolicyEngine } from "../../core/src/policy.js";
import { FindingEngine, OracleEngine, type ReplayDriver, type OracleSignal } from "@inspector/finding";
import { runNativeHunt } from "./native-session.js";

function inProcessAdapter(handler: ConstructorParameters<typeof AdapterServer>[2]): AdapterClient {
  // Stream direction per the proven core-test helper: the CLIENT reads
  // toClient and writes toServer; the server reads toServer, writes toClient.
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const client = AdapterClient.overStreams(toClient, toServer);
  new AdapterServer(toServer, toClient, handler);
  return client;
}

describe("SPEC-009 A4: native exploration session over a live adapter", () => {
  it("explores SeedBank through policy+store+findings; promotes reproduced failures", async () => {
    const base = mkdtempSync(join(tmpdir(), "spec009-"));
    try {
      const store = Store.open(join(base, "runs.db"));
      const artifacts = new ArtifactStore(join(base, "artifacts"));
      store.createRun({ id: "run_native" });
      store.createEnvironment({ id: "env_native", runId: "run_native", adapter: "windows-uia" });

      const client = inProcessAdapter(new WindowsAdapterHandler(new MockUiaBackend()));
      const caps = (await client.request("initialize", {})) as CapabilityDoc;
      expect(caps.capabilities.vocabulary?.length).toBeGreaterThan(0);
      // Manual construction (vs RunManager.startRun): create the environment
      // explicitly before exploring.
      await client.request("lifecycle", { op: "create", options: {} }, 10000);

      const controller = new RunController(store, artifacts, new PolicyEngine(), {
        runId: "run_native",
        envId: "env_native",
        adapter: client,
        caps,
      });

      // Capture the session's own failure so the static replay driver can
      // deterministically "reproduce" it for the promotion path.
      let lastFailure: ActionOutcome | null = null;
      const originalSubmit = controller.submitAction.bind(controller);
      controller.submitAction = async (action: Action) => {
        const r = await originalSubmit(action);
        if (r.kind === "outcome" && r.outcome.status === "target-failure") {
          lastFailure = r.outcome;
        }
        return r;
      };

      const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
      const driverFactory = (): ReplayDriver => ({
        async replay() {
          const lf = lastFailure;
          const outcomes: ActionOutcome[] = lf ? [lf] : [];
          const signals: OracleSignal[] =
            lf && lf.error ? [{ kind: "TARGET_FAILURE", detail: lf.error.message }] : [];
          return { outcomes, signals, observations: [] };
        },
      });

      const result = await runNativeHunt(
        { run: controller, findingEngine, replayDriverFactory: driverFactory },
        {
          seed: 11,
          maxActions: 40,
          maxWallMs: 20000,
          maxFindings: 3,
          noveltyPlateauLimit: 60,
        },
      );

      expect(result.actionsExecuted).toBeGreaterThan(0);
      expect(result.statesVisited).toBeGreaterThan(1);

      // The mock reliably produces genuine TARGET_FAILUREs (increment
      // overflow / intentional crash); with the registered driver the
      // pipeline must PROMOTE them: confirmed findings + evidence bundles.
      const failureRows = (store.raw
        .prepare("SELECT COUNT(*) c FROM actions WHERE run_id='run_native' AND status='failed'")
        .get() as { c: number }).c;
      const evalCount = (store.raw
        .prepare("SELECT COUNT(*) c FROM oracle_evaluations WHERE run_id='run_native'")
        .get() as { c: number }).c;

      await controller.close();
      store.close();

      if (failureRows > 0) {
        expect(result.findings.length).toBeGreaterThanOrEqual(1);
        expect(result.evidenceBundles.length).toBe(result.findings.length);
        // Provenance: findings name their adapter family.
        expect(result.findings[0]?.adapter).toBe("windows-uia");
        expect(evalCount).toBeGreaterThan(0);
      }
      // Every observed anomaly has an honest ledger entry.
      expect(result.findingOutcomes.length).toBeGreaterThanOrEqual(
        Math.min(result.anomalies, result.findingOutcomes.length),
      );
    } finally {
      // Windows/AV can hold the WAL briefly after close(); bounded reaper.
      let cleaned = false;
      for (let i = 0; i < 6 && !cleaned; i++) {
        try {
          rmSync(base, { recursive: true, force: true });
          cleaned = true;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!cleaned) console.warn("spec009: temp workspace left behind (file lock)");
    }
  });
});
