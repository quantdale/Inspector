import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReservationModelBudgetGate,
  StateCorruptionError,
  validateModelBudgetState,
} from "./index.js";
import type { ModelBudgetAdmission } from "@inspector/model-runtime";
import { writeFileSync } from "node:fs";

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "inspector-model-budget-"));
}

function admission(overrides: Partial<ModelBudgetAdmission> = {}): ModelBudgetAdmission {
  return {
    requestId: `mreq_${Math.random().toString(36).slice(2, 8)}`,
    attemptId: "",
    role: "planner",
    requestClass: "exploration-planner",
    ...overrides,
  };
}

describe("M13 F4/F5: reservation-based model budget gate", () => {
  it("admits within the request ceiling and denies the call that would exceed it", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxModelRequests: 2 },
      defaultReserveTokens: 10,
    });
    const a = admission({ attemptId: "r/a1" });
    const b = admission({ attemptId: "r2/a1" });
    const c = admission({ attemptId: "r3/a1" });
    expect(gate.admit(a)).toBe(true);
    expect(gate.admit(b)).toBe(true);
    // Both reservations are still active — the third must not slip through.
    expect(gate.admit(c)).toBe(false);
    // Every model request counts against the ceiling forever, so after two
    // completions no further admission is possible.
    gate.settle({ requestId: a.requestId, attemptId: a.attemptId, outcome: "completed", usage: { totalChargedTokens: 10 } });
    gate.settle({ requestId: b.requestId, attemptId: b.attemptId, outcome: "completed", usage: { totalChargedTokens: 10 } });
    expect(gate.admit(c)).toBe(false);
    expect(gate.totals().requests).toBe(2);
    expect(gate.totals().activeReservations).toBe(0);
  });

  it("token reservations block concurrent oversubscription across separate gate instances", () => {
    const dir = stateDir();
    const first = new ReservationModelBudgetGate(dir, { global: { maxTokens: 1000 }, defaultReserveTokens: 700 });
    const second = new ReservationModelBudgetGate(dir, { global: { maxTokens: 1000 }, defaultReserveTokens: 700 });
    expect(first.admit(admission({ attemptId: "w1/a1" }))).toBe(true);
    // The second worker cannot reserve past the shared ceiling while the
    // first hold is live — even from a different process-like instance.
    expect(second.admit(admission({ attemptId: "w2/a1" }))).toBe(false);
    // Settlement with truthful actuals frees only what was really used.
    first.settle({
      requestId: admission({ attemptId: "w1/a1" }).requestId,
      attemptId: "w1/a1",
      outcome: "completed",
      usage: { totalChargedTokens: 200 },
    });
    expect(second.admit(admission({ attemptId: "w2/a2" }))).toBe(true);
  });

  it("worker and item scopes are enforced independently and atomically", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      worker: { w1: { maxModelRequests: 1 }, w2: { maxModelRequests: 1 } },
      item: { itemA: { maxModelRequests: 1 } },
      defaultReserveTokens: 5,
    });
    expect(gate.admit(admission({ attemptId: "a1", workerId: "w1", itemId: "itemA" }))).toBe(true);
    expect(gate.admit(admission({ attemptId: "a2", workerId: "w2", itemId: "itemA" }))).toBe(false);
    expect(gate.admit(admission({ attemptId: "a3", workerId: "w1", itemId: "itemB" }))).toBe(false);
    expect(gate.admit(admission({ attemptId: "a4", workerId: "w2", itemId: "itemB" }))).toBe(true);
  });

  it("settles unknown outcomes conservatively at the reserved bound (never refunds)", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxTokens: 500 },
      defaultReserveTokens: 400,
    });
    const a = admission({ attemptId: "x/a1" });
    expect(gate.admit(a)).toBe(true);
    // Attempt dies at deadline with no usage report.
    gate.settle({ requestId: a.requestId, attemptId: a.attemptId, outcome: "failed" });
    const totals = gate.totals();
    expect(totals.tokens).toBe(400); // reserved bound became consumed truth
    expect(totals.requests).toBe(1);
    // Only 100 tokens of headroom remain — the possibly-charged call is not
    // silently treated as free.
    expect(gate.admit(admission({ attemptId: "y/a1" }))).toBe(false);
  });

  it("prefers spec estimates over defaults and records honest overage beyond the reservation", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxCostUsd: 1 },
      defaultReserveTokens: 100,
      defaultReserveCostUsd: 0.01,
    });
    const a = admission({ attemptId: "o/a1", estimateTokens: 50, estimateCostUsd: 0.02 });
    expect(gate.admit(a)).toBe(true);
    gate.settle({
      requestId: a.requestId,
      attemptId: a.attemptId,
      outcome: "completed",
      usage: { totalChargedTokens: 900, costUsd: 0.9 },
    });
    const totals = gate.totals();
    expect(totals.tokens).toBe(900);
    expect(totals.costUsd).toBeCloseTo(0.9, 6);
    // Truthful overage is visible; the remaining headroom is real.
    expect(gate.isCostBounded).toBe(true);
  });

  it("refuses cost-bounded admission when no estimate source exists", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxCostUsd: 5 },
      // No defaultReserveCostUsd configured.
    });
    expect(gate.admit(admission({ attemptId: "n/a1" }))).toBe(false);
    // With an explicit estimate the same gate admits.
    expect(gate.admit(admission({ attemptId: "n/a2", estimateCostUsd: 0.001 }))).toBe(true);
  });

  it("converts abandoned reservations into consumed truth after the TTL", () => {
    let nowMs = 1_000_000;
    const dir = stateDir();
    const writer = new ReservationModelBudgetGate(dir, {
      global: { maxModelRequests: 5 },
      now: () => nowMs,
      reservationTtlMs: 60_000,
    });
    const a = admission({ attemptId: "gone/a1" });
    expect(writer.admit(a)).toBe(true);
    // Simulate controller death: time passes far past the TTL before any
    // settle, then a NEW gate instance over the same state appears.
    nowMs += 10 * 60_000;
    const fresh = new ReservationModelBudgetGate(dir, {
      global: { maxModelRequests: 5 },
      now: () => nowMs,
      reservationTtlMs: 60_000,
    });
    // The abandoned hold is already reconciled as consumed on construction
    // path use; totals show consumed truth, not an active hold.
    expect(fresh.totals().activeReservations).toBe(0);
    expect(fresh.totals().requests).toBe(1);
  });

  it("settle is idempotent by attempt id", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), { global: { maxModelRequests: 3 }, defaultReserveTokens: 10 });
    const a = admission({ attemptId: "idem/a1" });
    expect(gate.admit(a)).toBe(true);
    gate.settle({ requestId: a.requestId, attemptId: a.attemptId, outcome: "completed", usage: { totalChargedTokens: 10 } });
    gate.settle({ requestId: a.requestId, attemptId: a.attemptId, outcome: "completed", usage: { totalChargedTokens: 10 } });
    expect(gate.totals().requests).toBe(1);
  });

  it("fails closed on semantically corrupt durable state", () => {
    const dir = stateDir();
    writeFileSync(
      join(dir, "model-budget.json"),
      JSON.stringify({ schemaVersion: 1, settled: { requests: -4, tokens: 0, costUsd: 0 }, byWorker: {}, byItem: {}, reservations: [] }),
    );
    expect(() => new ReservationModelBudgetGate(dir)).toThrow(StateCorruptionError);
    expect(() => validateModelBudgetState({ schemaVersion: 2 })).toThrow(TypeError);
  });

  it("restart inside the TTL keeps the hold conservatively; the ceiling still blocks overspend", () => {
    const dir = stateDir();
    const first = new ReservationModelBudgetGate(dir, { global: { maxModelRequests: 2 }, defaultReserveTokens: 10 });
    const a = admission({ attemptId: "live/a1" });
    expect(first.admit(a)).toBe(true);
    // Controller "dies" before settle; a fresh controller over the same
    // state cannot know whether the call was sent. The hold must survive.
    const freshGate = new ReservationModelBudgetGate(dir, { global: { maxModelRequests: 2 }, defaultReserveTokens: 10 });
    expect(freshGate.totals().activeReservations).toBe(1);
    // No silent overspend across restarts.
    expect(freshGate.admit(admission({ attemptId: "new/a1" }))).toBe(true);
    expect(freshGate.admit(admission({ attemptId: "new/a2" }))).toBe(false);
  });

  it("P: totals stay non-negative and never exceed ceilings under randomized admit/settle storms", () => {
    let seed = 987654321;
    const rand = (): number => {
      // Deterministic xorshift for stable CI runs.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return Math.abs(seed % 100000) / 100000;
    };
    let admitted = 0;
    for (let round = 0; round < 5; round++) {
      const gate = new ReservationModelBudgetGate(stateDir(), {
        global: { maxModelRequests: 12 },
        defaultReserveTokens: 50,
      });
      const open: string[] = [];
      for (let i = 0; i < 60; i++) {
        if (open.length > 0 && rand() < 0.4) {
          const attemptId = open.shift()!;
          gate.settle({ requestId: "r", attemptId, outcome: "completed", usage: rand() < 0.7 ? { totalChargedTokens: 40 } : undefined });
        } else {
          const attemptId = `s${round}/a${i}`;
          if (gate.admit(admission({ attemptId }))) {
            admitted += 1;
            open.push(attemptId);
          }
        }
        const t = gate.totals();
        expect(t.requests).toBeGreaterThanOrEqual(0);
        expect(t.tokens).toBeGreaterThanOrEqual(0);
        expect(t.costUsd).toBeGreaterThanOrEqual(0);
        expect(t.requests).toBeLessThanOrEqual(12);
      }
    }
    expect(admitted).toBeGreaterThan(0);
  });

  it("two gates racing one shared request ceiling cannot collectively oversubscribe it", async () => {
    const dir = stateDir();
    let admitted = 0;
    const gates = [1, 2, 3, 4].map(
      (w) =>
        new ReservationModelBudgetGate(dir, {
          global: { maxModelRequests: 8 },
          worker: { [`w${w}`]: { maxModelRequests: 8 } },
          defaultReserveTokens: 16,
        }),
    );
    await Promise.all(
      gates.map(async (gate, index) => {
        for (let i = 0; i < 25; i++) {
          if (gate.admit(admission({ attemptId: `w${index + 1}/a${i}`, workerId: `w${index + 1}` }))) admitted += 1;
        }
      }),
    );
    expect(admitted).toBeLessThanOrEqual(8);
    expect(admitted).toBeGreaterThan(0);
  });
});

describe("HARDENING_3 H3-D6: hostile numerics fail closed", () => {
  it("NaN/Infinity/negative cost estimates fall back to the conservative default instead of poisoning holds", () => {
    const dir = stateDir();
    const gate = new ReservationModelBudgetGate(dir, {
      global: { maxCostUsd: 3 },
      defaultReserveCostUsd: 0.5,
      defaultReserveTokens: 10,
    });
    for (const bad of [Number.NaN, Infinity, -Infinity, -1]) {
      expect(gate.admit(admission({ attemptId: `bad/${String(bad)}`, estimateCostUsd: bad }))).toBe(true);
      // The hold must carry the DEFAULT bound, never the hostile value.
      expect(gate.totals().costUsd).toBeLessThanOrEqual(3);
      gate.settle({ requestId: "x", attemptId: `bad/${String(bad)}`, outcome: "failed" });
    }
    // State stays loadable/valid after the whole storm.
    expect(() => validateModelBudgetState(JSON.parse(readFileSync(join(dir, "model-budget.json"), "utf8")))).not.toThrow();
  });

  it("hostile token estimates cannot oversubscribe or corrupt state", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxTokens: 100 },
      defaultReserveTokens: 10,
    });
    expect(gate.admit(admission({ attemptId: "t1", estimateTokens: Number.NaN }))).toBe(true); // default 10
    expect(gate.admit(admission({ attemptId: "t2", estimateTokens: -50 }))).toBe(true); // default 10
    expect(gate.admit(admission({ attemptId: "t3", estimateTokens: 5.9 }))).toBe(true); // ceil 6
    expect(gate.totals().tokens).toBe(26);
    expect(gate.admit(admission({ attemptId: "t4", estimateTokens: Number.MAX_SAFE_INTEGER + 1 }))).toBe(true); // default
    // 26 + 10 <= 100: admitted with default; a raw unsafe value would have blown past.
    expect(gate.totals().activeReservations).toBe(4);
  });

  it("provider-reported usage is sanitized: negative/NaN usage can never refund or fail the gate open", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxModelRequests: 100 },
      defaultReserveTokens: 10,
    });
    const a = admission({ attemptId: "u1" });
    expect(gate.admit(a)).toBe(true);
    gate.settle({
      requestId: a.requestId,
      attemptId: a.attemptId,
      outcome: "completed",
      usage: { inputTokens: -1000, outputTokens: Number.NaN, totalChargedTokens: -5, costUsd: -3 },
    });
    // Hostile fields are treated as absent => conservative conversion of the hold.
    expect(gate.totals().requests).toBe(1);
    expect(gate.totals().tokens).toBe(10);
    // The gate still enforces its ceiling afterwards (never stuck open).
    for (let i = 2; i <= 12; i++) {
      const ad = admission({ attemptId: `u${i}` });
      expect(gate.admit(ad)).toBe(true);
      gate.settle({ requestId: ad.requestId, attemptId: ad.attemptId, outcome: "completed", usage: { totalChargedTokens: 1 } });
    }
  });

  it("partial valid usage charges what is known and treats garbage fields as unknown", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), { defaultReserveTokens: 100 });
    const a = admission({ attemptId: "p1" });
    gate.admit(a);
    gate.settle({
      requestId: a.requestId,
      attemptId: a.attemptId,
      outcome: "completed",
      usage: { inputTokens: 30, outputTokens: Number.NaN, costUsd: 0.25 },
    });
    expect(gate.totals()).toMatchObject({ requests: 1, tokens: 30, costUsd: 0.25 });
  });

  it("persisted NaN reservation cost fails closed at load (validator finite check)", () => {
    const dir = stateDir();
    writeFileSync(
      join(dir, "model-budget.json"),
      JSON.stringify({
        schemaVersion: 1,
        settled: { requests: 0, tokens: 0, costUsd: 0 },
        byWorker: {},
        byItem: {},
        reservations: [
          { requestId: "r", attemptId: "r/a", role: "planner", requestClass: "x", requests: 1, tokens: 1, costUsd: Number.NaN, atMs: 1 },
        ],
      }),
      "utf8",
    );
    expect(() => new ReservationModelBudgetGate(dir, {})).toThrow(StateCorruptionError);
  });

  it("honest overage above the reservation remains durable truth (unchanged semantics)", () => {
    const gate = new ReservationModelBudgetGate(stateDir(), {
      global: { maxTokens: 15 },
      defaultReserveTokens: 10,
    });
    const a = admission({ attemptId: "o1" });
    expect(gate.admit(a)).toBe(true);
    gate.settle({
      requestId: a.requestId,
      attemptId: a.attemptId,
      outcome: "completed",
      usage: { totalChargedTokens: 14 },
    });
    expect(gate.totals().tokens).toBe(14); // truthful overage recorded
    expect(gate.admit(admission({ attemptId: "o2" }))).toBe(false); // projection sees it
  });

  it("restart reconciliation converts abandoned hostile holds at their SANITIZED bound", () => {
    const dir = stateDir();
    let t = 1_000_000;
    const first = new ReservationModelBudgetGate(dir, {
      defaultReserveTokens: 4096,
      reservationTtlMs: 1_000,
      now: () => t,
    });
    // Hostile estimates are sanitized at admission, so even an abandoned
    // crash-window hold can never carry NaN/Infinity into durable truth.
    expect(first.admit(admission({ attemptId: "crash/a1", estimateTokens: Number.NaN }))).toBe(true);
    expect(first.admit(admission({ attemptId: "crash/a2", estimateTokens: Number.POSITIVE_INFINITY }))).toBe(true);
    t += 5_000;
    // "Restart": a fresh instance over the same durable state reconciles
    // abandoned holds AT CONSTRUCTION (fail-loud load then conservative
    // conversion); an explicit re-run therefore finds nothing left.
    const second = new ReservationModelBudgetGate(dir, {
      defaultReserveTokens: 4096,
      reservationTtlMs: 1_000,
      now: () => t,
    });
    expect(second.reconcileAbandoned()).toBe(0);
    const totals = second.totals();
    expect(totals.activeReservations).toBe(0);
    expect(totals.tokens).toBe(2 * 4096); // sanitized defaults, never Infinity
    expect(Number.isFinite(totals.costUsd)).toBe(true);
  });
});

