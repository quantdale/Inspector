import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, AdapterServer, type AdapterHandler } from "@inspector/adapter-sdk";
import { RunManager, RunController } from "./run-manager.js";
import { PolicyEngine, type Policy } from "./policy.js";
import type { Action, Observation, CapabilityDoc, ActionOutcome } from "@inspector/protocol";

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, "..", "..", "adapter-fake", "src", "bin.ts");

let dir: string | null = null;
let store: Store | null = null;
let artifacts: ArtifactStore | null = null;

function tmpDir(): string {
  dir = mkdtempSync(join(tmpdir(), "inspector-core-"));
  return dir;
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

function fakeRunOptions(faults: Record<string, unknown> = {}) {
  return {
    adapterCommand: process.execPath,
    adapterArgs: ["--import", "tsx", fakeBin],
    adapterEnv: { ...process.env, FAKE_FAULTS: JSON.stringify(faults) },
  };
}

function act(id: string, kind: string, risk: Action["risk"] = "interact", input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk, deadlineMs: 5000, idempotency: "safe-retry", input };
}

function inProcessAdapter(handler: AdapterHandler): AdapterClient {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const client = AdapterClient.overStreams(toClient, toServer);
  new AdapterServer(toServer, toClient, handler);
  return client;
}

const denyPublish: Policy = {
  name: "deny-publish",
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

describe("core run manager (acceptance 1-5,7,8)", () => {
  it("1: happy-path run persists exact ordered events", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));
    const mgr = new RunManager(store, artifacts);
    const run = await mgr.startRun(fakeRunOptions());

    await run.submitAction(act("a1", "openForm"));
    await run.submitAction(act("a2", "fillField", "interact", { name: "default", value: "ok" }));
    const submit = await run.submitAction(act("a3", "submit"));
    expect(submit.kind).toBe("outcome");

    const steps = store!.getRunSteps(run.runId);
    const actionSteps = steps.filter((s) => s.action);
    expect(actionSteps.map((s) => s.action?.id)).toEqual(["a1", "a2", "a3"]);
    expect(actionSteps.every((s) => s.action?.status === "success")).toBe(true);
    expect(steps.map((s) => s.step.sequence)).toEqual([1, 2, 3]);
    await run.close();
  });

  it("4: policy rejects a forbidden capability before the adapter is contacted", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));

    let actCalls = 0;
    const mock: AdapterHandler = {
      async initialize() {
        return { protocolVersion: "0.1", adapter: "mock", capabilities: { observe: ["state"], act: ["publish"], lifecycle: ["reset"] } } as CapabilityDoc;
      },
      async observe() {
        return { id: "obs", runId: "run", environmentId: "env", sequence: 0, source: "mock", capturedAt: new Date().toISOString(), summary: {} } as Observation;
      },
      async act() {
        actCalls += 1;
        return { actionId: "x", runId: "run", environmentId: "env", status: "success", observedAt: new Date().toISOString() } as ActionOutcome;
      },
      async lifecycle() {
        return { ok: true };
      },
      async health() {
        return { ok: true, uptimeMs: 0, now: new Date().toISOString() };
      },
      async cancel() {},
    };

    const engine = new PolicyEngine(denyPublish);
    const client = inProcessAdapter(mock);
    store.createRun({ id: "runX" });
    store.createEnvironment({ id: "envX", runId: "runX", adapter: "mock" });
    const controller = new RunController(store, artifacts, engine, {
      runId: "runX",
      envId: "envX",
      adapter: client,
      caps: (await client.request("initialize", {})) as CapabilityDoc,
    });

    const result = await controller.submitAction(act("bad", "publish", "publish"));
    expect(result.kind).toBe("rejected");
    expect((result as { decision: { code: string } }).decision.code).toBe("CAPABILITY_DENIED");
    expect(actCalls).toBe(0);
    expect(store.getAction("bad")).toBeUndefined();
    await controller.close();
  });

  it("5: budget exhaustion is deterministic", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));
    const tiny: Policy = { ...denyPublish, name: "tiny", budgets: { ...denyPublish.budgets, max_actions: 1 } };
    const mgr = new RunManager(store, artifacts, new PolicyEngine(tiny));
    const run = await mgr.startRun(fakeRunOptions());
    expect((await run.submitAction(act("a1", "openForm"))).kind).toBe("outcome");
    const second = await run.submitAction(act("a2", "openForm"));
    expect(second.kind).toBe("rejected");
    await run.close();
  });

  it("3+7: unknown-outcome action is not blindly duplicated on restart; crash classified separately", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));
    const mgr = new RunManager(store, artifacts);

    const run1 = await mgr.startRun(fakeRunOptions({ crashActionId: "crash1" }));
    const crashed = await run1.submitAction(act("crash1", "openForm"));
    expect(crashed.kind).toBe("adapter-error");
    // The action is still pending in durable store (not finalized).
    expect(store.getAction("crash1")?.status).toBe("pending");
    await run1.close().catch(() => {});

    // New process resumes the same run from durable state.
    const mgr2 = new RunManager(store, artifacts);
    const run2 = await mgr2.resumeRun(run1.runId, fakeRunOptions());
    const lost = store.getAction("crash1");
    expect(lost?.status).toBe("unknown");
    const count = store.raw.prepare(`SELECT COUNT(*) AS c FROM actions WHERE id = ?`).get("crash1") as { c: number };
    expect(count.c).toBe(1); // not duplicated
    await run2.close();
  });

  it("FIELD-1 regression: resume replays the durable create spec (lifecycle.create + spawn-env delta) so re-observation works on a fresh process; targeted web runs must not silently retarget", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));
    const logFile = join(base, "lifecycle.jsonl");
    const strictBin = join(here, "fixtures", "strict-lifecycle-adapter.mjs");
    const spawnOpts = () => ({
      adapterCommand: process.execPath,
      adapterArgs: ["--import", "tsx", strictBin],
      // Callers merge the delta into the spawn env (adapterSpawn does) AND
      // pass it separately so startRun can persist it durably.
      adapterEnv: {
        ...process.env,
        LIFECYCLE_LOG_FILE: logFile,
        STRICT_TARGET: "http://127.0.0.1:9/",
      },
    });
    const mgr = new RunManager(store!, artifacts!);
    const run1 = await mgr.startRun({
      ...spawnOpts(),
      createOptions: { targetUrl: "http://127.0.0.1:9/" },
      // Simulates hunt.ts's WEB_TARGET_URL spawn-env delta.
      spawnEnvDelta: { STRICT_TARGET: "http://127.0.0.1:9/" },
    });
    expect((await run1.submitAction(act("s1", "noop"))).kind).toBe("outcome");

    // Abrupt host death: the adapter dies mid-flight and NEITHER process runs
    // a cooperative close(). A fresh manager (fresh "process") resumes.
    const dieOutcome = await run1.submitAction(act("die1", "noop", "interact", { value: "die" }));
    expect(dieOutcome.kind).toBe("adapter-error");

    const mgr2 = new RunManager(store!, artifacts!);
    const run2 = await mgr2.resumeRun(run1.runId, spawnOpts());
    // THE REGRESSION: before the fix this threw "environment not created"
    // because resume never issued lifecycle.create on the fresh subprocess,
    // and the persisted target env was lost (default-target retargeting).
    const obs = await run2.observe(["state"]);
    expect(obs).toBeTruthy();

    // Prove faithful replay: the resumed create carried the SAME durable
    // options AND the persisted spawn-env delta reached the new process.
    const creates = readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { op: string; options: { targetUrl?: string } | null; strictTargetSeen: string | null })
      .filter((e) => e.op === "create");
    expect(creates.length).toBe(2);
    expect(creates[0]!.options?.targetUrl).toBe("http://127.0.0.1:9/");
    expect(creates[1]!.options?.targetUrl).toBe("http://127.0.0.1:9/");
    expect(creates[0]!.strictTargetSeen).toBe("http://127.0.0.1:9/");
    expect(creates[1]!.strictTargetSeen).toBe("http://127.0.0.1:9/");
    await run2.close();
  });

  it("8: artifact hash/metadata round-trips", async () => {
    const base = tmpDir();
    store = Store.open(join(base, "run.db"));
    artifacts = new ArtifactStore(join(base, "artifacts"));
    const mgr = new RunManager(store, artifacts);
    const run = await mgr.startRun(fakeRunOptions());
    const content = Buffer.from("deterministic artifact bytes");
    const meta = artifacts.write({ runId: run.runId, content, mime: "text/plain" });
    expect(meta.size).toBe(content.byteLength);
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    // Round-trip: read back and re-verify the hash.
    const readBack = artifacts.read(run.runId, meta.sha256);
    expect(readBack.equals(content)).toBe(true);
    expect(artifacts.verify(run.runId, meta.sha256)).toBe(true);
    await run.close();
  });
});
