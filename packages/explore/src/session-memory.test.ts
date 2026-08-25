import { describe, expect, it } from "vitest";
import { ModelRuntime, ScriptedModelProvider, jsonOutcome } from "@inspector/model-runtime";
import { SessionSummarizer } from "./session-memory.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    actionsExecuted: 30,
    statesVisited: 6,
    recentActionKeys: ["click#a", "fill#b"],
    anomalies: [{ kind: "PAGE_ERROR", message: "boom" }],
    rejectedSuggestions: ["click#fabricated"],
    ...overrides,
  };
}

describe("M13 F12: bounded session summarization memory", () => {
  it("produces a digest and serves it from cache until the refresh interval elapses", async () => {
    const provider = new ScriptedModelProvider({
      id: "sum",
      respond: jsonOutcome({ summary: "explored hub; vault untouched", openQuestions: ["does secret branch crash?"] }),
    });
    const summarizer = new SessionSummarizer(new ModelRuntime().register(provider), { refreshIntervalActions: 25 });
    const first = await summarizer.digest(input());
    expect(first).toContain("vault untouched");
    expect(first).toContain("open question:");
    const callsAfterFirst = provider.calls.length;
    const cached = await summarizer.digest(input({ actionsExecuted: 35 }));
    expect(cached).toBe(first);
    expect(provider.calls.length).toBe(callsAfterFirst);
    // Interval elapsed -> refresh happens.
    await summarizer.digest(input({ actionsExecuted: 60 }));
    expect(provider.calls.length).toBe(callsAfterFirst + 1);
  });

  it("keeps the previous digest when summarization fails, and null when there is none", async () => {
    let respondWithJson = true;
    const provider = new ScriptedModelProvider({
      id: "flaky",
      respond: () =>
        respondWithJson
          ? jsonOutcome({ summary: "stable" })
          : { text: "{broken json" },
    });
    const summarizer = new SessionSummarizer(new ModelRuntime().register(provider), { refreshIntervalActions: 0 });
    const first = await summarizer.digest(input());
    expect(first).toContain("stable");
    respondWithJson = false; // next refresh is malformed -> keep previous cache
    const degraded = await summarizer.digest(input({ actionsExecuted: 999 }));
    expect(degraded).toBe(first);
  });

  it("survives budget denial with a null digest and never throws", async () => {
    const summarizer = new SessionSummarizer(
      new ModelRuntime().register(new ScriptedModelProvider({ id: "s", respond: { text: "{}" } })),
      {},
      { admit: () => false, settle: () => {} },
    );
    await expect(summarizer.digest(input())).resolves.toBeNull();
  });

  it("snapshot/restore round-trips for checkpoint continuity", async () => {
    const provider = new ScriptedModelProvider({
      id: "sum",
      respond: jsonOutcome({ summary: "digest body" }),
    });
    const summarizer = new SessionSummarizer(new ModelRuntime().register(provider));
    await summarizer.digest(input({ actionsExecuted: 40 }));
    const snap = summarizer.snapshot();
    const restored = new SessionSummarizer(new ModelRuntime().register(
      new ScriptedModelProvider({ id: "other", respond: { text: "{}" } }),
    ));
    restored.restore(snap.digest, snap.atAction);
    expect(restored.snapshot()).toEqual(snap);
    // Restored digest served without any model call.
    const again = await restored.digest(input({ actionsExecuted: 45 }));
    expect(again).toBe(snap.digest);
  });
});
