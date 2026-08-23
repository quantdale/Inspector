import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, AdapterServer, type AdapterHandler } from "@inspector/adapter-sdk";
import type { ActionOutcome, CapabilityDoc, Observation } from "@inspector/protocol";
import { PolicyEngine, RunController } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { EXPLORER_VERSION, runNativeHunt, type NativeExplorationConfig } from "./index.js";

const CONFIG: NativeExplorationConfig = {
  seed: 91,
  maxActions: 2,
  maxWallMs: 600_000,
  maxFindings: 0,
};

function inProcessAdapter(handler: AdapterHandler): AdapterClient {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const client = AdapterClient.overStreams(toClient, toServer);
  new AdapterServer(toServer, toClient, handler);
  return client;
}

function deterministicUiaHandler(): AdapterHandler {
  let observationSequence = 0;
  const caps: CapabilityDoc = {
    protocolVersion: "0.1",
    adapter: "test-uia",
    capabilities: {
      observe: ["uiTree"],
      act: ["click"],
      lifecycle: ["create", "reset", "close"],
      vocabulary: [
        {
          kind: "click",
          targetScheme: "uia-runtime-id",
          risk: "interact",
          autonomousEligible: true,
        },
      ],
    },
  };
  const observation = (runId: string, environmentId: string): Observation => ({
    id: `native_obs_${observationSequence++}`,
    runId,
    environmentId,
    sequence: observationSequence,
    source: "test-uia",
    capturedAt: new Date().toISOString(),
    summary: {
      uiTree: [
        {
          tag: "button",
          role: "button",
          id: "one",
          name: "One",
          patterns: ["InvokePattern"],
          automationId: "one",
          controlType: "Button",
        },
        {
          tag: "button",
          role: "button",
          id: "two",
          name: "Two",
          patterns: ["InvokePattern"],
          automationId: "two",
          controlType: "Button",
        },
      ],
    },
  });
  return {
    initialize: () => caps,
    observe: () => observation("run_native_resume", "env_native_resume"),
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
  store: Store;
  client: AdapterClient;
  run: RunController;
}

async function makeHarness(path: string, runId: string, fresh = true): Promise<Harness> {
  const store = Store.open(path);
  const artifacts = new ArtifactStore(join(path, "artifacts"));
  if (fresh) {
    store.createRun({ id: runId, adapter: "test-uia" });
    store.createEnvironment({ id: `env_${runId}`, runId, adapter: "test-uia" });
    store.createExplorationCampaign({
      runId,
      schemaVersion: 1,
      explorerKind: "native",
      explorerVersion: EXPLORER_VERSION,
      adapter: "test-uia",
      config: CONFIG,
    });
  }
  const client = inProcessAdapter(deterministicUiaHandler());
  const caps = await client.request("initialize", {}) as CapabilityDoc;
  await client.request("lifecycle", { op: "create" });
  const run = new RunController(store, artifacts, new PolicyEngine(), {
    runId,
    envId: `env_${runId}`,
    adapter: client,
    caps,
  });
  return { store, client, run };
}

function actionKeys(store: Store, runId: string): string[] {
  return store.getRunSteps(runId).flatMap((step) => {
    const raw = step.action?.metadata_json;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { metadata?: { exploration?: { actionKey?: string } } };
    const key = parsed.metadata?.exploration?.actionKey;
    return typeof key === "string" ? [key] : [];
  });
}

async function closeHarness(harness: Harness): Promise<void> {
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

describe("M10 native exploration restart", () => {
  it("restores native tried edges, action usage, and RNG after controller death", async () => {
    const controlDir = mkdtempSync(join(tmpdir(), "inspector-m10-native-control-"));
    const interruptedDir = mkdtempSync(join(tmpdir(), "inspector-m10-native-interrupted-"));
    let control: Harness | null = null;
    let first: Harness | null = null;
    let resumed: Harness | null = null;
    try {
      control = await makeHarness(join(controlDir, "run.db"), "run_native_control");
      const controlResult = await runNativeHunt(
        { run: control.run, findingEngine: new FindingEngine(OracleEngine.defaults(), control.store), store: control.store },
        CONFIG,
      );
      const controlKeys = actionKeys(control.store, "run_native_control");
      expect(controlResult.actionsExecuted).toBe(CONFIG.maxActions);

      first = await makeHarness(join(interruptedDir, "run.db"), "run_native_interrupted");
      const submit = first.run.submitAction.bind(first.run);
      let crashed = false;
      first.run.submitAction = async (action) => {
        const result = await submit(action);
        if (!crashed) {
          crashed = true;
          throw new Error("injected native controller death after action commit");
        }
        return result;
      };
      const interrupted = await runNativeHunt(
        { run: first.run, findingEngine: new FindingEngine(OracleEngine.defaults(), first.store), store: first.store },
        CONFIG,
      );
      expect(interrupted.stoppedReason).toBe("adapter-error");
      expect(first.store.countRunActions("run_native_interrupted")).toBe(1);
      expect(first.store.getLatestExplorationCheckpoint("run_native_interrupted")?.actionCount).toBe(1);

      await closeHarness(first);
      first = null;
      resumed = await makeHarness(join(interruptedDir, "run.db"), "run_native_interrupted", false);
      const resumedResult = await runNativeHunt(
        { run: resumed.run, findingEngine: new FindingEngine(OracleEngine.defaults(), resumed.store), store: resumed.store, resume: true },
        CONFIG,
      );
      const resumedKeys = actionKeys(resumed.store, "run_native_interrupted");
      expect(resumedResult.actionsExecuted).toBe(CONFIG.maxActions);
      expect(resumedKeys).toEqual(controlKeys);
      expect(resumed.store.countRunActions("run_native_interrupted")).toBe(CONFIG.maxActions);
    } finally {
      if (control) await closeHarness(control);
      if (first) await closeHarness(first);
      if (resumed) await closeHarness(resumed);
      removeDir(controlDir);
      removeDir(interruptedDir);
    }
  });
});
