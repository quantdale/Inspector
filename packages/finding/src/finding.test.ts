import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@inspector/store-sqlite";
import {
  FindingEngine,
  FakeStateMachineDriver,
  FlakyDriver,
  OracleEngine,
  type Action,
  type OracleSignal,
  type ReplayDriver,
  type ReplayResult,
} from "./index.js";

let dir: string | null = null;
let store: Store | null = null;
afterEach(() => {
  if (store) {
    store.close();
    store = null;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 5000, idempotency: "safe-retry", input };
}

const defectActions: Action[] = [
  act("a1", "openForm"),
  act("a2", "fillField", { name: "default", value: "BAD" }),
  act("a3", "submit"),
];

const okActions: Action[] = [
  act("a1", "openForm"),
  act("a2", "fillField", { name: "default", value: "ok" }),
  act("a3", "submit"),
];

// PART2

describe("finding engine (M2)", () => {
  it("ingest creates a CANDIDATE finding", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" }, { title: "submit invalid" });
    expect(f.status).toBe("CANDIDATE");
    expect(f.oracleIds.length).toBeGreaterThan(0);
  });

  it("deterministic defect becomes CONFIRMED after policy is met", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding, stats } = await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), {
      attempts: 3,
      minSuccesses: 3,
    });
    expect(finding.status).toBe("CONFIRMED");
    expect(stats.successes).toBe(3);
    expect(finding.confidence).toBe(1);
  });

  it("evaluate() exposes which registered oracles matched", async () => {
    const engine = OracleEngine.defaults();
    const clean = engine.evaluate({ outcomes: [], signals: [], observations: [] });
    expect(clean.reproduced).toBe(false);
    expect(clean.matchedOracleIds).toEqual([]);
    const hit = engine.evaluate(await new FakeStateMachineDriver().replay(defectActions));
    expect(hit.reproduced).toBe(true);
    expect(hit.matchedOracleIds).toContain("signal:DEFECT_SUBMIT_INVALID");
  });

  it("confirmed findings record the deciding oracle ids in reproduction stats", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding } = await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), {
      attempts: 2,
      minSuccesses: 2,
    });
    expect(finding.status).toBe("CONFIRMED");
    expect(finding.reproduction?.matchedOracleIds).toBeDefined();
    expect(finding.reproduction!.matchedOracleIds!.length).toBeGreaterThan(0);
    // Rejected runs must not claim any oracle fired.
    const g = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding: rejected } = await engine.reproduce(g, okActions, new FakeStateMachineDriver(), {
      attempts: 1,
      minSuccesses: 1,
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reproduction?.matchedOracleIds).toBeUndefined();
  });

  it("non-defect suspicion is rejected", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding } = await engine.reproduce(f, okActions, new FakeStateMachineDriver(), {
      attempts: 3,
      minSuccesses: 3,
    });
    expect(finding.status).toBe("REJECTED");
  });

  // PART3

  it("minimized sequence is no longer than original and still reproduces", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const noisy: Action[] = [
      act("a0", "openForm"),
      act("a1", "fillField", { name: "default", value: "ok" }),
      act("a2", "openForm"),
      act("a3", "fillField", { name: "default", value: "BAD" }),
      act("a4", "submit"),
    ];
    const minimized = await engine.minimize(f, noisy, new FakeStateMachineDriver());
    expect(minimized.length).toBeLessThanOrEqual(noisy.length);
    const rerun = await new FakeStateMachineDriver().replay(minimized);
    expect(OracleEngine.defaults().evaluate(rerun).reproduced).toBe(true);
  });

  it("flaky behavior is not mislabeled deterministic", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding } = await engine.reproduce(f, defectActions, new FlakyDriver(new FakeStateMachineDriver(), true), {
      attempts: 4,
      minSuccesses: 4,
    });
    expect(finding.status).toBe("FLAKY");
  });

  it("produces an evidence bundle and regression scenario", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), { attempts: 3, minSuccesses: 3 });
    const minimized = await engine.minimize(f, defectActions, new FakeStateMachineDriver());
    const bundle = engine.buildBundle(f, defectActions, minimized, { revision: "rev1" });
    expect(bundle.schema).toBe("inspector-evidence/1");
    expect(bundle.minimizedSteps.length).toBeLessThanOrEqual(defectActions.length);
    const reg = engine.exportRegression(f, minimized, "DEFECT_SUBMIT_INVALID");
    expect(reg.schema).toBe("inspector-regression/1");
  });

  // PART4

  it("state survives controller restart during reproduction", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-find-"));
    store = Store.open(join(dir, "run.db"));
    const engine = new FindingEngine(undefined, store);
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), { attempts: 3, minSuccesses: 3 });
    store.close();
    const reopened = Store.open(join(dir, "run.db"));
    const record = reopened.getFinding(f.id);
    expect(record).toBeDefined();
    expect(record!.status).toBe("CONFIRMED");
    reopened.close();
  });

  it("rejects invalid finding transitions", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    expect(() => engine.transition(f, "MINIMIZED")).toThrow(/invalid finding transition/);
  });
});

class HungDriver implements ReplayDriver {
  async replay(): Promise<ReplayResult> {
    return new Promise<ReplayResult>(() => {});
  }
}

describe("hardening: reproduction integrity", () => {
  it("rejects a zero-attempt policy instead of confirming with NaN confidence", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    await expect(
      engine.reproduce(f, defectActions, new FakeStateMachineDriver(), {
        attempts: 0,
        minSuccesses: 0,
      }),
    ).rejects.toThrow(/policy/i);
    expect(f.status).toBe("CANDIDATE");
  });

  it("rejects minSuccesses above attempts and non-positive/fractional policies", async () => {
    const engine = new FindingEngine();
    for (const policy of [
      { attempts: 2, minSuccesses: 3 },
      { attempts: 2, minSuccesses: 0 },
      { attempts: -1, minSuccesses: 1 },
      { attempts: 1.5, minSuccesses: 1 },
    ]) {
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      await expect(
        engine.reproduce(f, defectActions, new FakeStateMachineDriver(), policy),
      ).rejects.toThrow(/policy/i);
      expect(f.status).toBe("CANDIDATE");
    }
  });

  it("confidence stays finite and within [0,1] for every settled policy", async () => {
    const engine = new FindingEngine();
    const flaky = new FlakyDriver(new FakeStateMachineDriver(), true);
    for (const policy of [
      { attempts: 1, minSuccesses: 1 },
      { attempts: 4, minSuccesses: 4 },
      { attempts: 4, minSuccesses: 2 },
    ]) {
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      const { finding } = await engine.reproduce(f, defectActions, flaky, policy);
      expect(Number.isFinite(finding.confidence)).toBe(true);
      expect(finding.confidence).toBeGreaterThanOrEqual(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a finding indeterminate (not REJECTED) when every replay attempt times out", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const startedAt = Date.now();
    const { stats, finding } = await engine.reproduce(
      f,
      defectActions,
      new HungDriver(),
      { attempts: 2, minSuccesses: 1, perAttemptTimeoutMs: 25 },
    );
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(stats.successes).toBe(0);
    expect(stats.errors).toBe(2);
    expect(stats.lastError ?? "").toMatch(/timed out/i);
    // H5-D9: all-error reproduction has no positive non-reproduction evidence,
    // so the finding stays non-terminal/indeterminate instead of REJECTED.
    expect(finding.status).toBe("CANDIDATE");
  });

  it("rejects a candidate only when replays execute cleanly and never reproduce", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    // A driver that always executes cleanly and never emits a defect signal.
    const cleanDriver: ReplayDriver = {
      async replay() {
        return { outcomes: [], signals: [], observations: [] };
      },
    };
    const { finding } = await engine.reproduce(f, defectActions, cleanDriver, {
      attempts: 2,
      minSuccesses: 1,
    });
    expect(finding.status).toBe("REJECTED");
  });

  it("keeps REPRODUCING -> CANDIDATE open as the recovery path", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    engine.transition(f, "REPRODUCING");
    expect(() => engine.transition(f, "CANDIDATE")).not.toThrow();
    expect(f.status).toBe("CANDIDATE");
  });

  it("records optional reason/actor metadata on transitions", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    engine.transition(f, "NEEDS_HUMAN_ORACLE");
    engine.transition(f, "CONFIRMED", {
      reason: "human oracle confirmed the defect",
      actor: "analyst-7",
    });
    expect(f.lastTransition).toMatchObject({
      from: "NEEDS_HUMAN_ORACLE",
      to: "CONFIRMED",
      reason: "human oracle confirmed the defect",
      actor: "analyst-7",
    });
  });

  it("transitions without metadata remain backward compatible", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    engine.transition(f, "REJECTED");
    expect(f.lastTransition?.from).toBe("CANDIDATE");
    expect(f.lastTransition?.to).toBe("REJECTED");
  });

  it("derives the regression adapter from finding metadata, falling back to adapter-fake", () => {
    const engine = new FindingEngine();
    const web = engine.ingest(
      { kind: "DEFECT_SUBMIT_INVALID" },
      { adapter: "adapter-web" },
    );
    expect(
      engine.exportRegression(web, defectActions, "DEFECT_SUBMIT_INVALID").adapter,
    ).toBe("adapter-web");
    const plain = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    expect(
      engine.exportRegression(plain, defectActions, "DEFECT_SUBMIT_INVALID").adapter,
    ).toBe("adapter-fake");
  });

  it("populates oracleEvidence and merges artifactRefs into the bundle", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    f.artifactRefs.push("artifact://shots/1.png");
    const signals: OracleSignal[] = [
      { kind: "DEFECT_SUBMIT_INVALID", detail: "submit BAD" },
    ];
    const bundle = engine.buildBundle(f, defectActions, defectActions, {
      signals,
      artifactRefs: ["artifact://logs/run.log"],
    });
    expect(bundle.oracleEvidence).toEqual(signals);
    expect([...bundle.artifactRefs].sort()).toEqual([
      "artifact://logs/run.log",
      "artifact://shots/1.png",
    ]);
  });
});

describe("oracle evaluation provenance records", () => {
  function openTempStore(): Store {
    dir = mkdtempSync(join(tmpdir(), "inspector-oeval-"));
    store = Store.open(join(dir, "run.db"));
    return store;
  }

  /** A store whose oracle-evaluation writes fail, to prove containment. */
  function throwingEvaluationStore(real: Store): Store {
    const throwing = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
    throwing.putOracleEvaluation = () => {
      throw new Error("simulated disk failure");
    };
    return throwing as Store;
  }

  it("persists one record per registered oracle per reproduction attempt", async () => {
    const st = openTempStore();
    const engine = new FindingEngine(undefined, st);
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" }, { runId: "run_prov" });
    await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), {
      attempts: 2,
      minSuccesses: 2,
    });
    const rows = st.listOracleEvaluationsForFinding(f.id);
    // OracleEngine.defaults() registers five oracles; every attempt evaluates
    // ALL of them, matched or not.
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.phase === "reproduce")).toBe(true);
    expect(rows.every((r) => r.runId === "run_prov")).toBe(true);
    expect(rows.every((r) => r.version === "oracle-eval/1")).toBe(true);
    expect(new Set(rows.map((r) => r.oracleId)).size).toBe(5);
    // The firing oracle is marked reproduced; clean oracles are recorded as ran-but-silent.
    const submitInvalid = rows.filter((r) => r.oracleId === "signal:DEFECT_SUBMIT_INVALID");
    expect(submitInvalid.map((r) => r.reproduced)).toEqual([true, true]);
    const silent = rows.find((r) => r.oracleId === "signal:ADAPTER_CRASH");
    expect(silent?.reproduced).toBe(false);
    // Observed summaries are per evaluation event (shared by all oracles of
    // that replay), listing signal kinds and crash codes compactly.
    expect(silent?.observed).toBe("DEFECT_SUBMIT_INVALID,TARGET_FAILURE");
    expect(rows[0]!.subjectKey).toBe("a1>a2>a3");
  });

  it("persists minimize-phase verification records", async () => {
    const st = openTempStore();
    const engine = new FindingEngine(undefined, st);
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), { attempts: 1, minSuccesses: 1 });
    await engine.minimize(f, defectActions, new FakeStateMachineDriver());
    const rows = st.listOracleEvaluationsForFinding(f.id).filter((r) => r.phase === "minimize");
    // Baseline probe + at least one reduction probe, each over all oracles.
    expect(rows.length).toBeGreaterThanOrEqual(2 * 5);
    expect(rows.some((r) => r.reproduced)).toBe(true);
  });

  it("embeds the persisted evaluation history into evidence bundles", async () => {
    const st = openTempStore();
    const engine = new FindingEngine(undefined, st);
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), { attempts: 1, minSuccesses: 1 });
    const minimized = await engine.minimize(f, defectActions, new FakeStateMachineDriver());
    const bundle = engine.buildBundle(f, defectActions, minimized, { revision: "rev1" });
    expect(bundle.evaluations.length).toBeGreaterThan(0);
    expect(bundle.evaluations.every((r) => r.findingId === f.id)).toBe(true);
    // Immutability guarantee holds for the embedded history too.
    expect(Object.isFrozen(bundle.evaluations)).toBe(true);
    expect(() => {
      (bundle.evaluations as unknown as { push: (...args: unknown[]) => unknown }).push("x");
    }).toThrow();
  });

  it("contains evaluation-persistence failures without breaking the pipeline", async () => {
    const st = openTempStore();
    const engine = new FindingEngine(undefined, throwingEvaluationStore(st));
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding } = await engine.reproduce(f, defectActions, new FakeStateMachineDriver(), {
      attempts: 2,
      minSuccesses: 2,
    });
    expect(finding.status).toBe("CONFIRMED");
    expect(st.getFinding(f.id)?.status).toBe("CONFIRMED");
  });
});

