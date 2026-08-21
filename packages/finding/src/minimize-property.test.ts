import { describe, it, expect } from "vitest";
import {
  FindingEngine,
  FakeStateMachineDriver,
  OracleEngine,
  type Action,
} from "./index.js";

// ---------------------------------------------------------------------------
// Property suite for FindingEngine.minimize() over seeded random action
// arrays with a planted minimal defect suffix. Invariants checked for EVERY
// generated case:
//   1. minimized is an order-preserving subsequence of the original;
//   2. minimized never longer than the original;
//   3. when stats.verifiedReproduction === true, a fresh replay of the
//      minimized sequence still reproduces the ORIGINAL defect signature;
//   4. stats are internally consistent (probes within budget, removals equal
//      to the actual shrinkage);
//   5. the finding lands in MINIMIZED status after a verified run.
// ---------------------------------------------------------------------------

const SEED = 0x4b50524f;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    bool: (p = 0.5) => next() < p,
  };
}

let seq = 0;
function act(kind: string, input?: Record<string, unknown>): Action {
  seq += 1;
  return {
    id: `a${seq}`,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input,
  };
}

/** Noise actions that can never fire the oracle on their own. */
const NOISE_KINDS = ["goHome", "toggleFlag", "createArtifact", "reset"] as const;

function noiseAction(rng: Rng): Action {
  const kind = rng.pick(NOISE_KINDS);
  if (kind === "toggleFlag") return act("toggleFlag");
  if (kind === "createArtifact") return act("createArtifact");
  return act(kind);
}

/**
 * [noise prefix] + [openForm, fillField BAD, submit] + [noise suffix].
 * The three planted actions are the MINIMAL defect sequence for
 * FakeStateMachineDriver; prefix/suffix cannot produce DEFECT_SUBMIT_INVALID.
 */
function genCase(rng: Rng): { actions: Action[]; defectStart: number } {
  const prefixLen = rng.int(9);
  const suffixLen = rng.int(9);
  const prefix = Array.from({ length: prefixLen }, () => noiseAction(rng));
  const defect = [
    act("openForm"),
    act("fillField", { name: "default", value: "BAD" }),
    act("submit"),
  ];
  const suffix = Array.from({ length: suffixLen }, () => noiseAction(rng));
  return { actions: [...prefix, ...defect, ...suffix], defectStart: prefixLen };
}

/** Order-preserving subsequence check by action id. */
function isSubsequence(minimized: Action[], original: Action[]): boolean {
  let i = 0;
  for (const a of original) {
    if (i < minimized.length && minimized[i]!.id === a.id) i += 1;
  }
  return i === minimized.length;
}

describe("minimize() properties over random defective sequences", () => {
  it("holds all invariants across 120 generated cases (default budget)", async () => {
    const rng = makeRng(SEED ^ 0xc1);
    let reduced = 0;
    let verified = 0;
    for (let i = 0; i < 120; i++) {
      const { actions } = genCase(rng);
      const engine = new FindingEngine();
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      // Realistic flow: reproduction confirmed the defect before minimization,
      // which puts the finding in a state that may legally become MINIMIZED.
      engine.transition(f, "REPRODUCING");

      const minimized = await engine.minimize(f, actions, new FakeStateMachineDriver());
      const stats = f.minimization!;

      // 1+2: subsequence and shrinkage.
      expect(isSubsequence(minimized, actions), `case ${i}`).toBe(true);
      expect(minimized.length).toBeLessThanOrEqual(actions.length);

      // 4: stats consistency.
      expect(stats.probes).toBeGreaterThanOrEqual(1);
      expect(stats.probes).toBeLessThanOrEqual(20); // default budget
      expect(stats.removals).toBe(actions.length - minimized.length);
      expect(typeof stats.verifiedReproduction).toBe("boolean");

      if (stats.verifiedReproduction) {
        verified++;
        // 3: minimized still reproduces the ORIGINAL signature on a fresh env.
        const rerun = await new FakeStateMachineDriver().replay(minimized);
        const evaluation = OracleEngine.defaults().evaluate(rerun);
        expect(evaluation.reproduced, `case ${i} must reproduce`).toBe(true);
        const kinds = [...new Set(rerun.signals.map((s) => s.kind))].sort();
        expect(kinds.join("|")).toBe(f.signature ?? "DEFECT_SUBMIT_INVALID");
        // 5: verified runs transition REPRODUCING/CONFIRMED → MINIMIZED.
        expect(f.status).toBe("MINIMIZED");
        if (minimized.length < actions.length) reduced++;
        // The absolute floor: the minimal planted defect must survive.
        expect(minimized.length).toBeGreaterThanOrEqual(3);
      } else {
        // Unverified runs leave the sequence untouched and never claim MINIMIZED.
        expect(minimized.map((a) => a.id)).toEqual(actions.map((a) => a.id));
        expect(stats.removals).toBe(0);
        expect(f.status).not.toBe("MINIMIZED");
      }
    }
    // Sanity: the corpus actually exercises both reduction and verification.
    expect(reduced).toBeGreaterThan(60);
    expect(verified).toBe(120);
  });

  it("respects an explicit replay budget across 80 generated cases", async () => {
    const rng = makeRng(SEED ^ 0xc2);
    for (let i = 0; i < 80; i++) {
      const { actions } = genCase(rng);
      const budget = 1 + rng.int(8);
      const engine = new FindingEngine();
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      f.signature = "DEFECT_SUBMIT_INVALID";

      const minimized = await engine.minimize(f, actions, new FakeStateMachineDriver(), {
        maxReplays: budget,
      });
      const stats = f.minimization!;

      expect(stats.probes).toBeLessThanOrEqual(budget);
      expect(isSubsequence(minimized, actions)).toBe(true);
      expect(stats.removals).toBe(actions.length - minimized.length);
      if (stats.verifiedReproduction) {
        const rerun = await new FakeStateMachineDriver().replay(minimized);
        expect(OracleEngine.defaults().evaluate(rerun).reproduced).toBe(true);
      } else {
        expect(minimized.map((a) => a.id)).toEqual(actions.map((a) => a.id));
      }
    }
  });

  it("never reduces onto a different defect when noise contains decoy signals", async () => {
    const rng = makeRng(SEED ^ 0xc3);
    for (let i = 0; i < 40; i++) {
      // Sequence where the ONLY oracle fire is the planted defect, but noise
      // includes submit attempts with non-BAD values (no signal).
      const prefix = Array.from({ length: rng.int(5) }, () => noiseAction(rng));
      const decoySubmits = Array.from({ length: rng.int(3) }, () =>
        act("submit"), // fires nothing outside form state
      );
      const defect = [
        act("openForm"),
        act("fillField", { name: "default", value: "BAD" }),
        act("submit"),
      ];
      const actions = [...prefix, ...decoySubmits, ...defect];

      const engine = new FindingEngine();
      const f = engine.ingest({ kind: "DEFECT_SUBMIT_INVALID" });
      f.signature = "DEFECT_SUBMIT_INVALID";
      const minimized = await engine.minimize(f, actions, new FakeStateMachineDriver());

      expect(f.minimization!.verifiedReproduction).toBe(true);
      const rerun = await new FakeStateMachineDriver().replay(minimized);
      const kinds = [...new Set(rerun.signals.map((s) => s.kind))].sort().join("|");
      expect(kinds).toBe("DEFECT_SUBMIT_INVALID"); // exactly the original defect
      expect(isSubsequence(minimized, actions)).toBe(true);
    }
  });
});
