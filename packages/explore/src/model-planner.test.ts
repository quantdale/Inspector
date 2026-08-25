import { describe, expect, it } from "vitest";
import { ModelRuntime, ScriptedModelProvider, jsonOutcome } from "@inspector/model-runtime";
import {
  PLANNER_SUGGESTION_SCHEMA,
  SemanticPlanner,
  shouldInvokePlanner,
} from "./model-planner.js";
import type { CandidateAction } from "./inventory.js";

function usable(): Array<CandidateAction & { score: number }> {
  return [
    { actionKey: "click#secret", kind: "click", risk: "interact", selector: "#secret", score: 1.2 },
    { actionKey: "click#a1", kind: "click", risk: "interact", selector: "#a1", score: 3.4 },
    { actionKey: "fill#q", kind: "fill", risk: "mutate-test-state", selector: "#q", value: "", score: 2.2 },
  ] as unknown as Array<CandidateAction & { score: number }>;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    stateFingerprint: "st_hub",
    screenSummary: "fake://hub",
    usableCandidates: usable(),
    recentActionKeys: ["click#a1", "click#a1"],
    budgetsRemaining: { actions: 20, resets: 1 },
    actionsSinceNewState: 9,
    ...overrides,
  };
}

describe("M13 F7: semantic planner activation policy", () => {
  it("fires on stall and ambiguity, respects cadence floor and absolute cap", () => {
    const base = {
      actionsSinceNewState: 0,
      topCandidateCount: 1,
      plannerCallsTotal: 0,
      actionsSincePlannerCall: 100,
    };
    expect(shouldInvokePlanner(base)).toBe(false);
    expect(shouldInvokePlanner({ ...base, actionsSinceNewState: 8 })).toBe(true);
    expect(shouldInvokePlanner({ ...base, topCandidateCount: 4 })).toBe(true);
    expect(
      shouldInvokePlanner({ ...base, actionsSinceNewState: 99, actionsSincePlannerCall: 5 }),
    ).toBe(false); // cadence floor
    expect(
      shouldInvokePlanner({ ...base, actionsSinceNewState: 99, plannerCallsTotal: 24 }),
    ).toBe(false); // absolute cap
  });
});

describe("M13 F7: semantic planner suggestion containment", () => {
  it("accepts a valid suggestion ONLY when it matches an offered inventory key", async () => {
    const provider = new ScriptedModelProvider({
      id: "fixture",
      respond: jsonOutcome({ actionKey: "click#secret", goal: "explore vault", confidence: 0.9 }),
    });
    const planner = new SemanticPlanner({ runtime: new ModelRuntime().register(provider) });
    const decision = await planner.suggest(request());
    expect(decision.accepted).toBe(true);
    expect(decision.actionKey).toBe("click#secret");
    expect(planner.calls).toEqual({ total: 1, accepted: 1, rejected: 0 });
  });

  it("rejects fabricated out-of-inventory actions without executing anything", async () => {
    const provider = new ScriptedModelProvider({
      id: "fixture",
      respond: jsonOutcome({
        actionKey: "shell#rm -rf /",
        confidence: 1.0,
      }),
    });
    const planner = new SemanticPlanner({ runtime: new ModelRuntime().register(provider) });
    const decision = await planner.suggest(request());
    expect(decision.accepted).toBe(false);
    expect(decision.classification).toBe("unknown-action");
    expect(planner.calls.rejected).toBe(1);
  });

  it("rejects low-confidence suggestions deterministically", async () => {
    const provider = new ScriptedModelProvider({
      id: "fixture",
      respond: jsonOutcome({ actionKey: "click#a1", confidence: 0.2 }),
    });
    const planner = new SemanticPlanner({ runtime: new ModelRuntime().register(provider) });
    const decision = await planner.suggest(request());
    expect(decision.accepted).toBe(false);
    expect(decision.classification).toBe("low-confidence");
  });

  it("survives malformed and schema-invalid responses as classified failures", async () => {
    const malformed = new ScriptedModelProvider({ id: "m", respond: { text: "{not json" } });
    const schemaInvalid = new ScriptedModelProvider({ id: "s", respond: jsonOutcome({ nonsense: true }) });
    for (const provider of [malformed, schemaInvalid]) {
      const planner = new SemanticPlanner({ runtime: new ModelRuntime().register(provider) });
      const decision = await planner.suggest(request());
      expect(decision.accepted).toBe(false);
      expect(["malformed-response", "schema-invalid"]).toContain(decision.classification);
    }
  });

  it("degrades safely when the provider fails, hangs past deadline, or budget denies", async () => {
    const hanging = new ScriptedModelProvider({ id: "hanging", priority: 1, respond: { hangMs: 30_000 } });
    const runtime = new ModelRuntime().register(hanging);
    let planner = new SemanticPlanner({ runtime, config: { timeoutMs: 40 } });
    let decision = await planner.suggest(request());
    expect(decision.accepted).toBe(false);
    expect(decision.classification).toBe("deadline");

    const deniedRuntime = new ModelRuntime().register(new ScriptedModelProvider({ id: "p", respond: { text: "{}" } }));
    planner = new SemanticPlanner({
      runtime: deniedRuntime,
      config: { timeoutMs: 40 },
      gate: { admit: () => false, settle: () => {} },
    });
    decision = await planner.suggest(request());
    expect(decision.accepted).toBe(false);
    expect(decision.classification).toBe("budget-denied");
  });

  it("records packet provenance metadata including offered candidate count", async () => {
    const sinkRecords: Array<Record<string, unknown>> = [];
    const provider = new ScriptedModelProvider({
      id: "fixture",
      respond: jsonOutcome({ actionKey: "click#secret", confidence: 0.8 }),
    });
    const planner = new SemanticPlanner({
      runtime: new ModelRuntime().register(provider),
      sink: {
        start: (r) => sinkRecords.push({ phase: "start", status: r.status }),
        finish: (r) => sinkRecords.push({ phase: "finish", metadata: r.metadataJson }),
      },
    });
    await planner.suggest(request());
    const finish = sinkRecords.find((r) => r.phase === "finish");
    expect(finish?.metadata).toMatchObject({ candidatesOffered: 3 });
  });

  it("exposes the strict response schema id for audit", () => {
    expect(PLANNER_SUGGESTION_SCHEMA).toBe("inspector-planner-suggestion/1");
  });
});

