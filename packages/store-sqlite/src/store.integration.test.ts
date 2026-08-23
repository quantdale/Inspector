import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type OracleEvaluationRecord } from "./index.js";
import { MIGRATIONS } from "./migrations.js";

let dir: string | null = null;

function tmpDb(): string {
  dir = mkdtempSync(join(tmpdir(), "inspector-store-"));
  return join(dir, "run.db");
}

function removeDir(path: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

afterEach(() => {
  if (dir) {
    removeDir(dir);
    dir = null;
  }
});

describe("sqlite durable store", () => {
  it("preserves ordered steps across reopen and identifies unknown in-flight actions", () => {
    const path = tmpDb();
    const runId = "run_1";
    const envId = "env_1";

    {
      const store = Store.open(path);
      store.createRun({ id: runId, adapter: "adapter-fake" });
      store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });

      for (let i = 0; i < 3; i++) {
        store.commitStep({
          stepId: `step_${i}`,
          runId,
          environmentId: envId,
          sequence: i,
          action: {
            id: `act_${i}`,
            kind: "observe",
            risk: "observe",
            deadlineMs: 5000,
            idempotency: "safe-retry",
            status: "success",
            stateAfter: `state_${i}`,
          },
          observations: [
            {
              id: `obs_${i}`,
              stepId: `step_${i}`,
              sequence: i,
              source: "adapter-fake",
              capturedAt: new Date().toISOString(),
              summary: { index: i },
            },
          ],
        });
      }

      // Simulate an action request that never received a response (crash here).
      store.insertPendingAction({
        id: "act_lost",
        runId,
        environmentId: envId,
        kind: "click",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "never-retry",
      });

      // No finalize -> simulate process crash by simply closing.
      store.close();
    }

    // Restart: reopen and recover.
    const recovered = Store.open(path);
    const inFlight = recovered.markInFlightUnknown(runId);
    expect(inFlight.map((a) => a.id)).toContain("act_lost");
    const lost = recovered.getAction("act_lost");
    expect(lost?.status).toBe("unknown");

    const steps = recovered.getRunSteps(runId);
    expect(steps.map((s) => s.step.sequence)).toEqual([0, 1, 2]);
    expect(steps.every((s) => s.action?.status === "success")).toBe(true);
    expect(steps[0]?.observations[0]?.summary_json).toContain("index");
    recovered.close();
  });

  it("does not duplicate unknown outcomes on recovery", () => {
    const path = tmpDb();
    const runId = "run_dup";
    const envId = "env_dup";
    const store = Store.open(path);
    store.createRun({ id: runId });
    store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });
    store.insertPendingAction({
      id: "act_x",
      runId,
      environmentId: envId,
      kind: "navigate",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "observe-before-retry",
    });
    const first = store.markInFlightUnknown(runId);
    const second = store.markInFlightUnknown(runId);
    expect(first).toHaveLength(1);
    // The lost action remains in-flight (unknown) but is never duplicated.
    // Wave-2 hardening: only NEWLY lost actions are returned, so later
    // recovery passes report nothing instead of re-processing the same
    // unknown action (which multiplied synthetic observations per restart).
    expect(second).toHaveLength(0);
    const count = store.raw
      .prepare(`SELECT COUNT(*) AS c FROM actions WHERE run_id = ?`)
      .get(runId) as { c: number };
    expect(count.c).toBe(1);
    store.close();
  });
});

describe("hardening wave 2: sqlite store", () => {
  it("H1 (D4): schema_version holds a single PK-protected row across N opens", () => {
    const path = tmpDb();
    const first = Store.open(path);
    first.close();
    for (let i = 0; i < 3; i++) {
      const store = Store.open(path);
      const rows = store.raw
        .prepare(`SELECT version FROM schema_version`)
        .all() as Array<{
        version: number;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version).toBe(MIGRATIONS.length);
      const cols = store.raw
        .prepare(`PRAGMA table_info(schema_version)`)
        .all() as Array<{
        name: string;
        pk: number;
      }>;
      expect(cols.find((c) => c.name === "version")?.pk).toBe(1);
      store.close();
    }
  });

  it("H2 (D5): latest-checkpoint lookup breaks same-millisecond ties by insertion order", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_tie";
    store.createRun({ id: runId });
    const sameTs = "2026-01-01T00:00:00.000Z";
    const insert = store.raw.prepare(
      `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json) VALUES(?, ?, NULL, ?, ?)`,
    );
    insert.run("ck_a", runId, sameTs, JSON.stringify({ stepSeq: 1 }));
    insert.run("ck_b", runId, sameTs, JSON.stringify({ stepSeq: 2 }));
    const latest = store.getLatestCheckpoint(runId);
    expect(latest?.id).toBe("ck_b");
    expect(JSON.parse(latest!.payload_json)).toEqual({ stepSeq: 2 });
    store.close();
  });

  it("H3 (D2): re-inserting the same pending action id is idempotent, not a constraint crash", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_dup2";
    store.createRun({ id: runId });
    store.createEnvironment({ id: "env_dup2", runId, adapter: "adapter-fake" });
    const input = {
      id: "act_same",
      runId,
      environmentId: "env_dup2",
      kind: "click",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "safe-retry",
    };
    const first = store.insertPendingAction(input);
    expect(first.inserted).toBe(true);
    // Same id again (e.g. resubmission after an adapter error): explicit
    // continuation carrying the existing row instead of SQLITE_CONSTRAINT.
    const second = store.insertPendingAction(input);
    expect(second.inserted).toBe(false);
    expect(second.existing?.id).toBe("act_same");
    // Even after the action reached a terminal state, same-id insert stays
    // idempotent and never duplicates the row.
    store.finalizeAction("act_same", { status: "success" });
    const third = store.insertPendingAction(input);
    expect(third.inserted).toBe(false);
    expect(third.existing?.status).toBe("success");
    const count = store.raw
      .prepare(`SELECT COUNT(*) AS c FROM actions WHERE id = ?`)
      .get("act_same") as { c: number };
    expect(count.c).toBe(1);
    store.close();
  });

  it("H4 (D2): two concurrently pending actions may not share an idempotency key", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_idem";
    store.createRun({ id: runId });
    store.createEnvironment({ id: "env_idem", runId, adapter: "adapter-fake" });
    const base = {
      runId,
      environmentId: "env_idem",
      kind: "click",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "never-retry",
    };
    store.insertPendingAction({ ...base, id: "act_i1" });
    expect(() => store.insertPendingAction({ ...base, id: "act_i2" })).toThrow(
      /idempotency/i,
    );
    // Once the first action is decided, the key becomes reusable.
    store.finalizeAction("act_i1", { status: "success" });
    expect(() =>
      store.insertPendingAction({ ...base, id: "act_i2" }),
    ).not.toThrow();
    store.close();
  });

  it("H5 (D9): commitStep preserves the original requested_at evidence timestamp", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_ts";
    store.createRun({ id: runId });
    store.createEnvironment({ id: "env_ts", runId, adapter: "adapter-fake" });
    store.insertPendingAction({
      id: "act_ts",
      runId,
      environmentId: "env_ts",
      kind: "click",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "safe-retry",
    });
    const original = "2000-01-01T00:00:00.000Z";
    store.raw
      .prepare(`UPDATE actions SET requested_at = ? WHERE id = ?`)
      .run(original, "act_ts");
    store.commitStep({
      stepId: "step_ts",
      runId,
      environmentId: "env_ts",
      sequence: 0,
      action: {
        id: "act_ts",
        kind: "click",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
        status: "success",
        stateAfter: "s1",
      },
      observations: [],
    });
    const row = store.getAction("act_ts");
    expect(row?.requested_at).toBe(original); // evidence timestamp untouched
    expect(row?.status).toBe("success"); // outcome still recorded
    expect(row?.decided_at).not.toBe(original);
    store.close();
  });

  it("H6 (D10): opens configure a busy_timeout so concurrent processes retry", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const timeout = store.raw.pragma("busy_timeout", {
      simple: true,
    }) as number;
    expect(timeout).toBeGreaterThanOrEqual(1000);
    store.close();
  });

  it("H7 (D10): repeated recovery passes do not re-report already-lost actions", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_multi";
    store.createRun({ id: runId });
    store.createEnvironment({
      id: "env_multi",
      runId,
      adapter: "adapter-fake",
    });
    store.insertPendingAction({
      id: "act_lost_once",
      runId,
      environmentId: "env_multi",
      kind: "click",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "observe-before-retry",
    });
    const first = store.markInFlightUnknown(runId);
    expect(first.map((a) => a.id)).toEqual(["act_lost_once"]);
    // The action stays durably 'unknown', but later resumes must not treat it
    // as newly lost (recovery would otherwise multiply synthetic steps).
    const second = store.markInFlightUnknown(runId);
    expect(second).toHaveLength(0);
    const third = store.markInFlightUnknown(runId);
    expect(third).toHaveLength(0);
    const row = store.getAction("act_lost_once");
    expect(row?.status).toBe("unknown");
    store.close();
  });

  it("H8 (D12): finding wave-1 fields round-trip through reopen", () => {
    const path = tmpDb();
    const at = "2026-01-02T03:04:05.000Z";
    const record = {
      id: "find_rt",
      runId: "run_rt",
      status: "CONFIRMED" as const,
      title: "t",
      confidence: 0.75,
      severity: "high",
      revision: "rev1",
      oracleIds: JSON.stringify(["oracle-page-error"]),
      reproductionJson: JSON.stringify({ attempts: 3, successes: 3 }),
      artifactRefs: JSON.stringify(["art_1"]),
      createdAt: at,
      updatedAt: at,
      signature: "PAGE_ERROR",
      minimizationJson: JSON.stringify({
        probes: 5,
        removals: 2,
        verifiedReproduction: true,
      }),
      lastTransitionJson: JSON.stringify({
        from: "CANDIDATE",
        to: "CONFIRMED",
        at,
        reason: "r",
        actor: "test",
      }),
      adapter: "adapter-fake",
      classKey: "PAGE_ERROR|x",
    };
    {
      const store = Store.open(path);
      store.putFinding(record);
      store.close();
    }
    const reopened = Store.open(path);
    const got = reopened.getFinding("find_rt");
    expect(got).toBeDefined();
    expect(got!.runId).toBe("run_rt");
    expect(got!.signature).toBe("PAGE_ERROR");
    expect(JSON.parse(got!.minimizationJson!)).toEqual({
      probes: 5,
      removals: 2,
      verifiedReproduction: true,
    });
    expect(JSON.parse(got!.lastTransitionJson!)).toMatchObject({
      from: "CANDIDATE",
      to: "CONFIRMED",
    });
    expect(got!.adapter).toBe("adapter-fake");
    expect(got!.classKey).toBe("PAGE_ERROR|x");
    // Updates persist the extended fields too.
    reopened.putFinding({
      ...record,
      signature: "IMPOSSIBLE_STATE",
      status: "RESOLVED" as const,
    });
    expect(reopened.getFinding("find_rt")?.signature).toBe("IMPOSSIBLE_STATE");
    reopened.close();
  });

  it("H9 (D12): getFinding maps snake_case columns onto the FindingRecord shape", () => {
    const path = tmpDb();
    const store = Store.open(path);
    store.putFinding({
      id: "find_map",
      runId: "run_map",
      status: "CANDIDATE",
      title: "t",
      confidence: 0.5,
      severity: null,
      revision: null,
      oracleIds: JSON.stringify([]),
      reproductionJson: null,
      artifactRefs: JSON.stringify([]),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      signature: null,
      minimizationJson: null,
      lastTransitionJson: null,
      adapter: null,
    });
    const got = store.getFinding("find_map")!;
    expect(got.runId).toBe("run_map");
    expect(got.oracleIds).toBe(JSON.stringify([]));
    expect(got.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(got.updatedAt).toBeTruthy();
    expect(store.listFindings()[0]?.id).toBe("find_map");
    store.close();
  });

  it("H10 (D3): countRunActions counts every admitted action regardless of status", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_count";
    store.createRun({ id: runId });
    store.createEnvironment({
      id: "env_count",
      runId,
      adapter: "adapter-fake",
    });
    store.commitStep({
      stepId: "step_c1",
      runId,
      environmentId: "env_count",
      sequence: 0,
      action: {
        id: "act_done",
        kind: "click",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
        status: "success",
      },
      observations: [],
    });
    store.insertPendingAction({
      id: "act_inflight",
      runId,
      environmentId: "env_count",
      kind: "click",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "never-retry",
    });
    expect(store.countRunActions(runId)).toBe(2);
    expect(store.countRunActions("run_missing")).toBe(0);
    store.close();
  });

  it("H10b (D5): maxRunStepSequence returns the durable floor for resume sequencing", () => {
    const path = tmpDb();
    const store = Store.open(path);
    const runId = "run_seq";
    store.createRun({ id: runId });
    store.createEnvironment({ id: "env_seq", runId, adapter: "adapter-fake" });
    expect(store.maxRunStepSequence(runId)).toBe(0);
    expect(store.maxRunStepSequence("run_missing")).toBe(0);
    for (const seq of [1, 5, 3]) {
      store.commitStep({
        stepId: `step_seq_${seq}`,
        runId,
        environmentId: "env_seq",
        sequence: seq,
        action: {
          id: `act_seq_${seq}`,
          kind: "click",
          risk: "interact",
          deadlineMs: 5000,
          idempotency: "safe-retry",
          status: "success",
        },
        observations: [],
      });
    }
    expect(store.maxRunStepSequence(runId)).toBe(5);
    store.close();
  });
});

describe("oracle evaluation records", () => {
  function evalRecord(
    i: number,
    overrides: Partial<OracleEvaluationRecord> = {},
  ): OracleEvaluationRecord {
    return {
      id: `oev_${i}`,
      runId: "run_oe",
      stepId: null,
      findingId: "find_oe",
      subjectKey: "a1>a2>a3",
      phase: "reproduce",
      oracleId: i % 2 === 0 ? "page-error" : "target-failure",
      oracleKind: "invariant",
      oracleStrength: "hard",
      oracleClass: "invariant",
      reproduced: i % 2 === 0,
      confidence: 0.9,
      expected: "no defect signal on replay",
      observed: i % 2 === 0 ? "PAGE_ERROR" : "(none)",
      explanation: "test record",
      version: "oracle-eval/1",
      createdAt: `2026-01-01T00:00:0${i}.000Z`,
      ...overrides,
    };
  }

  it("round-trips records, preserves insertion order, and survives reopen", () => {
    const path = tmpDb();
    {
      const store = Store.open(path);
      store.putOracleEvaluation(evalRecord(1));
      store.putOracleEvaluation(evalRecord(2));
      store.putOracleEvaluation(evalRecord(3));
      const listed = store.listOracleEvaluationsForFinding("find_oe");
      expect(listed.map((r) => r.id)).toEqual(["oev_1", "oev_2", "oev_3"]);
      expect(listed[0]!.reproduced).toBe(false);
      expect(listed[1]!.reproduced).toBe(true);
      expect(listed[1]!.confidence).toBeCloseTo(0.9);
      expect(listed[1]!.oracleClass).toBe("invariant");
      // By-run listing covers the same rows.
      expect(
        store.listOracleEvaluationsForRun("run_oe").map((r) => r.id),
      ).toEqual(["oev_1", "oev_2", "oev_3"]);
      store.close();
    }
    // Restart durability: the full history is readable after reopen.
    const reopened = Store.open(path);
    const rows = reopened.listOracleEvaluationsForFinding("find_oe");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.oracleId)).toEqual([
      "target-failure",
      "page-error",
      "target-failure",
    ]);
    expect(rows.every((r) => r.version === "oracle-eval/1")).toBe(true);
    expect(rows[2]!.phase).toBe("reproduce");
    reopened.close();
  });

  it("keeps phases and nullable provenance fields distinct per row", () => {
    const path = tmpDb();
    const store = Store.open(path);
    // Minimize-phase baseline probe: not yet attached to a finding (nullable
    // provenance) — findable by run, not by finding id.
    store.putOracleEvaluation(
      evalRecord(4, {
        phase: "minimize",
        findingId: null,
        subjectKey: "a1>a3",
      }),
    );
    // Repair-verify row attached to the finding even when other fields are null.
    store.putOracleEvaluation(
      evalRecord(5, {
        phase: "repair-verify",
        runId: null,
        oracleKind: null,
        oracleStrength: null,
        oracleClass: null,
        confidence: null,
      }),
    );
    const byRun = store.listOracleEvaluationsForRun("run_oe");
    expect(byRun.map((r) => r.phase)).toEqual(["minimize"]);
    expect(byRun[0]!.findingId).toBeNull();
    expect(byRun[0]!.subjectKey).toBe("a1>a3");
    const rows = store.listOracleEvaluationsForFinding("find_oe");
    expect(rows.map((r) => r.phase)).toEqual(["repair-verify"]);
    expect(rows[0]!.runId).toBeNull();
    expect(rows[0]!.oracleKind).toBeNull();
    expect(rows[0]!.confidence).toBeNull();
    expect(store.listOracleEvaluationsForFinding("find_other")).toEqual([]);
    store.close();
  });
});
