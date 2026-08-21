import { describe, it, expect } from "vitest";
import { FindingEngine, type Finding, type FindingStatus } from "./index.js";

// ---------------------------------------------------------------------------
// Exhaustive state-machine matrix for FindingEngine.transition().
//
// The EXPECTED matrix below is an independent restatement of the contract
// documented in finding-engine.ts (VALID_TRANSITIONS). Pinning it here means
// any accidental widening/narrowing of the legal edge set fails this suite.
// Every one of the 12×12 = 144 (from,to) pairs is exercised.
// ---------------------------------------------------------------------------

const ALL_STATUSES: FindingStatus[] = [
  "OBSERVED",
  "CANDIDATE",
  "REPRODUCING",
  "MINIMIZED",
  "CONFIRMED",
  "PATCHING",
  "VERIFYING",
  "RESOLVED",
  "REGRESSED",
  "REJECTED",
  "FLAKY",
  "NEEDS_HUMAN_ORACLE",
];

const EXPECTED_LEGAL: Record<FindingStatus, FindingStatus[]> = {
  OBSERVED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["REPRODUCING", "REJECTED", "FLAKY", "CONFIRMED", "NEEDS_HUMAN_ORACLE"],
  REPRODUCING: ["MINIMIZED", "CONFIRMED", "FLAKY", "REJECTED", "CANDIDATE"],
  MINIMIZED: ["CONFIRMED", "FLAKY", "REJECTED"],
  CONFIRMED: ["MINIMIZED", "PATCHING", "VERIFYING", "RESOLVED", "REGRESSED"],
  PATCHING: ["VERIFYING", "CONFIRMED", "REGRESSED"],
  VERIFYING: ["RESOLVED", "REGRESSED", "CONFIRMED"],
  RESOLVED: ["REGRESSED"],
  REGRESSED: ["CONFIRMED", "PATCHING"],
  REJECTED: [],
  FLAKY: ["CANDIDATE", "CONFIRMED", "REJECTED"],
  NEEDS_HUMAN_ORACLE: ["CONFIRMED", "REJECTED"],
};

/** A finding literal placed at an arbitrary status (transition() mutates it). */
function findingAt(status: FindingStatus): Finding {
  const now = new Date().toISOString();
  return {
    id: `find_${status}`,
    runId: null,
    status,
    title: "matrix probe",
    confidence: 0,
    severity: "unknown",
    revision: null,
    oracleIds: [],
    reproduction: null,
    artifactRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("exhaustive finding transition matrix (144 pairs)", () => {
  it("legal edges succeed and every other pair throws /invalid finding transition/", () => {
    const engine = new FindingEngine();
    let legalCount = 0;
    let illegalCount = 0;

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const f = findingAt(from);
        const expectedLegal = EXPECTED_LEGAL[from].includes(to);
        if (expectedLegal) {
          expect(() => engine.transition(f, to), `${from} -> ${to}`).not.toThrow();
          expect(f.status).toBe(to);
          legalCount++;
        } else {
          expect(() => engine.transition(f, to), `${from} -> ${to}`).toThrow(
            /invalid finding transition/,
          );
          // Rejected transitions must not mutate the finding.
          expect(f.status).toBe(from);
          illegalCount++;
        }
      }
    }
    expect(legalCount).toBe(34);
    expect(illegalCount).toBe(110);
  });

  it("every status appears exactly once as a source and the matrix is total", () => {
    for (const from of ALL_STATUSES) {
      const targets = EXPECTED_LEGAL[from];
      for (const to of targets) {
        expect(ALL_STATUSES).toContain(to); // no dangling target statuses
      }
      // No self-transitions anywhere in the contract.
      expect(targets).not.toContain(from);
    }
  });

  it("keeps REPRODUCING → CANDIDATE open as the recovery path", () => {
    const engine = new FindingEngine();
    const f = findingAt("REPRODUCING");
    expect(() => engine.transition(f, "CANDIDATE")).not.toThrow();
    expect(f.status).toBe("CANDIDATE");
  });

  it("terminal REJECTED has no outgoing edges at all", () => {
    const engine = new FindingEngine();
    for (const to of ALL_STATUSES) {
      const f = findingAt("REJECTED");
      if (to === "REJECTED") continue; // self-transition is also illegal
      expect(() => engine.transition(f, to)).toThrow(/invalid finding transition/);
    }
  });
});

describe("transition metadata recording", () => {
  it("records from/to/at plus optional reason and actor verbatim", () => {
    const engine = new FindingEngine();
    const f = findingAt("CANDIDATE");
    engine.transition(f, "NEEDS_HUMAN_ORACLE");
    engine.transition(f, "CONFIRMED", {
      reason: "human oracle confirmed the defect",
      actor: "analyst-7",
    });

    expect(f.lastTransition).toEqual({
      from: "NEEDS_HUMAN_ORACLE",
      to: "CONFIRMED",
      at: f.updatedAt,
      reason: "human oracle confirmed the defect",
      actor: "analyst-7",
    });
    expect(Number.isNaN(Date.parse(f.lastTransition!.at))).toBe(false);
  });

  it("omits reason/actor keys when not supplied (backward compatible shape)", () => {
    const engine = new FindingEngine();
    const f = findingAt("MINIMIZED");
    engine.transition(f, "CONFIRMED");
    expect(f.lastTransition).toBeDefined();
    expect(Object.keys(f.lastTransition!).sort()).toEqual(["at", "from", "to"]);
  });

  it("updatedAt refreshes on every accepted transition", () => {
    const engine = new FindingEngine();
    const f = findingAt("OBSERVED");
    const t0 = f.updatedAt;
    engine.transition(f, "CANDIDATE");
    expect(Date.parse(f.updatedAt)).toBeGreaterThanOrEqual(Date.parse(t0));
  });
});

describe("random legal walks never throw or lose metadata", () => {
  it("30 seeded walks of up to 40 legal hops stay consistent", () => {
    // Deterministic PRNG local to this suite.
    let a = 0x4b50524f ^ 0xd1;
    const next = (): number => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let walk = 0; walk < 30; walk++) {
      const engine = new FindingEngine();
      const f = findingAt("CANDIDATE");
      let steps = 0;
      while (steps < 40) {
        const options = EXPECTED_LEGAL[f.status];
        if (options.length === 0) break; // reached terminal REJECTED
        const to = options[Math.floor(next() * options.length)]!;
        const withMeta = next() < 0.5;
        const before = f.status;
        expect(() =>
          engine.transition(
            f,
            to,
            withMeta ? { reason: `walk-${steps}`, actor: "fuzzer" } : {},
          ),
        ).not.toThrow();
        expect(f.status).toBe(to);
        expect(f.lastTransition!.from).toBe(before);
        expect(f.lastTransition!.to).toBe(to);
        if (withMeta) {
          expect(f.lastTransition!.reason).toBe(`walk-${steps}`);
          expect(f.lastTransition!.actor).toBe("fuzzer");
        }
        steps++;
      }
      expect(steps).toBeGreaterThan(0);
    }
  });
});
