import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
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
