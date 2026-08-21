import { describe, it, expect } from "vitest";
import type { ReplayResult } from "@inspector/finding";
import { OracleSuite } from "./suite.js";
import { InvariantOracle, metamorphicRelation } from "./invariant.js";
import { classifySuspicion, suspicionDescriptor } from "./suspicion.js";

function result(withSignal: boolean): ReplayResult {
  return {
    outcomes: [],
    signals: withSignal ? [{ kind: "PAGE_ERROR", detail: "boom" }] : [],
    observations: [],
  };
}

describe("oracle suite", () => {
  it("aggregates matches with max confidence", () => {
    const suite = new OracleSuite()
      .register(
        new InvariantOracle("hard-crash", (r) => r.signals.length > 0, {
          confidence: 1,
        }),
      )
      .register(
        new InvariantOracle("soft-hint", () => true, {
          strength: "soft",
          confidence: 0.4,
        }),
      );
    const v = suite.evaluate(result(true));
    expect(v.reproduced).toBe(true);
    expect(v.confidence).toBe(1);
    expect(v.matched.map((m) => m.id).sort()).toEqual(["hard-crash", "soft-hint"]);
  });

  it("reports no match when nothing fires", () => {
    const suite = new OracleSuite().register(
      new InvariantOracle("never", () => false),
    );
    const v = suite.evaluate(result(false));
    expect(v.reproduced).toBe(false);
    expect(v.confidence).toBe(0);
    expect(v.matched).toHaveLength(0);
  });

  it("evaluates metamorphic relations against baseline/variant pairs", () => {
    const sameCount = (_b: ReplayResult, v: ReplayResult) =>
      v.signals.length === 0;
    const suite = new OracleSuite().addRelation(
      metamorphicRelation("reload-stable", sameCount),
    );
    const violated = suite.evaluatePair(result(false), result(true));
    expect(violated.reproduced).toBe(true);
    expect(violated.matched[0]?.kind).toBe("metamorphic");

    const ok = suite.evaluatePair(result(true), result(false));
    expect(ok.reproduced).toBe(false);
  });
});

describe("weak suspicion handling (O1)", () => {
  it("holds uncorroborated suspicion at NEEDS_HUMAN_ORACLE regardless of confidence", () => {
    const d = classifySuspicion(
      { source: "llm", confidence: 0.99, summary: "looks broken" },
      false,
    );
    expect(d).toBe("NEEDS_HUMAN_ORACLE");
  });

  it("promotes corroborated suspicion to a full candidate", () => {
    const d = classifySuspicion(
      { source: "vision", confidence: 0.3, summary: "odd pixel" },
      true,
    );
    expect(d).toBe("CANDIDATE");
  });

  it("caps suspicion-derived oracle confidence below hard trust", () => {
    const d = suspicionDescriptor("s1", {
      source: "llm",
      confidence: 0.95,
      summary: "suspicious",
    });
    expect(d.strength).toBe("soft");
    expect(d.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe("verdict strength contract (hardening)", () => {
  const softOnlySuite = () =>
    new OracleSuite().register(
      new InvariantOracle("soft-hint", () => true, {
        strength: "soft",
        confidence: 0.4,
      }),
    );

  it("soft-only matches never claim reproduction", () => {
    const v = softOnlySuite().evaluate(result(true));
    expect(v.reproduced).toBe(false);
    expect(v.weakSuspicion).toBe(true);
    expect(v.confidence).toBe(0.4);
    expect(v.matched.map((m) => m.id)).toEqual(["soft-hint"]);
  });

  it("soft-only pair violations never claim reproduction", () => {
    const suite = softOnlySuite().addRelation(
      metamorphicRelation("soft-relation", () => false, {
        strength: "soft",
        confidence: 0.3,
      }),
    );
    const v = suite.evaluatePair(result(false), result(false));
    expect(v.reproduced).toBe(false);
    expect(v.weakSuspicion).toBe(true);
    expect(v.matched.map((m) => m.id).sort()).toEqual(["soft-hint", "soft-relation"]);
  });

  it("hard matches still reproduce and are not flagged weak", () => {
    const suite = softOnlySuite().register(
      new InvariantOracle("hard-crash", () => true, { confidence: 1 }),
    );
    const v = suite.evaluate(result(true));
    expect(v.reproduced).toBe(true);
    expect(v.weakSuspicion).toBe(false);
    expect(v.confidence).toBe(1);
  });

  it("no-match verdicts are neither reproduced nor weak suspicion", () => {
    const v = new OracleSuite()
      .register(new InvariantOracle("never", () => false))
      .evaluate(result(false));
    expect(v.reproduced).toBe(false);
    expect(v.weakSuspicion).toBe(false);
  });

  it("evaluateStrict ignores soft oracles entirely", () => {
    const weak = softOnlySuite().evaluateStrict(result(true));
    expect(weak.reproduced).toBe(false);
    expect(weak.weakSuspicion).toBe(false);
    expect(weak.matched).toHaveLength(0);

    const strict = softOnlySuite()
      .register(new InvariantOracle("hard-crash", () => true))
      .evaluateStrict(result(true));
    expect(strict.reproduced).toBe(true);
    expect(strict.matched.map((m) => m.id)).toEqual(["hard-crash"]);
  });

  it("evaluatePairStrict ignores soft relations", () => {
    const suite = new OracleSuite()
      .register(new InvariantOracle("never-hard", () => false))
      .addRelation(metamorphicRelation("soft-relation", () => false, { strength: "soft" }));
    expect(suite.evaluatePair(result(false), result(false)).weakSuspicion).toBe(true);
    const strict = suite.evaluatePairStrict(result(false), result(false));
    expect(strict.reproduced).toBe(false);
    expect(strict.matched).toHaveLength(0);
  });
});
