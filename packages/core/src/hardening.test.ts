import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import {
  AdapterClient,
  AdapterServer,
  type AdapterHandler,
} from "@inspector/adapter-sdk";
import {
  ProtocolError,
  type Action,
  type CapabilityDoc,
} from "@inspector/protocol";
import { RunManager, RunController } from "./run-manager.js";
import { PolicyEngine, type Policy } from "./policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const miniAdapter = join(here, "fixtures", "mini-adapter.mjs");

let dir: string | null = null;
let store: Store | null = null;
let artifacts: ArtifactStore | null = null;

function tmpBase(): string {
  dir = mkdtempSync(join(tmpdir(), "inspector-core-hardening-"));
  return dir;
}

function openMemStore(): Store {
  store = Store.open(":memory:");
  return store;
}

afterEach(async () => {
  if (store) {
    store.close();
    store = null;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

const caps: CapabilityDoc = {
  protocolVersion: "0.1",
  adapter: "mock",
  capabilities: {
    observe: ["state"],
    act: ["noop"],
    lifecycle: ["create", "reset", "close"],
  },
};

const basePolicy: Policy = {
  name: "hardening",
  capabilities: {
    observe: true,
    interact: true,
    mutate_test_state: false,
    modify_source: false,
    publish: false,
  },
  budgets: {
    wall_clock_minutes: 60,
    max_actions: 2000,
    max_environment_resets: 100,
    max_concurrent_environments: 1,
    max_artifact_megabytes: 2048,
    max_model_requests: 1000,
    max_repairs_per_finding: 0,
  },
};

function act(id: string, kind = "noop", runId = "runH", environmentId = "envH"): Action {
  return {
    id,
    runId,
    environmentId,
    kind,
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
  };
}

interface MockKnobs {
  runId?: string;
  environmentId?: string;
  observeResult?: unknown;
  observeResultFactory?: (runId: string, environmentId: string) => unknown;
  fixedObserveId?: string;
  actResult?: unknown;
  actResultFactory?: (action: Action) => unknown;
  failLifecycleClose?: boolean;
  artifactBytes?: number;
}

type MockHandler = AdapterHandler & { readonly actCalls: number };

function mockHandler(knobs: MockKnobs = {}): MockHandler {
  let actCalls = 0;
  let seq = 0;
  // Share the run's artifact store so controller-side accounting can resolve
  // the referenced artifacts exactly as in production.
  const sharedArtifacts = knobs.artifactBytes ? artifacts : null;
  return {
    get actCalls() {
      return actCalls;
    },
    async initialize() {
      return caps;
    },
    async observe() {
      seq += 1;
      if (knobs.observeResult !== undefined)
        return knobs.observeResult as never;
      if (knobs.observeResultFactory) {
        return knobs.observeResultFactory(
          knobs.runId ?? "runH",
          knobs.environmentId ?? "envH",
        ) as never;
      }
      return {
        id: knobs.fixedObserveId ?? `mock_obs_${seq}`,
        runId: knobs.runId ?? "runH",
        environmentId: knobs.environmentId ?? "envH",
        sequence: seq,
        source: "mock",
        capturedAt: new Date().toISOString(),
        summary: {},
      };
    },
    async act(params) {
      actCalls += 1;
      if (knobs.actResult !== undefined) return knobs.actResult as never;
      if (knobs.actResultFactory) return knobs.actResultFactory(params.action) as never;
      const outcome: Record<string, unknown> = {
        actionId: params.action.id,
        runId: params.action.runId,
        environmentId: params.action.environmentId,
        status: "success",
        observedAt: new Date().toISOString(),
      };
      if (sharedArtifacts) {
        const meta = sharedArtifacts.write({
          runId: params.action.runId,
          content: Buffer.alloc(knobs.artifactBytes ?? 1024),
          mime: "application/octet-stream",
        });
        outcome.artifactRefs = [meta.sha256];
      }
      return outcome as never;
    },
    async lifecycle(params) {
      if (params.op === "close" && knobs.failLifecycleClose) {
        throw new Error("close refused");
      }
      return { ok: true };
    },
    async health() {
      return { ok: true, uptimeMs: 0, now: new Date().toISOString() };
    },
    async cancel() {},
  };
}

function inProcessAdapter(handler: AdapterHandler): AdapterClient {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const client = AdapterClient.overStreams(toClient, toServer);
  new AdapterServer(toServer, toClient, handler);
  return client;
}

let runCounter = 0;

async function hardeningController(
  knobs: MockKnobs = {},
  engine = new PolicyEngine(basePolicy),
): Promise<{
  controller: RunController;
  handler: MockHandler;
  runId: string;
  envId: string;
}> {
  runCounter += 1;
  const runId = `runH${runCounter}`;
  const envId = `envH${runCounter}`;
  const s = store!;
  s.createRun({ id: runId });
  s.createEnvironment({ id: envId, runId, adapter: "mock" });
  const handler = mockHandler({ ...knobs, runId, environmentId: envId });
  const client = inProcessAdapter(handler);
  const controller = new RunController(s, artifacts!, engine, {
    runId,
    envId,
    adapter: client,
    caps,
  });
  return { controller, handler, runId, envId };
}

describe("core hardening wave 2", () => {
  it("C1 (D1): committed observations are attributed to their enclosing step", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController();
    await controller.submitAction(act("h1", "noop", runId, envId));
    await controller.observe(["state"]);
    const steps = store!.getRunSteps(runId);
    expect(steps.length).toBe(2);
    for (const bundle of steps) {
      expect(bundle.observations.length).toBeGreaterThan(0);
      for (const o of bundle.observations) {
        expect(o.step_id).toBe(bundle.step.id);
      }
    }
    // The store's step-scoped reader must see them (production query path).
    expect(store!.getStepObservations(steps[0]!.step.id).length).toBe(1);
    await controller.close();
  });

  it("C2 (D2): resubmitting a decided action replays its recorded outcome without adapter contact", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, handler, runId, envId } = await hardeningController();
    const first = await controller.submitAction(act("h_dup", "noop", runId, envId));
    expect(first.kind).toBe("outcome");
    const second = await controller.submitAction(act("h_dup", "noop", runId, envId));
    expect(second.kind).toBe("outcome");
    expect((second as { outcome: { status: string } }).outcome.status).toBe(
      "success",
    );
    expect(handler.actCalls).toBe(1); // no blind resend
    const count = store!.raw
      .prepare(`SELECT COUNT(*) AS c FROM actions WHERE id = ?`)
      .get("h_dup") as {
      c: number;
    };
    expect(count.c).toBe(1);
    const steps = store!
      .getRunSteps(runId)
      .filter((s) => s.action?.id === "h_dup");
    expect(steps).toHaveLength(1);
    await controller.close();
  });

  it("C3 (D3): a fresh engine cannot evade max_actions by restarting from durable state", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const firstEngine = new PolicyEngine({
      ...basePolicy,
      budgets: { ...basePolicy.budgets, max_actions: 1 },
    });
    const first = await hardeningController({}, firstEngine);
    expect((await first.controller.submitAction(act("h_b1", "noop", first.runId, first.envId))).kind).toBe(
      "outcome",
    );
    await first.controller.close();

    // New process: brand-new engine over the SAME durable run.
    const secondEngine = new PolicyEngine({
      ...basePolicy,
      budgets: { ...basePolicy.budgets, max_actions: 1 },
    });
    const client = inProcessAdapter(
      mockHandler({ runId: first.runId, environmentId: first.envId }),
    );
    const second = new RunController(store!, artifacts!, secondEngine, {
      runId: first.runId,
      envId: first.envId,
      adapter: client,
      caps,
    });
    const retry = await second.submitAction(
      act("h_b2", "noop", first.runId, first.envId),
    );
    expect(retry.kind).toBe("rejected");
    expect((retry as { decision: { code: string } }).decision.code).toBe(
      "BUDGET_EXHAUSTED",
    );
    expect(secondEngine.counters.actions).toBe(1); // seeded from durable state
    await second.close();
  });

  it("C4 (D3): artifact bytes written through the run are accounted against the budget", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const engine = new PolicyEngine(basePolicy);
    const { controller, runId, envId } = await hardeningController(
      { artifactBytes: 4096 },
      engine,
    );
    const action = act("h_art", "noop", runId, envId);
    await controller.submitAction(action);
    expect(engine.counters.artifactBytes).toBe(4096);
    await controller.close();
  });

  it("C4b (M11): a restarted controller restores durable artifact-byte accounting", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const firstEngine = new PolicyEngine(basePolicy);
    const first = await hardeningController({ artifactBytes: 4096 }, firstEngine);
    await first.controller.submitAction(
      act("h_art_restart", "noop", first.runId, first.envId),
    );
    await first.controller.close();

    const secondEngine = new PolicyEngine(basePolicy);
    const client = inProcessAdapter(mockHandler({ artifactBytes: 4096 }));
    const second = new RunController(store!, artifacts!, secondEngine, {
      runId: first.runId,
      envId: first.envId,
      adapter: client,
      caps,
    });
    expect(secondEngine.counters.artifactBytes).toBe(4096);
    await second.close();
  });

  it("C5 (D5): same-millisecond checkpoint ties restore the newest stepSeq on resume", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const s = store!;
    s.createRun({ id: "runTie" });
    s.createEnvironment({ id: "envTie", runId: "runTie", adapter: "mock" });
    // Two committed steps, then two checkpoints written within the same
    // millisecond: a stale snapshot and the current one.
    for (let i = 1; i <= 2; i++) {
      s.commitStep({
        stepId: `step_tie_${i}`,
        runId: "runTie",
        environmentId: "envTie",
        sequence: i,
        action: {
          id: `act_tie_${i}`,
          kind: "noop",
          risk: "interact",
          deadlineMs: 5000,
          idempotency: "safe-retry",
          status: "success",
        },
        observations: [],
      });
    }
    const sameTs = new Date().toISOString();
    const insert = s.raw.prepare(
      `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json) VALUES(?, ?, NULL, ?, ?)`,
    );
    insert.run("ck_stale", "runTie", sameTs, JSON.stringify({ stepSeq: 1 }));
    insert.run("ck_current", "runTie", sameTs, JSON.stringify({ stepSeq: 2 }));

    const handler = mockHandler({ runId: "runTie", environmentId: "envTie" });
    const client = inProcessAdapter(handler);
    const controller = new RunController(
      s,
      artifacts!,
      new PolicyEngine(basePolicy),
      {
        runId: "runTie",
        envId: "envTie",
        adapter: client,
        caps,
      },
    );
    // Restoring the stale stepSeq (1) would collide with UNIQUE(run_id,sequence).
    const result = await controller.submitAction(act("h_after_tie", "noop", "runTie", "envTie"));
    expect(result.kind).toBe("outcome");
    const sequences = s.getRunSteps("runTie").map((b) => b.step.sequence);
    expect(sequences).toEqual([1, 2, 3]);
    await controller.close();
  });

  it("C5b (D5): a checkpoint lagging committed steps cannot cause sequence reuse on resume", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const s = store!;
    s.createRun({ id: "runLag" });
    s.createEnvironment({ id: "envLag", runId: "runLag", adapter: "mock" });
    // Three durably committed steps, but the newest checkpoint claims only
    // 1: a hard kill can land between the step transaction and the
    // checkpoint write, leaving the payload lagging the step table.
    for (let i = 1; i <= 3; i++) {
      s.commitStep({
        stepId: `step_lag_${i}`,
        runId: "runLag",
        environmentId: "envLag",
        sequence: i,
        action: {
          id: `act_lag_${i}`,
          kind: "noop",
          risk: "interact",
          deadlineMs: 5000,
          idempotency: "safe-retry",
          status: "success",
        },
        observations: [],
      });
    }
    const insert = s.raw.prepare(
      `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json) VALUES(?, ?, NULL, ?, ?)`,
    );
    insert.run(
      "ck_lag",
      "runLag",
      new Date().toISOString(),
      JSON.stringify({ stepSeq: 1 }),
    );

    const handler = mockHandler({ runId: "runLag", environmentId: "envLag" });
    const client = inProcessAdapter(handler);
    const controller = new RunController(
      s,
      artifacts!,
      new PolicyEngine(basePolicy),
      {
        runId: "runLag",
        envId: "envLag",
        adapter: client,
        caps,
      },
    );
    // Restoring the lagging stepSeq (1) would persist sequence 2 next and hit
    // UNIQUE(run_id, sequence): exactly the intermittent CLI resume failure.
    await expect(controller.observe(["state"])).resolves.toBeTruthy();
    const sequences = s.getRunSteps("runLag").map((b) => b.step.sequence);
    expect(sequences).toEqual([1, 2, 3, 4]);
    await controller.close();
  });

  it("C6 (D6): spawn failure cleans up counters and records honest failure statuses", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const engine = new PolicyEngine(basePolicy);
    const mgr = new RunManager(store!, artifacts!, engine);
    await expect(
      mgr.startRun({ adapterCommand: "inspector-no-such-adapter-binary" }),
    ).rejects.toThrow(/spawn/i);
    expect(engine.counters.openEnvironments).toBe(0);
    const runs = store!.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    const envs = store!.raw
      .prepare(`SELECT * FROM environments`)
      .all() as Array<{ status: string }>;
    expect(envs).toHaveLength(1);
    expect(envs[0]!.status).toBe("failed");
  });

  it("C7 (D6): durable records carry the adapter's real identity", async () => {
    const base = tmpBase();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "art"));
    const mgr = new RunManager(store, artifacts);
    const run = await mgr.startRun({
      adapterCommand: process.execPath,
      adapterArgs: [miniAdapter],
    });
    expect(store.getRun(run.runId)?.adapter).toBe("fixture-mini");
    expect(store.getEnvironment(run.environmentId)?.adapter).toBe(
      "fixture-mini",
    );
    await run.close();
    expect(store.getRun(run.runId)?.status).toBe("closed");
    expect(store.getEnvironment(run.environmentId)?.status).toBe("closed");
  });

  it("C8 (D7): teardown failure records failed/crashed instead of a clean close", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({
      failLifecycleClose: true,
    });
    await expect(controller.close()).resolves.toBeUndefined();
    expect(store!.getRun(runId)?.status).toBe("failed");
    expect(store!.getEnvironment(envId)?.status).toBe("crashed");
  });

  it("C9 (D8): a hostile repeated observation id cannot corrupt the step transaction", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId } = await hardeningController({
      fixedObserveId: "obs_hostile",
    });
    await controller.observe(["state"]);
    await controller.observe(["state"]);
    const steps = store!.getRunSteps(runId);
    expect(steps).toHaveLength(2);
    const ids = steps.map((b) => b.observations[0]!.id);
    expect(new Set(ids).size).toBe(2); // collision regenerated deterministically
    for (const id of ids)
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    await controller.close();
  });

  it.each(["actionId", "runId", "environmentId"] as const)(
    "H6.3: mismatched action outcome %s is rejected before durable commit",
    async (field) => {
      openMemStore();
      artifacts = new ArtifactStore(join(tmpBase(), "art"));
      const engine = new PolicyEngine(basePolicy);
      const { controller, runId, envId } = await hardeningController(
        {
          actResultFactory: (action) => ({
            actionId: field === "actionId" ? "wrong_action" : action.id,
            runId: field === "runId" ? "wrong_run" : action.runId,
            environmentId: field === "environmentId" ? "wrong_env" : action.environmentId,
            status: "success",
            observedAt: new Date().toISOString(),
          }),
        },
        engine,
      );
      const action = act("h_correl", "noop", runId, envId);

      await expect(controller.submitAction(action)).rejects.toMatchObject({
        name: "ProtocolError",
        code: "VALIDATION",
      });
      expect(store!.getRunSteps(runId)).toHaveLength(0);
      expect(store!.getAction(action.id)?.status).toBe("pending");
      expect(engine.counters.actions).toBe(0);
      await controller.close();
    },
  );

  it.each(["runId", "environmentId"] as const)(
    "H6.3/H6-D8: mismatched observation %s is rejected before a step exists",
    async (field) => {
      openMemStore();
      artifacts = new ArtifactStore(join(tmpBase(), "art"));
      const { controller, runId } = await hardeningController({
        observeResultFactory: (currentRun, currentEnv) => ({
          id: "obs_wrong_context",
          runId: field === "runId" ? "wrong_run" : currentRun,
          environmentId: field === "environmentId" ? "wrong_env" : currentEnv,
          sequence: 999,
          stepId: "adapter_step_should_not_be_trusted",
          source: "mock",
          capturedAt: new Date().toISOString(),
          summary: {},
        }),
      });

      await expect(controller.observe(["state"])).rejects.toMatchObject({
        name: "ProtocolError",
        code: "VALIDATION",
      });
      expect(store!.getRunSteps(runId)).toHaveLength(0);
      await controller.close();
    },
  );

  it("H6.3/H6-D8: adapter sequence and step identity are normalized to controller truth", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId } = await hardeningController({
      observeResultFactory: (currentRun, currentEnv) => ({
        id: "obs_wrong_sequence",
        runId: currentRun,
        environmentId: currentEnv,
        sequence: 999,
        stepId: "adapter_step_should_not_be_trusted",
        source: "mock",
        capturedAt: new Date().toISOString(),
        summary: {},
      }),
    });

    const returned = await controller.observe(["state"]);
    const step = store!.getRunSteps(runId)[0]!;
    expect(returned.sequence).toBe(1);
    expect(returned.stepId).toBe(step.step.id);
    expect(returned.stepId).not.toBe("adapter_step_should_not_be_trusted");
    expect(step.step.sequence).toBe(1);
    expect(step.observations[0]?.sequence).toBe(1);
    expect(step.observations[0]?.step_id).toBe(step.step.id);
    await controller.close();
  });

  it("H6.3/H6-D9: missing or cross-run action artifacts are evidence failures", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const missing = "a".repeat(64);
    const { controller, runId, envId } = await hardeningController({
      actResultFactory: (action) => ({
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "success",
        observedAt: new Date().toISOString(),
        artifactRefs: [missing],
      }),
    });
    const action = act("h_missing_artifact", "noop", runId, envId);
    await expect(controller.submitAction(action)).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    expect(store!.getRunSteps(runId)).toHaveLength(0);
    expect(store!.getAction(action.id)?.status).toBe("pending");
    await controller.close();

    const other = artifacts.write({ runId: "otherRun", content: Buffer.from("foreign"), mime: "text/plain" });
    const second = await hardeningController({
      actResultFactory: (nextAction) => ({
        actionId: nextAction.id,
        runId: nextAction.runId,
        environmentId: nextAction.environmentId,
        status: "success",
        observedAt: new Date().toISOString(),
        artifactRefs: [other.sha256],
      }),
    });
    const secondAction: Action = {
      ...act("h_foreign_artifact", "noop", second.runId, second.envId),
      idempotency: "never-retry",
    };
    await expect(second.controller.submitAction(secondAction)).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    expect(store!.getRunSteps(second.runId)).toHaveLength(0);
    await second.controller.close();
  });

  it("H6.3/H6-D9: corrupt action artifacts never become zero-byte evidence", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({
      actResultFactory: (action) => {
        const meta = artifacts!.write({ runId: action.runId, content: Buffer.from("valid"), mime: "text/plain" });
        writeFileSync(meta.path, "tampered");
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "success",
          observedAt: new Date().toISOString(),
          artifactRefs: [meta.sha256],
        };
      },
    });
    const action = act("h_corrupt_artifact", "noop", runId, envId);
    await expect(controller.submitAction(action)).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    expect(store!.getRunSteps(runId)).toHaveLength(0);
    expect(store!.getAction(action.id)?.status).toBe("pending");
    await controller.close();
  });

  it("H6.3/H6-D9: observation artifacts are integrity-checked and persisted", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({
      observeResultFactory: (currentRun, currentEnv) => {
        const meta = artifacts!.write({ runId: currentRun, content: Buffer.from("snapshot"), mime: "text/plain" });
        return {
          id: "obs_with_artifact",
          runId: currentRun,
          environmentId: currentEnv,
          sequence: 777,
          stepId: "adapter_step",
          source: "mock",
          capturedAt: new Date().toISOString(),
          summary: {},
          artifacts: [{ sha256: meta.sha256, mime: meta.mime, size: meta.size, path: meta.path }],
        };
      },
    });

    const returned = await controller.observe(["state"]);
    const step = store!.getRunSteps(runId)[0]!;
    expect(returned.artifacts).toHaveLength(1);
    expect(step.observations[0]?.artifacts).toHaveLength(1);
    expect(step.observations[0]?.artifacts[0]?.sha256).toBe(returned.artifacts?.[0]?.sha256);
    expect(step.observations[0]?.run_id).toBe(runId);
    expect(step.observations[0]?.environment_id).toBe(envId);
    await controller.close();
  });

  it("C10 (D11): malformed observations are rejected with ProtocolError and leave no partial step", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId } = await hardeningController({
      observeResult: { nonsense: true },
    });
    await expect(controller.observe(["state"])).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    expect(store!.getRunSteps(runId)).toHaveLength(0);
    await controller.close();
  });

  it("C11 (D11): malformed action outcomes are rejected before persistence; action stays recoverable", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({
      actResult: { totally: "malformed" },
    });
    await expect(controller.submitAction(act("h_bad", "noop", runId, envId))).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    // No half-committed step; the pending action remains for recovery.
    expect(store!.getRunSteps(runId)).toHaveLength(0);
    expect(store!.getAction("h_bad")?.status).toBe("pending");
    await controller.close();
  });

  it.each([
    ["malformed error JSON", "UPDATE actions SET error_code = ?, error_json = ? WHERE id = ?", ["TARGET_FAILURE", "{", "h_raw_corrupt"]],
    ["invalid status", "UPDATE actions SET status = ?, error_code = NULL, error_json = NULL WHERE id = ?", ["not-a-status", "h_raw_invalid_status"]],
    ["missing decided timestamp", "UPDATE actions SET decided_at = NULL WHERE id = ?", ["h_raw_missing_time"]],
  ])("H6.5/D11: %s durable action rows fail closed on replay", async (_label, sql, params) => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, handler, runId, envId } = await hardeningController();
    const actionId = params[params.length - 1] as string;
    const action = act(actionId, "noop", runId, envId);
    await expect(controller.submitAction(action)).resolves.toMatchObject({ kind: "outcome" });
    store!.raw.prepare(sql).run(...params);

    await expect(controller.submitAction(action)).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    expect(handler.actCalls).toBe(1);
    expect(store!.getRunSteps(runId)).toHaveLength(1);
  });

  it("H6.5/D11: malformed checkpoint JSON refuses controller construction", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController();
    await controller.close();
    store!.raw
      .prepare(
        `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json) VALUES(?, ?, NULL, ?, ?)`,
      )
      .run("ck_bad_json", runId, new Date(Date.now() + 1000).toISOString(), "{");
    const client = inProcessAdapter(mockHandler({ runId, environmentId: envId }));
    expect(
      () =>
        new RunController(store!, artifacts!, new PolicyEngine(basePolicy), {
          runId,
          envId,
          adapter: client,
          caps,
        }),
    ).toThrowError(/checkpoint .* malformed/i);
    await client.close();
  });

  it("C12 (D11): validation failures do not consume step sequence numbers", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({
      observeResult: { nonsense: true },
    });
    await expect(controller.observe(["state"])).rejects.toBeInstanceOf(
      ProtocolError,
    );
    // A subsequent well-formed observation continues at sequence 1.
    const good = mockHandler({ runId, environmentId: envId });
    const client = inProcessAdapter(good);
    const recovered = new RunController(
      store!,
      artifacts!,
      new PolicyEngine(basePolicy),
      {
        runId,
        envId,
        adapter: client,
        caps,
      },
    );
    await recovered.observe(["state"]);
    expect(store!.getRunSteps(runId).map((b) => b.step.sequence)).toEqual([1]);
    await recovered.close();
  });

  it("C13 (D12): FindingEngine wave-1 fields survive a store reopen", async () => {
    const base = tmpBase();
    store = Store.open(join(base, "findings.db"));
    artifacts = new ArtifactStore(join(base, "art"));
    const { FindingEngine } = await import("@inspector/finding");
    const engine = new FindingEngine(undefined, store!);
    const finding = engine.ingest(
      { kind: "PAGE_ERROR" },
      { runId: "runF", revision: "rev7", adapter: "adapter-fake" },
    );
    engine.transition(finding, "CONFIRMED");
    finding.minimization = {
      probes: 4,
      removals: 1,
      verifiedReproduction: true,
    };
    engine.transition(finding, "MINIMIZED", {
      reason: "minimized to 3 steps",
      actor: "test",
    });

    // Reopen the same database and read the record back.
    store!.close();
    store = Store.open(join(base, "findings.db"));
    const got = store!.getFinding(finding.id);
    expect(got).toBeDefined();
    expect(got!.status).toBe("MINIMIZED");
    expect(got!.signature).toBe("PAGE_ERROR");
    expect(got!.adapter).toBe("adapter-fake");
    expect(JSON.parse(got!.minimizationJson!)).toEqual({
      probes: 4,
      removals: 1,
      verifiedReproduction: true,
    });
    const lastTransition = JSON.parse(got!.lastTransitionJson!) as {
      from: string;
      to: string;
      reason?: string;
      actor?: string;
    };
    expect(lastTransition.from).toBe("CONFIRMED");
    expect(lastTransition.to).toBe("MINIMIZED");
    expect(lastTransition.reason).toBe("minimized to 3 steps");
    expect(lastTransition.actor).toBe("test");
  });
});
