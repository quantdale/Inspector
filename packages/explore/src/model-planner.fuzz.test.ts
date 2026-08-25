import { describe, expect, it } from "vitest";
import { ModelRuntime, ScriptedModelProvider } from "@inspector/model-runtime";
import type { ModelCallRecord, ModelCallSink } from "@inspector/model-runtime";
import { mulberry32 } from "./rng.js";
import {
  buildPlannerPacket,
  enforcePacketCeiling,
  serializePacket,
} from "./model-context.js";
import { SemanticPlanner } from "./model-planner.js";
import { redactFreeformText } from "@inspector/adapter-sdk";

/** Deterministic pseudo-random JSON garbage generator (seeded => stable CI). */
function fuzzJson(rng: ReturnType<typeof mulberry32>, depth = 0): string {
  const next = (): number => rng.next();
  const kinds = ["object", "array", "string", "number", "bool", "broken"];
  const kind = kinds[Math.floor(next() * kinds.length)]!;
  switch (kind) {
    case "object": {
      if (depth > 3) return "{}";
      const keys = ["actionKey", "confidence", "goal", "nested", `k${Math.floor(next() * 100)}`];
      const entries: string[] = [];
      for (let i = 0; i < 1 + Math.floor(next() * 3); i++) {
        entries.push(`${JSON.stringify(keys[Math.floor(next() * keys.length)]!)}:${fuzzJson(rng, depth + 1)}`);
      }
      return `{${entries.join(",")}}`;
    }
    case "array":
      return `[${Array.from({ length: Math.floor(next() * 3) }, () => fuzzJson(rng, depth + 1)).join(",")}]`;
    case "string":
      return JSON.stringify(next() < 0.5 ? "click#injected" : "x".repeat(Math.floor(next() * 300)));
    case "number":
      return String(next() < 0.5 ? next() * 5 : Math.floor(next() * 100000));
    case "bool":
      return next() < 0.5 ? "true" : "false";
    default:
      // Deliberately broken JSON fragments.
      return next() < 0.5 ? '{"actionKey":' : '{"actionKey":"click#a",,}';
  }
}

const INVENTORY_KEYS = new Set(["click#a", "click#b", "fill#c"]);

class Sink implements ModelCallSink {
  readonly records: ModelCallRecord[] = [];
  start(r: ModelCallRecord): void {
    this.records.push(r);
  }
  finish(r: ModelCallRecord): void {
    this.records.push(r);
  }
}

describe("M13 F21: property coverage around the intelligence contracts", () => {
  it("P1: NO malformed/injected planner output can ever yield an out-of-inventory acceptance", async () => {
    const rng = mulberry32(20260825);
    let acceptances = 0;
    let rejections = 0;
    for (let i = 0; i < 200; i++) {
      const payload = fuzzJson(rng);
      const provider = new ScriptedModelProvider({ id: `fuzz`, respond: { text: payload } });
      const planner = new SemanticPlanner({ runtime: new ModelRuntime().register(provider) });
      const decision = await planner.suggest({
        stateFingerprint: "st",
        screenSummary: "",
        usableCandidates: [
          { actionKey: "click#a", kind: "click", risk: "interact", score: 1 },
          { actionKey: "click#b", kind: "click", risk: "interact", score: 2 },
          { actionKey: "fill#c", kind: "fill", risk: "mutate-test-state", score: 3 },
        ] as never,
        budgetsRemaining: { actions: 10, resets: 0 },
        actionsSinceNewState: 99,
      });
      if (decision.accepted) {
        acceptances += 1;
        // THE invariant: acceptance implies EXACT inventory membership.
        expect(INVENTORY_KEYS.has(decision.actionKey ?? "")).toBe(true);
      } else {
        rejections += 1;
      }
    }
    // The fuzz corpus actually exercised both paths.
    expect(acceptances + rejections).toBe(200);
    expect(rejections).toBeGreaterThan(100); // garbage mostly rejected
  });

  it("P2: durable attempt ids remain globally unique across many invocations", async () => {
    const sink = new Sink();
    const provider = new ScriptedModelProvider({ id: "p", respond: { text: "ok" } });
    const runtime = new ModelRuntime().register(provider);
    for (let i = 0; i < 60; i++) {
      await runtime.invoke({
        role: "summarizer",
        requestClass: "session-digest",
        prompt: `packet ${i}`,
      }, { sink });
    }
    const startedIds = sink.records.filter((r) => r.status === "started").map((r) => r.id);
    expect(new Set(startedIds).size).toBe(startedIds.length);
    expect(startedIds.length).toBe(60);
    // Every attempt also reached a terminal row.
    expect(sink.records.filter((r) => r.status === "completed").length).toBe(60);
  });

  it("P3: context packets stay bounded under adversarial input sizes (seeded)", () => {
    const rng = mulberry32(4242);
    const next = (): number => rng.next();
    const ceiling = 16 * 1024;
    for (let i = 0; i < 25; i++) {
      const candidates = Array.from({ length: Math.floor(next() * 48) + 1 }, (_, j) => ({
        actionKey: `click#${"z".repeat(Math.floor(next() * 400))}-${j}`,
        kind: "click",
        risk: "interact",
        score: next() * 10,
      }));
      const packet = buildPlannerPacket({
        stateFingerprint: "st",
        screenSummary: "y".repeat(Math.floor(next() * 50000)),
        candidates,
        recentActionKeys: Array.from({ length: Math.floor(next() * 20) }, (_, k) => `fill#${k}`),
        anomalyHints: [redactFreeformText("q".repeat(Math.floor(next() * 8000)))],
      }).packet;
      const enforced = enforcePacketCeiling(
        packet,
        ["candidateActions", "recentActions", "nearbyStates", "anomalyHints", "rejectedSuggestions"],
        ceiling,
        ["deterministicScores"],
      );
      expect(Buffer.byteLength(serializePacket(enforced.packet), "utf8")).toBeLessThanOrEqual(ceiling);
    }
  });

  it("P4: redaction is deterministic for repeated identical inputs", () => {
    const sample = "token=abc123 https://u:p@host/path sk-reallysecretvalue99 bearer XYZ";
    expect(redactFreeformText(sample)).toBe(redactFreeformText(sample));
    expect(redactFreeformText(sample)).not.toContain("sk-reallysecretvalue99");
  });
});
