import { describe, it, expect } from "vitest";
import {
  FindingEngine,
  FakeStateMachineDriver,
  FlakyDriver,
  OracleEngine,
  type Action,
  type ActionOutcome,
  type FindingEngineOptions,
  type Oracle,
  type OracleSignal,
  type Observation,
  type ReplayDriver,
  type ReplayResult,
} from "./index.js";

// Phase-D style FP/FN fixtures: true defects must reproduce; benign states
// and automation misses must never count as reproduction.

// --- scripted drivers -------------------------------------------------------

class StaticDriver implements ReplayDriver {
  constructor(private readonly result: ReplayResult) {}
  async replay(): Promise<ReplayResult> {
    return this.result;
  }
}

class ThrowingDriver implements ReplayDriver {
  constructor(private readonly message: string) {}
  async replay(): Promise<ReplayResult> {
    throw new Error(this.message);
  }
}

/** Returns canned results keyed by comma-joined action ids; unknown paths are clean runs. */
class KeyedDriver implements ReplayDriver {
  constructor(private readonly table: Map<string, ReplayResult>) {}
  async replay(actions: Action[]): Promise<ReplayResult> {
    return this.table.get(actions.map((a) => a.id).join(",")) ?? EMPTY;
  }
}

class PredicateOracle implements Oracle {
  readonly id: string;
  constructor(
    id: string,
    private readonly predicate: (result: ReplayResult) => boolean,
  ) {
    this.id = id;
  }
  detect(result: ReplayResult): boolean {
    return this.predicate(result);
  }
}

// --- fixture helpers --------------------------------------------------------

const EMPTY: ReplayResult = { outcomes: [], signals: [], observations: [] };

function staticRun(result: ReplayResult): ReplayDriver {
  return new StaticDriver(result);
}

function sig(kinds: string[]): ReplayResult {
  return {
    outcomes: [],
    signals: kinds.map((kind) => ({ kind: kind as OracleSignal["kind"] })),
    observations: [],
  };
}

function outcome(
  actionId: string,
  status: ActionOutcome["status"],
  code?: NonNullable<ActionOutcome["error"]>["code"],
): ActionOutcome {
  return {
    actionId,
    runId: "run",
    environmentId: "env",
    status,
    observedAt: new Date().toISOString(),
    ...(code ? { error: { code, message: `${code} (fixture)` } } : {}),
  };
}

let obsSeq = 0;
function observation(summary: Record<string, unknown>): Observation {
  obsSeq += 1;
  return {
    id: `obs-${obsSeq}`,
    runId: "run",
    environmentId: "env",
    sequence: obsSeq,
    source: "fixture",
    capturedAt: new Date().toISOString(),
    summary,
  };
}

function act(id: string): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind: "click",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input: {},
  };
}

const PATH: Action[] = [act("a1"), act("a2"), act("a3")];

// --- TRUE defects -----------------------------------------------------------

const trueDefects: Array<{ name: string; engine: FindingEngine; driver: ReplayDriver }> = [
  {
    name: "crash signal (PAGE_ERROR)",
    engine: new FindingEngine(),
    driver: staticRun(sig(["PAGE_ERROR"])),
  },
  {
    name: "impossible state (IMPOSSIBLE_STATE)",
    engine: new FindingEngine(),
    driver: staticRun(sig(["IMPOSSIBLE_STATE"])),
  },
  {
    name: "persistence corruption",
    engine: new FindingEngine(
      new OracleEngine([
        new PredicateOracle(
          "persistence-corruption",
          (r) => r.observations.some((o) => o.summary["persisted"] === false),
        ),
      ]),
    ),
    driver: staticRun({
      outcomes: [],
      signals: [],
      observations: [observation({ key: "theme", persisted: false })],
    }),
  },
  {
    name: "broken invariant",
    engine: new FindingEngine(
      new OracleEngine([
        new PredicateOracle(
          "invariant-cart-total",
          (r) => r.observations.some((o) => o.summary["cartTotal"] === -1),
        ),
      ]),
    ),
    driver: staticRun({
      outcomes: [],
      signals: [],
      observations: [observation({ cartTotal: -1 })],
    }),
  },
  {
    name: "explicit target error (TARGET_FAILURE outcome)",
    engine: new FindingEngine(),
    driver: staticRun({
      outcomes: [outcome("a3", "target-failure", "TARGET_FAILURE")],
      signals: [],
      observations: [],
    }),
  },
];

// --- NON-defects ------------------------------------------------------------

const nonDefects: Array<{ name: string; result: ReplayResult }> = [
  {
    name: "expected deprecation warning",
    result: {
      outcomes: [outcome("a2", "success")],
      signals: [],
      observations: [observation({ warning: "deprecated API" })],
    },
  },
  {
    name: "disabled button automation miss (ACTION_FAILED)",
    result: {
      outcomes: [outcome("a2", "target-failure", "ACTION_FAILED")],
      signals: [],
      observations: [],
    },
  },
  {
    name: "loading state",
    result: {
      outcomes: [outcome("a2", "success")],
      signals: [],
      observations: [observation({ loading: true })],
    },
  },
  {
    name: "empty state",
    result: {
      outcomes: [outcome("a2", "success")],
      signals: [],
      observations: [observation({ items: 0 })],
    },
  },
  {
    name: "harmless console log",
    result: {
      outcomes: [outcome("a2", "success")],
      signals: [],
      observations: [observation({ log: "[info] app ready" })],
    },
  },
  {
    name: "intentional retry succeeds",
    result: {
      outcomes: [outcome("a2", "success"), outcome("a3", "success")],
      signals: [],
      observations: [],
    },
  },
  {
    name: "animation in progress",
    result: {
      outcomes: [outcome("a2", "success")],
      signals: [],
      observations: [observation({ animating: true })],
    },
  },
  {
    name: "permission denial (CAPABILITY_DENIED)",
    result: {
      outcomes: [outcome("a2", "target-failure", "CAPABILITY_DENIED")],
      signals: [],
      observations: [],
    },
  },
  {
    name: "slow operation (deadline exceeded)",
    result: {
      outcomes: [outcome("a2", "deadline-exceeded", "DEADLINE_EXCEEDED")],
      signals: [],
      observations: [],
    },
  },
  {
    name: "element miss after DOM change (ACTION_FAILED)",
    result: {
      outcomes: [outcome("a1", "success"), outcome("a2", "target-failure", "ACTION_FAILED")],
      signals: [],
      observations: [],
    },
  },
];

describe("phase-D oracle FP/FN fixtures (hardening)", () => {
  for (const d of trueDefects) {
    it(`confirms TRUE defect: ${d.name}`, async () => {
      const f = d.engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      const { finding } = await d.engine.reproduce(f, PATH, d.driver, {
        attempts: 2,
        minSuccesses: 2,
      });
      expect(finding.status).toBe("CONFIRMED");
      expect(finding.confidence).toBe(1);
    });
  }

  for (const d of nonDefects) {
    it(`does NOT reproduce non-defect: ${d.name}`, async () => {
      const evaluation = OracleEngine.defaults().evaluate(d.result);
      expect(evaluation.reproduced).toBe(false);
      const engine = new FindingEngine();
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      const { finding } = await engine.reproduce(f, PATH, new StaticDriver(d.result), {
        attempts: 2,
        minSuccesses: 2,
      });
      expect(finding.status).toBe("REJECTED");
    });
  }

  it("distinguishes crash-class target failures from automation misses", () => {
    const engine = OracleEngine.defaults();
    const crash = engine.evaluate({
      outcomes: [outcome("a", "target-failure", "TARGET_FAILURE")],
      signals: [],
      observations: [],
    });
    expect(crash.reproduced).toBe(true);
    const miss = engine.evaluate({
      outcomes: [outcome("a", "target-failure", "ACTION_FAILED")],
      signals: [],
      observations: [],
    });
    expect(miss.reproduced).toBe(false);
    const uncoded = engine.evaluate({
      outcomes: [outcome("a", "target-failure")],
      signals: [],
      observations: [],
    });
    expect(uncoded.reproduced).toBe(false);
  });

  it("rejects zero/negative/degenerate reproduction policies", async () => {
    const engine = new FindingEngine();
    for (const policy of [
      { attempts: 0, minSuccesses: 0 },
      { attempts: 0, minSuccesses: 1 },
      { attempts: 3, minSuccesses: 0 },
      { attempts: 3, minSuccesses: 4 },
      { attempts: -2, minSuccesses: -2 },
    ]) {
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      await expect(
        engine.reproduce(f, PATH, new StaticDriver(EMPTY), policy),
      ).rejects.toThrow(/policy/i);
      expect(f.status).toBe("CANDIDATE");
    }
  });

  it("NaN confidence is unreachable across settled policies", async () => {
    const engine = new FindingEngine();
    const flaky = new FlakyDriver(new FakeStateMachineDriver(), true);
    for (let attempts = 1; attempts <= 4; attempts++) {
      for (let minSuccesses = 1; minSuccesses <= attempts; minSuccesses++) {
        const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
        const { finding } = await engine.reproduce(f, PATH, flaky, {
          attempts,
          minSuccesses,
        });
        expect(Number.isNaN(finding.confidence)).toBe(false);
        expect(Number.isFinite(finding.confidence)).toBe(true);
        expect(finding.confidence).toBeGreaterThanOrEqual(0);
        expect(finding.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ingest records the primary signature and only relevant oracle ids", () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "PAGE_ERROR" });
    expect(f.signature).toBe("PAGE_ERROR");
    expect(f.oracleIds).toContain("page-error");
    expect(f.oracleIds).not.toContain("signal:IMPOSSIBLE_STATE");
    expect(f.oracleIds).not.toContain("signal:ADAPTER_CRASH");
  });

  it("minimization never reduces onto a different defect and records stats", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    expect(f.signature).toBe("DEFECT_SUBMIT_INVALID");

    const table = new Map<string, ReplayResult>([
      ["n0,n1,n2,d0,d1", sig(["DEFECT_SUBMIT_INVALID"])],
      ["n2,d0,d1", sig(["DEFECT_SUBMIT_INVALID"])],
      // Removing the defect tail leaves a DIFFERENT defect (page crash).
      // The old oracle accepted this reduction because *some* oracle fired.
      ["d0,d1", sig(["PAGE_ERROR"])],
    ]);
    const driver = new KeyedDriver(table);
    const noisy = [act("n0"), act("n1"), act("n2"), act("d0"), act("d1")];

    const minimized = await engine.minimize(f, noisy, driver, { maxReplays: 20 });

    expect(minimized.map((a) => a.id)).toEqual(["n2", "d0", "d1"]);
    expect(f.minimization).toBeDefined();
    expect(f.minimization?.probes).toBeGreaterThan(0);
    expect(f.minimization?.removals).toBe(2);
    expect(f.minimization?.verifiedReproduction).toBe(true);
  });

  it("evidence bundles are frozen snapshots: mutating the finding afterwards has no effect", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" }, { title: "snapshot me" });
    await engine.reproduce(f, PATH, new FakeStateMachineDriver(), {
      attempts: 1,
      minSuccesses: 1,
    });
    const bundle = engine.buildBundle(f, PATH, PATH, { revision: "rev-1" });
    const snapshotted = {
      status: bundle.finding.status,
      title: bundle.finding.title,
      confidence: bundle.finding.confidence,
    };

    f.status = "REJECTED";
    f.title = "mutated after export";
    f.confidence = 42;

    expect(bundle.finding.status).toBe(snapshotted.status);
    expect(bundle.finding.title).toBe("snapshot me");
    expect(bundle.finding.confidence).toBe(snapshotted.confidence);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.finding)).toBe(true);
    expect(Object.isFrozen(bundle.originalSteps)).toBe(true);
    expect(Object.isFrozen(bundle.minimizedSteps)).toBe(true);
  });

  it("driver throws are contained per attempt and never strand the finding", async () => {
    const engine = new FindingEngine();
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const { finding, stats } = await engine.reproduce(
      f,
      PATH,
      new ThrowingDriver("driver exploded"),
      { attempts: 3, minSuccesses: 3 },
    );
    expect(stats.attempts).toBe(3);
    expect(stats.successes).toBe(0);
    expect(stats.errors).toBe(3);
    expect(stats.lastError ?? "").toContain("driver exploded");
    expect(finding.status).toBe("REJECTED");
    expect(finding.status).not.toBe("REPRODUCING");
  });

  it("accepts a pluggable signature extractor", async () => {
    // Every step fails with a TARGET_FAILURE-coded outcome and NO signals,
    // so the default (signal-kind) extractor can never verify a reduction.
    class AllTargetFailureDriver implements ReplayDriver {
      async replay(actions: Action[]): Promise<ReplayResult> {
        return {
          outcomes: actions.map((a) => outcome(a.id, "target-failure", "TARGET_FAILURE")),
          signals: [],
          observations: [],
        };
      }
    }
    const noisy = [act("n0"), act("n1"), act("n2"), act("d0"), act("d1")];

    const defaultEngine = new FindingEngine();
    const defaultFinding = defaultEngine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const defaultMinimized = await defaultEngine.minimize(
      defaultFinding,
      noisy,
      new AllTargetFailureDriver(),
      { maxReplays: 20 },
    );
    expect(defaultMinimized.map((a) => a.id)).toEqual(["n0", "n1", "n2", "d0", "d1"]);
    expect(defaultFinding.minimization?.verifiedReproduction).toBe(false);

    // A pluggable extractor defines its own signature vocabulary (here: the
    // sorted distinct outcome error codes); the original signature is then
    // established from the full-sequence baseline under that extractor.
    const opts: FindingEngineOptions = {
      signatureExtractor: (r) => {
        const codes = [
          ...new Set(
            r.outcomes
              .map((o) => o.error?.code)
              .filter((c): c is NonNullable<typeof c> => Boolean(c)),
          ),
        ].sort();
        return codes.length > 0 ? codes.join("|") : null;
      },
    };
    const engine = new FindingEngine(undefined, undefined, opts);
    const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
    const minimized = await engine.minimize(f, noisy, new AllTargetFailureDriver(), {
      maxReplays: 20,
    });
    expect(minimized.map((a) => a.id)).toEqual(["d1"]);
    expect(f.minimization?.probes).toBeGreaterThan(0);
    expect(f.minimization?.removals).toBe(4);
    expect(f.minimization?.verifiedReproduction).toBe(true);
  });
});
