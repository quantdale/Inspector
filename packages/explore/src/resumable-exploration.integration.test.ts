import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, AdapterServer, type AdapterHandler } from "@inspector/adapter-sdk";
import type { ActionOutcome, CapabilityDoc, Observation } from "@inspector/protocol";
import { PolicyEngine, RunController, RunManager } from "@inspector/core";
import { webAdapterSpawn } from "../../adapter-web/src/index.js";
import type { AdapterClient as RealAdapterClient } from "@inspector/adapter-sdk";
import {
  EXPLORER_VERSION,
  ExploreController,
  StateGraph,
  configFingerprint,
  loadLatestCheckpoint,
  mulberry32,
  writeCheckpoint,
  type ExplorationCheckpointPayload,
  type ExploreConfig,
} from "./index.js";

const CONFIG: ExploreConfig = {
  seed: 73,
  maxActions: 8,
  maxWallMs: 600_000,
  maxResets: 0,
  maxFindings: 0,
  sequenceLengths: [],
  skipReproduction: true,
};

function inProcessAdapter(handler: AdapterHandler): AdapterClient {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const client = AdapterClient.overStreams(toClient, toServer);
  new AdapterServer(toServer, toClient, handler);
  return client;
}

function deterministicWebHandler(): AdapterHandler {
  let observationSequence = 0;
  const caps: CapabilityDoc = {
    protocolVersion: "0.1",
    adapter: "test-web",
    capabilities: {
      observe: ["uiTree", "url", "storage"],
      act: ["click"],
      lifecycle: ["create", "reset", "close"],
    },
  };
  const observation = (runId: string, environmentId: string): Observation => ({
    id: `obs_${observationSequence++}`,
    runId,
    environmentId,
    sequence: observationSequence,
    source: "test-web",
    capturedAt: new Date().toISOString(),
    summary: {
      url: "http://127.0.0.1:43123/",
      storage: {},
      uiTree: [
        { tag: "button", role: "button", id: "alpha", name: "Alpha", hidden: false, disabled: false },
        { tag: "button", role: "button", id: "beta", name: "Beta", hidden: false, disabled: false },
      ],
    },
  });
  return {
    initialize: () => caps,
    observe: (params) => {
      const request = params as { observe: string[] };
      void request;
      return observation("run_resume", "env_resume");
    },
    act: (params) => {
      const action = (params as { action: { id: string; runId: string; environmentId: string } }).action;
      const outcome: ActionOutcome = {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "success",
        observedAt: new Date().toISOString(),
      };
      return outcome;
    },
    lifecycle: () => ({ ok: true }),
    health: () => ({ ok: true, uptimeMs: 0, now: new Date().toISOString() }),
    cancel: () => undefined,
  };
}

interface Harness {
  path: string;
  store: Store;
  artifacts: ArtifactStore;
  client: AdapterClient;
  run: RunController;
}

async function makeHarness(path: string, runId: string, fresh = true): Promise<Harness> {
  const store = Store.open(path);
  const artifacts = new ArtifactStore(join(path, "artifacts"));
  if (fresh) {
    store.createRun({ id: runId, adapter: "test-web" });
    store.createEnvironment({ id: `env_${runId}`, runId, adapter: "test-web" });
    store.createExplorationCampaign({
      runId,
      schemaVersion: 1,
      explorerKind: "web",
      explorerVersion: EXPLORER_VERSION,
      adapter: "test-web",
      config: CONFIG,
    });
  }
  const client = inProcessAdapter(deterministicWebHandler());
  const caps = await client.request("initialize", {}) as CapabilityDoc;
  await client.request("lifecycle", { op: "create" });
  const run = new RunController(store, artifacts, new PolicyEngine(), {
    runId,
    envId: `env_${runId}`,
    adapter: client,
    caps,
  });
  store.setRunStatus(runId, "running");
  store.setEnvironmentStatus(`env_${runId}`, "running");
  return { path, store, artifacts, client, run };
}

function explorationKeys(store: Store, runId: string): string[] {
  return store.getRunSteps(runId).flatMap((step) => {
    const raw = step.action?.metadata_json;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { metadata?: { exploration?: { actionKey?: string } } };
    const key = parsed.metadata?.exploration?.actionKey;
    return typeof key === "string" ? [key] : [];
  });
}

async function finishHarness(harness: Harness): Promise<void> {
  await harness.client.close();
  harness.store.close();
}

function removeDir(path: string): void {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

describe("M10 deterministic exploration restart", () => {
  it("continues the exact decision stream after a committed-step/checkpoint crash", async () => {
    const controlDir = mkdtempSync(join(tmpdir(), "inspector-m10-control-"));
    const interruptedDir = mkdtempSync(join(tmpdir(), "inspector-m10-interrupted-"));
    let control: Harness | null = null;
    let first: Harness | null = null;
    let resumed: Harness | null = null;
    try {
      control = await makeHarness(join(controlDir, "run.db"), "run_control");
      const controlResult = await new ExploreController({
        run: control.run,
        store: control.store,
        config: CONFIG,
      }).run_();
      const controlKeys = explorationKeys(control.store, "run_control");
      const controlCheckpoint = control.store.getLatestExplorationCheckpoint("run_control");
      expect(controlResult.actionsExecuted).toBe(CONFIG.maxActions);
      expect(controlKeys).toHaveLength(CONFIG.maxActions);
      expect(controlCheckpoint).toBeDefined();

      first = await makeHarness(join(interruptedDir, "run.db"), "run_interrupted");
      const submit = first.run.submitAction.bind(first.run);
      let crashed = false;
      first.run.submitAction = async (action) => {
        const result = await submit(action);
        if (!crashed) {
          crashed = true;
          throw new Error("injected controller death after durable action commit");
        }
        return result;
      };
      await expect(new ExploreController({
        run: first.run,
        store: first.store,
        config: CONFIG,
      }).run_()).rejects.toThrow("injected controller death");
      expect(first.store.countRunActions("run_interrupted")).toBe(1);
      expect(first.store.getLatestExplorationCheckpoint("run_interrupted")?.actionCount).toBe(0);

      await first.client.close();
      first.store.close();
      first = null;

      resumed = await makeHarness(join(interruptedDir, "run.db"), "run_interrupted", false);
      const resumedResult = await new ExploreController({
        run: resumed.run,
        store: resumed.store,
        config: CONFIG,
        resume: true,
      }).run_();
      const resumedKeys = explorationKeys(resumed.store, "run_interrupted");
      const resumedCheckpoint = resumed.store.getLatestExplorationCheckpoint("run_interrupted");
      expect(resumedResult.actionsExecuted).toBe(CONFIG.maxActions);
      expect(resumedKeys).toEqual(controlKeys);
      expect(resumed.store.countRunActions("run_interrupted")).toBe(CONFIG.maxActions);
      expect(resumed.store.maxRunStepSequence("run_interrupted")).toBeGreaterThan(CONFIG.maxActions);
      expect(resumedCheckpoint).toBeDefined();
      expect(resumedCheckpoint?.actionCount).toBe(CONFIG.maxActions);

      const controlPayload = JSON.parse(controlCheckpoint!.payloadJson) as { graph: unknown; rng: unknown };
      const resumedPayload = JSON.parse(resumedCheckpoint!.payloadJson) as { graph: unknown; rng: unknown };
      expect(resumedPayload.graph).toEqual(controlPayload.graph);
      expect(resumedPayload.rng).toEqual(controlPayload.rng);
    } finally {
      if (control) await finishHarness(control);
      if (first) await finishHarness(first);
      if (resumed) await finishHarness(resumed);
      removeDir(controlDir);
      removeDir(interruptedDir);
    }
  });

  it("retains a bounded checkpoint history and fails closed on corruption/version drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m10-checkpoint-"));
    const path = join(dir, "run.db");
    const store = Store.open(path);
    try {
      const runId = "run_checkpoint_contract";
      const config = { seed: 5, maxActions: 10 };
      store.createRun({ id: runId, adapter: "test-web" });
      store.createEnvironment({ id: "env_checkpoint_contract", runId, adapter: "test-web" });
      store.createExplorationCampaign({
        runId,
        schemaVersion: 1,
        explorerKind: "web",
        explorerVersion: EXPLORER_VERSION,
        adapter: "test-web",
        config,
      });
      const graph = new StateGraph().snapshot();
      const base: ExplorationCheckpointPayload = {
        schema: "inspector-exploration-checkpoint/1",
        version: 1,
        runId,
        explorerKind: "web",
        explorerVersion: EXPLORER_VERSION,
        adapter: "test-web",
        seed: 5,
        configFingerprint: configFingerprint(config),
        rng: mulberry32(5).snapshot(),
        stepSequence: 0,
        campaignStartedAt: "2026-01-01T00:00:00.000Z",
        actionsExecuted: 0,
        resets: 0,
        actionsSinceNewState: 0,
        recentActionKeys: [],
        toxicActionKeys: [],
        rejectedActionKeys: [],
        currentState: "",
        currentScreen: "",
        graph,
        actionKindSequence: [],
        actionPath: [],
        anomalies: [],
        anomalyClassKeys: [],
        processedFindingClassKeys: [],
        findingOutcomes: [],
        budget: { maxActions: 10, maxResets: 0, maxFindings: 0, maxWallMs: 60_000 },
      };
      for (let i = 0; i < 10; i++) {
        writeCheckpoint(store, { ...base, stepSequence: i, actionsExecuted: i });
      }
      expect(store.countExplorationCheckpoints(runId)).toBe(8);
      const identity = {
        runId,
        explorerKind: "web" as const,
        explorerVersion: EXPLORER_VERSION,
        adapter: "test-web",
        seed: 5,
        configFingerprint: configFingerprint(config),
      };
      store.raw.prepare("UPDATE exploration_checkpoints SET payload_json = ? WHERE run_id = ? AND step_sequence = 9").run("{", runId);
      expect(() => loadLatestCheckpoint(store, identity, base.budget)).toThrow(/checksum|malformed/i);

      const replacement = writeCheckpoint(store, { ...base, stepSequence: 10, actionsExecuted: 10 });
      store.raw.prepare("UPDATE exploration_checkpoints SET schema_version = 99 WHERE id = ?").run(replacement.id);
      expect(() => loadLatestCheckpoint(store, identity, base.budget)).toThrow(/incompatible/i);
    } finally {
      store.close();
      removeDir(dir);
    }
  });

  it("blocks a pending/unknown action without replaying it or granting budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m10-unknown-"));
    const path = join(dir, "run.db");
    let first: Harness | null = null;
    let resumed: Harness | null = null;
    try {
      first = await makeHarness(path, "run_unknown");
      first.run.submitAction = async () => {
        throw new Error("injected death before action admission");
      };
      await expect(new ExploreController({
        run: first.run,
        store: first.store,
        config: CONFIG,
      }).run_()).rejects.toThrow("injected death before action admission");

      const checkpoint = first.store.getLatestExplorationCheckpoint("run_unknown");
      expect(checkpoint?.actionCount).toBe(0);
      first.store.insertPendingAction({
        id: "act_unknown",
        runId: "run_unknown",
        environmentId: "env_run_unknown",
        kind: "click",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "unknown-action-idempotency",
        metadata: {
          input: { selector: "#unknown" },
          metadata: {
            exploration: {
              actionKey: "click:unknown",
              stateBefore: "screen-before",
              rngAfter: mulberry32(CONFIG.seed).snapshot(),
            },
          },
        },
      });
      first.store.markInFlightUnknown("run_unknown");
      await finishHarness(first);
      first = null;

      resumed = await makeHarness(path, "run_unknown", false);
      const result = await new ExploreController({
        run: resumed.run,
        store: resumed.store,
        config: CONFIG,
        resume: true,
      }).run_();
      expect(result.actionsExecuted).toBe(CONFIG.maxActions);
      expect(resumed.store.countRunActions("run_unknown")).toBe(CONFIG.maxActions);
      expect(explorationKeys(resumed.store, "run_unknown")).not.toContain("click:unknown");
      expect(resumed.store.getAction("act_unknown")?.status).toBe("unknown");
    } finally {
      if (first) await finishHarness(first);
      if (resumed) await finishHarness(resumed);
      removeDir(dir);
    }
  });

  it("survives a bounded seeded multi-restart soak without duplicate steps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m10-soak-"));
    const path = join(dir, "run.db");
    let harness: Harness | null = null;
    try {
      harness = await makeHarness(path, "run_soak");
      const killAfter = [1, 2, 4, 6];
      for (const boundary of killAfter) {
        const submit = harness.run.submitAction.bind(harness.run);
        let killed = false;
        harness.run.submitAction = async (action) => {
          const result = await submit(action);
          if (!killed && harness!.store.countRunActions("run_soak") >= boundary) {
            killed = true;
            throw new Error(`seeded soak interruption at ${boundary}`);
          }
          return result;
        };
        await expect(new ExploreController({
          run: harness.run,
          store: harness.store,
          config: CONFIG,
          resume: boundary > 1,
        }).run_()).rejects.toThrow(`seeded soak interruption at ${boundary}`);
        expect(harness.store.countRunActions("run_soak")).toBe(boundary);
        await finishHarness(harness);
        harness = await makeHarness(path, "run_soak", false);
      }

      const result = await new ExploreController({
        run: harness.run,
        store: harness.store,
        config: CONFIG,
        resume: true,
      }).run_();
      const steps = harness.store.getRunSteps("run_soak");
      const sequences = steps.map((step) => step.step.sequence);
      expect(result.actionsExecuted).toBe(CONFIG.maxActions);
      expect(harness.store.countRunActions("run_soak")).toBe(CONFIG.maxActions);
      expect(new Set(sequences).size).toBe(sequences.length);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(harness.store.countExplorationCheckpoints("run_soak")).toBeLessThanOrEqual(8);
    } finally {
      if (harness) await finishHarness(harness);
      removeDir(dir);
    }
  });

  it("continues a real Playwright-backed localhost hunt after adapter death", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m10-real-web-"));
    const path = join(dir, "run.db");
    const config: ExploreConfig = {
      seed: 17,
      maxActions: 8,
      maxWallMs: 600_000,
      maxResets: 0,
      maxFindings: 0,
      sequenceLengths: [],
      skipReproduction: true,
    };
    let store: Store | null = null;
    let resumedRun: RunController | null = null;
    try {
      store = Store.open(path);
      const artifacts = new ArtifactStore(join(dir, "artifacts"));
      const manager = new RunManager(store, artifacts);
      const run = await manager.startRun({
        ...webAdapterSpawn(),
        exploration: {
          schemaVersion: 1,
          explorerKind: "web",
          explorerVersion: EXPLORER_VERSION,
          config,
        },
      });
      const submit = run.submitAction.bind(run);
      let interrupted = false;
      run.submitAction = async (action) => {
        const result = await submit(action);
        if (!interrupted) {
          interrupted = true;
          throw new Error("injected real web controller death after commit");
        }
        return result;
      };
      await expect(new ExploreController({ run, store, config }).run_()).rejects.toThrow("injected real web controller death");
      expect(store.countRunActions(run.runId)).toBe(1);
      const runId = run.runId;
      const adapter = (run as unknown as { ctx: { adapter: RealAdapterClient } }).ctx.adapter;
      await adapter.close();
      store.close();
      store = Store.open(path);

      resumedRun = await new RunManager(store, artifacts).resumeRun(runId, webAdapterSpawn());
      const resumed = await new ExploreController({ run: resumedRun, store, config, resume: true }).run_();
      expect(resumed.actionsExecuted).toBe(config.maxActions);
      expect(store.countRunActions(runId)).toBe(config.maxActions);
      expect(store.countExplorationCheckpoints(runId)).toBeLessThanOrEqual(8);
      expect(new Set(store.getRunSteps(runId).map((step) => step.step.sequence)).size).toBe(
        store.getRunSteps(runId).length,
      );
      await resumedRun.close();
      resumedRun = null;
    } finally {
      if (resumedRun) await resumedRun.close().catch(() => {});
      if (store) store.close();
      removeDir(dir);
    }
  }, 180000);
});
