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
