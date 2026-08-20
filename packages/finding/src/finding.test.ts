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

