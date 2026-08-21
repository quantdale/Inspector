import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, AdapterServer, type AdapterHandler } from "@inspector/adapter-sdk";
import { ProtocolError, type Action, type CapabilityDoc } from "@inspector/protocol";
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
  capabilities: { observe: ["state"], act: ["noop"], lifecycle: ["create", "reset", "close"] },
};

const basePolicy: Policy = {
  name: "hardening",
  capabilities: { observe: true, interact: true, mutate_test_state: false, modify_source: false, publish: false },
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

function act(id: string, kind = "noop"): Action {
  return { id, runId: "runH", environmentId: "envH", kind, risk: "interact", deadlineMs: 5000, idempotency: "safe-retry" };
}

interface MockKnobs {
  observeResult?: unknown;
  fixedObserveId?: string;
  actResult?: unknown;
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
      if (knobs.observeResult !== undefined) return knobs.observeResult as never;
      return {
        id: knobs.fixedObserveId ?? `mock_obs_${seq}`,
        runId: "runH",
        environmentId: "envH",
        sequence: seq,
        source: "mock",
        capturedAt: new Date().toISOString(),
        summary: {},
      };
    },
    async act(params) {
      actCalls += 1;
      if (knobs.actResult !== undefined) return knobs.actResult as never;
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
): Promise<{ controller: RunController; handler: MockHandler; runId: string; envId: string }> {
  runCounter += 1;
  const runId = `runH${runCounter}`;
  const envId = `envH${runCounter}`;
  const s = store!;
  s.createRun({ id: runId });
  s.createEnvironment({ id: envId, runId, adapter: "mock" });
  const handler = mockHandler(knobs);
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
    const { controller, runId } = await hardeningController();
    await controller.submitAction(act("h1"));
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
    const { controller, handler, runId } = await hardeningController();
    const first = await controller.submitAction(act("h_dup"));
    expect(first.kind).toBe("outcome");
    const second = await controller.submitAction(act("h_dup"));
    expect(second.kind).toBe("outcome");
    expect((second as { outcome: { status: string } }).outcome.status).toBe("success");
    expect(handler.actCalls).toBe(1); // no blind resend
    const count = store!.raw.prepare(`SELECT COUNT(*) AS c FROM actions WHERE id = ?`).get("h_dup") as {
      c: number;
    };
    expect(count.c).toBe(1);
    const steps = store!.getRunSteps(runId).filter((s) => s.action?.id === "h_dup");
    expect(steps).toHaveLength(1);
    await controller.close();
  });

  it("C3 (D3): a fresh engine cannot evade max_actions by restarting from durable state", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const firstEngine = new PolicyEngine({ ...basePolicy, budgets: { ...basePolicy.budgets, max_actions: 1 } });
    const first = await hardeningController({}, firstEngine);
    expect((await first.controller.submitAction(act("h_b1"))).kind).toBe("outcome");
    await first.controller.close();

    // New process: brand-new engine over the SAME durable run.
    const secondEngine = new PolicyEngine({ ...basePolicy, budgets: { ...basePolicy.budgets, max_actions: 1 } });
    const client = inProcessAdapter(mockHandler());
    const second = new RunController(store!, artifacts!, secondEngine, {
      runId: first.runId,
      envId: first.envId,
      adapter: client,
      caps,
    });
    const retry = await second.submitAction(act("h_b2"));
    expect(retry.kind).toBe("rejected");
    expect((retry as { decision: { code: string } }).decision.code).toBe("BUDGET_EXHAUSTED");
    expect(secondEngine.counters.actions).toBe(1); // seeded from durable state
    await second.close();
  });

  it("C4 (D3): artifact bytes written through the run are accounted against the budget", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const engine = new PolicyEngine(basePolicy);
    const { controller, runId } = await hardeningController({ artifactBytes: 4096 }, engine);
    const action = { ...act("h_art"), runId };
    await controller.submitAction(action);
    expect(engine.counters.artifactBytes).toBe(4096);
    await controller.close();
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

    const handler = mockHandler();
    const client = inProcessAdapter(handler);
    const controller = new RunController(s, artifacts!, new PolicyEngine(basePolicy), {
      runId: "runTie",
      envId: "envTie",
      adapter: client,
      caps,
    });
    // Restoring the stale stepSeq (1) would collide with UNIQUE(run_id,sequence).
    const result = await controller.submitAction(act("h_after_tie"));
    expect(result.kind).toBe("outcome");
    const sequences = s.getRunSteps("runTie").map((b) => b.step.sequence);
    expect(sequences).toEqual([1, 2, 3]);
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
    const envs = store!.raw.prepare(`SELECT * FROM environments`).all() as Array<{ status: string }>;
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
    expect(store.getEnvironment(run.environmentId)?.adapter).toBe("fixture-mini");
    await run.close();
    expect(store.getRun(run.runId)?.status).toBe("closed");
    expect(store.getEnvironment(run.environmentId)?.status).toBe("closed");
  });

  it("C8 (D7): teardown failure records failed/crashed instead of a clean close", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({ failLifecycleClose: true });
    await expect(controller.close()).resolves.toBeUndefined();
    expect(store!.getRun(runId)?.status).toBe("failed");
    expect(store!.getEnvironment(envId)?.status).toBe("crashed");
  });

  it("C9 (D8): a hostile repeated observation id cannot corrupt the step transaction", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId } = await hardeningController({ fixedObserveId: "obs_hostile" });
    await controller.observe(["state"]);
    await controller.observe(["state"]);
    const steps = store!.getRunSteps(runId);
    expect(steps).toHaveLength(2);
    const ids = steps.map((b) => b.observations[0]!.id);
    expect(new Set(ids).size).toBe(2); // collision regenerated deterministically
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    await controller.close();
  });

  it("C10 (D11): malformed observations are rejected with ProtocolError and leave no partial step", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId } = await hardeningController({ observeResult: { nonsense: true } });
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
    const { controller, runId } = await hardeningController({ actResult: { totally: "malformed" } });
    await expect(controller.submitAction(act("h_bad"))).rejects.toMatchObject({
      name: "ProtocolError",
      code: "VALIDATION",
    });
    // No half-committed step; the pending action remains for recovery.
    expect(store!.getRunSteps(runId)).toHaveLength(0);
    expect(store!.getAction("h_bad")?.status).toBe("pending");
    await controller.close();
  });

  it("C12 (D11): validation failures do not consume step sequence numbers", async () => {
    openMemStore();
    artifacts = new ArtifactStore(join(tmpBase(), "art"));
    const { controller, runId, envId } = await hardeningController({ observeResult: { nonsense: true } });
    await expect(controller.observe(["state"])).rejects.toBeInstanceOf(ProtocolError);
    // A subsequent well-formed observation continues at sequence 1.
    const good = mockHandler();
    const client = inProcessAdapter(good);
    const recovered = new RunController(store!, artifacts!, new PolicyEngine(basePolicy), {
      runId,
      envId,
      adapter: client,
      caps,
    });
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
    finding.minimization = { probes: 4, removals: 1, verifiedReproduction: true };
    engine.transition(finding, "MINIMIZED", { reason: "minimized to 3 steps", actor: "test" });

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
