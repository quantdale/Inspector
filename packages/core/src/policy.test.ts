import { describe, it, expect } from "vitest";
import { PolicyEngine, DEFAULT_POLICY, type Policy } from "./policy.js";
import type { Action } from "@inspector/protocol";

function action(over: Partial<Action>): Action {
  return {
    id: "a1",
    runId: "run",
    environmentId: "env",
    kind: "click",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    ...over,
  };
}

describe("policy and budget engine", () => {
  it("allows a granted capability", () => {
    const engine = new PolicyEngine();
    expect(engine.evaluate(action({ risk: "interact" })).allowed).toBe(true);
    expect(engine.evaluate(action({ risk: "observe" })).allowed).toBe(true);
  });

  it("rejects a forbidden capability before it can reach an adapter", () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(action({ risk: "publish" }));
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("CAPABILITY_DENIED");
  });

  it("rejects modify-source when not granted", () => {
    const engine = new PolicyEngine();
    expect(engine.evaluate(action({ risk: "modify-source" })).allowed).toBe(false);
    const granting: Policy = {
      ...DEFAULT_POLICY,
      capabilities: { ...DEFAULT_POLICY.capabilities, modify_source: true },
    };
    const granted = new PolicyEngine(granting);
    expect(granted.evaluate(action({ risk: "modify-source" })).allowed).toBe(true);
  });

  it("exhausts the action budget deterministically", () => {
    const tiny: Policy = { ...DEFAULT_POLICY, budgets: { ...DEFAULT_POLICY.budgets, max_actions: 2 } };
    const engine = new PolicyEngine(tiny);
    expect(engine.evaluate(action({ id: "a1" })).allowed).toBe(true);
    engine.recordAction();
    expect(engine.evaluate(action({ id: "a2" })).allowed).toBe(true);
    engine.recordAction();
    const third = engine.evaluate(action({ id: "a3" }));
    expect(third.allowed).toBe(false);
    expect(third.code).toBe("BUDGET_EXHAUSTED");
  });

  it("rejects actions without a positive deadline", () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(action({ deadlineMs: 0 }));
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("DEADLINE_MISSING");
  });
});
