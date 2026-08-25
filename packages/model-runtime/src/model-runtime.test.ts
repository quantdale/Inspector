import { describe, expect, it } from "vitest";
import {
  ModelRuntime,
  ScriptedModelProvider,
  jsonOutcome,
  malformedJsonOutcome,
  type ModelBudgetGate,
  type ModelCallRecord,
  type ModelCallSink,
} from "./index.js";

function plannerSpec(overrides: Partial<Parameters<ModelRuntime["invoke"]>[0]> = {}) {
  return {
    role: "planner" as const,
    requestClass: "exploration-planner",
    prompt: "bounded planner packet",
    ...overrides,
  };
}

class MemorySink implements ModelCallSink {
  readonly records: ModelCallRecord[] = [];
  start(record: ModelCallRecord): void {
    this.records.push(record);
  }
  finish(record: ModelCallRecord): void {
    this.records.push(record);
  }
}

describe("M13 F1/F2: model runtime", () => {
  it("routes by role and prefers higher priority with deterministic tie-breaking", async () => {
    const low = new ScriptedModelProvider({ id: "low", priority: 1, roles: ["planner"], respond: { text: "low" } });
    const highA = new ScriptedModelProvider({ id: "a", priority: 5, roles: ["planner"], respond: { text: "high-a" } });
    const highB = new ScriptedModelProvider({ id: "b", priority: 5, roles: ["planner"], respond: { text: "high-b" } });
    const runtime = new ModelRuntime().register(low).register(highB).register(highA);
    expect(runtime.candidates("planner").map((p) => p.meta.id)).toEqual(["a", "b", "low"]);
    const result = await runtime.invoke(plannerSpec());
    expect(result.ok).toBe(true);
    expect(result.text).toBe("high-a");
  });

  it("only routes providers that declare the requested role", async () => {
    const summarizerOnly = new ScriptedModelProvider({ id: "s", roles: ["summarizer"], respond: { text: "x" } });
    const runtime = new ModelRuntime().register(summarizerOnly);
    const result = await runtime.invoke(plannerSpec());
    expect(result.ok).toBe(false);
    expect(result.failure?.classification).toBe("no-provider");
  });

  it("distinguishes no-provider from registered-but-unhealthy", async () => {
    const provider = new ScriptedModelProvider({ id: "p", respond: { text: "x" } });
    provider.setHealthy(false);
    const runtime = new ModelRuntime().register(provider);
    const result = await runtime.invoke(plannerSpec());
    expect(result.failure?.classification).toBe("provider-unhealthy");

    const emptyRuntime = new ModelRuntime();
    const noneResult = await emptyRuntime.invoke(plannerSpec());
    expect(noneResult.failure?.classification).toBe("no-provider");
  });

  it("excludes operator-marked-unhealthy providers and restores them explicitly", async () => {
    const primary = new ScriptedModelProvider({ id: "primary", priority: 10, respond: { text: "primary" } });
    const fallback = new ScriptedModelProvider({ id: "fallback", priority: 1, respond: { text: "fallback" } });
    const runtime = new ModelRuntime().register(primary).register(fallback);
    runtime.markUnhealthy("primary", "operator paused");
    let result = await runtime.invoke(plannerSpec());
    expect(result.text).toBe("fallback");
    runtime.markHealthy("primary");
    result = await runtime.invoke(plannerSpec());
    expect(result.text).toBe("primary");
  });

  it("falls back down the priority list on provider errors and reports fallback position", async () => {
    const bad = new ScriptedModelProvider({
      id: "bad",
      priority: 9,
      respond: { failure: "provider-error", detail: "upstream exploded" },
    });
    const good = new ScriptedModelProvider({ id: "good", priority: 1, respond: { text: "recovered" } });
    const runtime = new ModelRuntime().register(bad).register(good);
    const result = await runtime.invoke(plannerSpec());
    expect(result.ok).toBe(true);
    expect(result.text).toBe("recovered");
    expect(result.attempt?.providerId).toBe("good");
    expect(result.attempt?.attemptNumber).toBe(2);
    expect(result.attempt?.fallbacksUsed).toEqual(["bad"]);
  });

  it("does NOT fall back on malformed or schema-invalid responses (no double-spend)", async () => {
    for (const outcome of [malformedJsonOutcome(), jsonOutcome({ unexpected: true })]) {
      const sloppy = new ScriptedModelProvider({
        id: "sloppy",
        priority: 9,
        roles: ["planner"],
        respond: outcome,
      });
      const strict = new ScriptedModelProvider({
        id: "strict",
        priority: 1,
        roles: ["planner"],
        respond: jsonOutcome({ actionKey: "click#a" }),
      });
      const runtime = new ModelRuntime().register(sloppy).register(strict);
      const result = await runtime.invoke(
        plannerSpec({
          format: {
            kind: "json",
            schemaId: "inspector-planner-suggestion/1",
            validate: (v) =>
              typeof v === "object" && v !== null && "actionKey" in v
                ? { ok: true }
                : { ok: false, detail: "actionKey missing" },
          },
        }),
      );
      expect(result.ok).toBe(false);
      expect(["malformed-response", "schema-invalid"]).toContain(result.failure?.classification);
      // The lower-priority strict provider was never invoked.
      expect(strict.calls.length).toBe(0);
    }
  });

  it("enforces deadlines through its own controller even for signal-ignoring providers", async () => {
    const slow = new ScriptedModelProvider({ id: "slow", respond: { hangMs: 5_000 } });
    const runtime = new ModelRuntime().register(slow);
    const result = await runtime.invoke(plannerSpec({ deadlineMs: 30 }));
    expect(result.ok).toBe(false);
    expect(result.failure?.classification).toBe("deadline");
  });

  it("classifies cooperative cancellation before invoking when the signal is pre-aborted", async () => {
    const provider = new ScriptedModelProvider({ id: "p", respond: { text: "never" } });
    const runtime = new ModelRuntime().register(provider);
    const controller = new AbortController();
    controller.abort();
    const result = await runtime.invoke(plannerSpec(), { signal: controller.signal });
    expect(result.failure?.classification).toBe("cancelled");
    expect(provider.calls.length).toBe(0);
  });

  it("reports usage truthfully and leaves unknown usage unknown", async () => {
    const known = new ScriptedModelProvider({
      id: "known",
      roles: ["planner"],
      respond: { text: "{}", usage: { inputTokens: 120, outputTokens: 40, totalChargedTokens: 160, costUsd: 0.002 } },
    });
    const unknown = new ScriptedModelProvider({ id: "unknown", roles: ["oracle"], respond: { text: "{}" } });
    const runtime = new ModelRuntime().register(known).register(unknown);
    const a = await runtime.invoke(plannerSpec());
    expect(a.usage).toEqual({ inputTokens: 120, outputTokens: 40, totalChargedTokens: 160, costUsd: 0.002 });
    const b = await runtime.invoke(plannerSpec({ role: "oracle" }));
    expect(b.usage).toEqual({});
    expect(Object.keys(b.usage).length).toBe(0);
  });

  it("mints unique logical request ids per call", async () => {
    const provider = new ScriptedModelProvider({ id: "p", respond: { text: "ok" } });
    const runtime = new ModelRuntime().register(provider);
    const a = await runtime.invoke(plannerSpec());
    const b = await runtime.invoke(plannerSpec());
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("admits budget BEFORE invoking, settles actuals after completion, and denies without invocation", async () => {
    const events: string[] = [];
    const admissions: Array<Record<string, unknown>> = [];
    const settlements: Array<Record<string, unknown>> = [];
    const gate: ModelBudgetGate = {
      admit(admission) {
        admissions.push({ ...admission });
        events.push("admit");
        return admissions.length <= 1;
      },
      settle(settlement) {
        settlements.push({ ...settlement });
        events.push("settle");
      },
    };
    const provider = new ScriptedModelProvider({
      id: "p",
      respond: { text: "{}", usage: { totalChargedTokens: 90 } },
    });
    const runtime = new ModelRuntime().register(provider);
    const first = await runtime.invoke(
      plannerSpec({ estimate: { tokens: 500 }, attribution: { runId: "run_1" } }),
      { gate },
    );
    expect(events).toEqual(["admit", "settle"]);
    expect(first.ok).toBe(true);
    expect(admissions[0]).toMatchObject({ requestId: first.requestId, estimateTokens: 500 });
    expect(settlements[0]).toMatchObject({ requestId: first.requestId, outcome: "completed" });

    const second = await runtime.invoke(plannerSpec(), { gate });
    expect(second.ok).toBe(false);
    expect(second.failure?.classification).toBe("budget-denied");
    // Denial means ZERO provider invocation.
    expect(provider.calls.length).toBe(1);
  });

  it("settles conservatively (without usage) when an attempt dies at deadline/cancel", async () => {
    const settlements: Array<Record<string, unknown>> = [];
    const gate: ModelBudgetGate = {
      admit: () => true,
      settle: (s) => settlements.push({ ...s }),
    };
    const slow = new ScriptedModelProvider({ id: "slow", respond: { hangMs: 5_000 } });
    const runtime = new ModelRuntime().register(slow);
    await runtime.invoke(plannerSpec({ deadlineMs: 25 }), { gate });
    expect(settlements.length).toBe(1);
    expect(settlements[0]).toMatchObject({ outcome: "failed" });
    expect(settlements[0]?.usage).toBeUndefined();
  });

  it("persists started rows BEFORE external inference and terminal rows after", async () => {
    const order: string[] = [];
    const sink: ModelCallSink = {
      start(record) {
        order.push(`start:${record.status}`);
      },
      finish(record) {
        order.push(`finish:${record.status}`);
      },
    };
    const provider = new ScriptedModelProvider({ id: "p", respond: { text: "{\"ok\":true}" } });
    const runtime = new ModelRuntime().register(provider);
    provider.invoke = new Proxy(provider.invoke.bind(provider), {
      apply(target, thisArg, args) {
        order.push("provider-invoke");
        return Reflect.apply(target, thisArg, args);
      },
    });
    const result = await runtime.invoke(
      plannerSpec({ format: { kind: "json" }, attribution: { findingId: "find_x" } }),
      { sink },
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(["start:started", "provider-invoke", "finish:completed"]);
  });

  it("records hashes, attribution, usage columns, and fallback positions in sink rows", async () => {
    const sink = new MemorySink();
    const flaky = new ScriptedModelProvider({
      id: "flaky",
      priority: 8,
      modelId: "fixture-large",
      respond: { failure: "transport-error", detail: "socket reset" },
    });
    const good = new ScriptedModelProvider({
      id: "good",
      priority: 2,
      modelId: "fixture-small",
      respond: { text: "{\"fine\":1}", usage: { outputTokens: 7 } },
    });
    const runtime = new ModelRuntime().register(flaky).register(good);
    const result = await runtime.invoke(
      plannerSpec({
        metadata: { seed: 42 },
        attribution: { campaignId: "cmp_1", itemId: "item_1", workerId: "w1" },
      }),
      { sink },
    );
    expect(result.ok).toBe(true);
    const finished = sink.records.filter((r) => r.status === "completed");
    expect(finished.length).toBe(1);
    const record = finished[0]!;
    expect(record.schemaVersion).toBe("inspector-model-call/1");
    expect(record.id).toBe(`${result.requestId}/a2`);
    expect(record.fallbackPosition).toBe(1);
    expect(record.modelId).toBe("fixture-small");
    expect(record.outputTokens).toBe(7);
    expect(record.inputTokens).toBeNull(); // unknown stays null, never zero-fabricated
    expect(record.contextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.promptBytes).toBeGreaterThan(0);
    expect(record.attribution).toEqual({ campaignId: "cmp_1", itemId: "item_1", workerId: "w1" });
    const transportRows = sink.records.filter((r) => r.errorClassification === "transport-error");
    expect(transportRows.length).toBe(1);
    expect(transportRows[0]!.status).toBe("failed");
  });

  it("tracks aggregate counters for observability", async () => {
    const runtime = new ModelRuntime().register(new ScriptedModelProvider({ id: "p", respond: { text: "x" } }));
    await runtime.invoke(plannerSpec());
    const deniedGate: ModelBudgetGate = { admit: () => false, settle: () => {} };
    await runtime.invoke(plannerSpec(), { gate: deniedGate });
    expect(runtime.stats.requests).toBe(2);
    expect(runtime.stats.completed).toBe(1);
    expect(runtime.stats.denials).toBe(1);
  });

  it("rejects malformed provider registrations loudly", () => {
    const runtime = new ModelRuntime();
    expect(() =>
      runtime.register(new ScriptedModelProvider({ id: "", respond: { text: "x" } })),
    ).toThrow(TypeError);
    expect(() =>
      runtime.register({
        meta: { id: "broken", roles: [], priority: 1 },
        healthy: () => true,
        async invoke() {
          return { text: "" };
        },
      }),
    ).toThrow(TypeError);
  });
});
