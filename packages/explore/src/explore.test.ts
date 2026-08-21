import { describe, it, expect } from "vitest";
import type {
  CapabilityDoc,
  Observation,
  Action,
  ActionOutcome,
} from "@inspector/protocol";
import { stateFingerprint, screenFingerprint, StateGraph } from "./state.js";
import { buildInventory } from "./inventory.js";
import { scoreAction } from "./scoring.js";
import type { CandidateAction } from "./inventory.js";
import { mulberry32, hashString } from "./rng.js";
import { FaultController } from "./faults.js";
import { DefaultAnomalyDetector } from "./anomaly.js";
import { InventoryBoundPlanner, NoopPlanner } from "./planner.js";

function caps(
  over: Partial<CapabilityDoc["capabilities"]> = {},
): CapabilityDoc {
  return {
    protocolVersion: "0.1",
    adapter: "test",
    capabilities: {
      observe: ["uiTree", "url", "storage"],
      act: [
        "click",
        "fill",
        "press",
        "select",
        "reload",
        "back",
        "forward",
        "wait",
      ],
      lifecycle: ["create", "reset", "close"],
      faults: ["crash", "timeout"],
      coverage: [],
      ...over,
    },
  };
}

function obs(uiTree: unknown[], url = "http://x/"): Observation {
  return {
    id: "o1",
    runId: "r",
    environmentId: "e",
    sequence: 0,
    source: "test",
    capturedAt: new Date().toISOString(),
    summary: { url, uiTree, storage: {} },
  } as Observation;
}

describe("state fingerprinting", () => {
  it("is deterministic for the same observation", () => {
    const o = obs([
      { tag: "button", role: "button", id: "boom", hidden: false },
    ]);
    expect(stateFingerprint(o)).toBe(stateFingerprint(o));
    expect(screenFingerprint(o)).toBe(screenFingerprint(o));
  });

  it("differentiates screens by visible element set", () => {
    const login = obs([
      { tag: "input", role: "input", id: "username", hidden: false },
      { tag: "button", role: "button", id: "loginBtn", hidden: false },
    ]);
    const dashboard = obs([
      { tag: "button", role: "button", id: "increment", hidden: false },
      { tag: "button", role: "button", id: "boom", hidden: false },
    ]);
    expect(screenFingerprint(login)).not.toBe(screenFingerprint(dashboard));
  });

  it("ignores hidden elements for screen identity", () => {
    const a = obs([
      { tag: "button", role: "button", id: "boom", hidden: true },
    ]);
    const b = obs([]);
    expect(screenFingerprint(a)).toBe(screenFingerprint(b));
  });
});

describe("action inventory", () => {
  const uiTree = [
    { tag: "button", role: "button", id: "boom", hidden: false },
    { tag: "input", role: "input", id: "username", hidden: false },
  ];

  it("generates click + fill candidates with boundary flags", () => {
    const inv = buildInventory(uiTree as never, caps(), { allowFaults: false });
    expect(inv.some((c) => c.kind === "click" && c.selector === "#boom")).toBe(
      true,
    );
    expect(
      inv.some((c) => c.kind === "fill" && c.selector === "#username"),
    ).toBe(true);
    expect(inv.some((c) => c.isBoundary && c.value === "CRASH")).toBe(true);
    expect(inv.some((c) => c.kind === "fault")).toBe(false);
  });

  it("only emits fault candidates when faults are allowed", () => {
    const inv = buildInventory(uiTree as never, caps(), { allowFaults: true });
    const faults = inv.filter((c) => c.kind === "fault");
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.every((c) => c.risk === "mutate-test-state")).toBe(true);
  });
});

describe("scoring", () => {
  it("rewards novel (unvisited) edges", () => {
    const g = new StateGraph();
    g.visitState("s1", "scr", 0);
    const base = {
      graph: g,
      currentState: "s1",
      currentScreen: "scr",
      recentActionKeys: [],
      totalActions: 0,
    };
    const novel: CandidateAction = {
      id: "a",
      kind: "click",
      selector: "#x",
      risk: "interact" as const,
      actionKey: "click:#x",
      priority: 5,
    };
    const tried: CandidateAction = {
      id: "b",
      kind: "click",
      selector: "#y",
      risk: "interact" as const,
      actionKey: "click:#y",
      priority: 5,
    };
    g.recordEdge("s1", "click:#y", "s2", 0);
    expect(scoreAction(novel, base)).toBeGreaterThan(scoreAction(tried, base));
  });

  it("penalizes recently repeated actions (cycle avoidance)", () => {
    const g = new StateGraph();
    g.visitState("s1", "scr", 0);
    const base = {
      graph: g,
      currentState: "s1",
      currentScreen: "scr",
      recentActionKeys: ["click:#x", "click:#x", "click:#x"],
      totalActions: 10,
    };
    const repeat: CandidateAction = {
      id: "a",
      kind: "click",
      selector: "#x",
      risk: "interact" as const,
      actionKey: "click:#x",
      priority: 5,
    };
    const fresh: CandidateAction = {
      id: "b",
      kind: "click",
      selector: "#y",
      risk: "interact" as const,
      actionKey: "click:#y",
      priority: 5,
    };
    expect(scoreAction(repeat, base)).toBeLessThan(scoreAction(fresh, base));
  });
});

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a.next()).toBe(b.next());
    expect(a.int(100)).toBe(b.int(100));
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("hashString is stable", () => {
    expect(hashString("CRASH")).toBe(hashString("CRASH"));
  });
});

describe("fault controller", () => {
  it("requires enable + disposable + capability together", () => {
    const c = caps();
    expect(
      new FaultController(c, { enableFaultInjection: true, disposable: true })
        .allowed,
    ).toBe(true);
    expect(
      new FaultController(c, { enableFaultInjection: false, disposable: true })
        .allowed,
    ).toBe(false);
    expect(
      new FaultController(c, { enableFaultInjection: true, disposable: false })
        .allowed,
    ).toBe(false);
    const noFaults = caps({ faults: [] });
    expect(
      new FaultController(noFaults, {
        enableFaultInjection: true,
        disposable: true,
      }).allowed,
    ).toBe(false);
  });
});

describe("anomaly detector", () => {
  const det = new DefaultAnomalyDetector();
  const action: Action = {
    id: "a1",
    runId: "r",
    environmentId: "e",
    kind: "click",
    risk: "interact",
    deadlineMs: 8000,
    idempotency: "safe-retry",
  };

  it("flags a genuine application crash (TARGET_FAILURE)", () => {
    const outcome: ActionOutcome = {
      actionId: "a1",
      runId: "r",
      environmentId: "e",
      status: "target-failure",
      observedAt: new Date().toISOString(),
      error: { code: "TARGET_FAILURE", message: "IntentionalAppCrash" },
    };
    const o = obs([]);
    const a = det.detect({
      action,
      outcome,
      before: o,
      after: o,
      actionPath: [action],
      stateBefore: "s1",
    });
    expect(a?.kind).toBe("PAGE_ERROR");
  });

  it("does NOT flag automation misses (ACTION_FAILED)", () => {
    const outcome: ActionOutcome = {
      actionId: "a1",
      runId: "r",
      environmentId: "e",
      status: "target-failure",
      observedAt: new Date().toISOString(),
      error: { code: "ACTION_FAILED", message: "element not found" },
    };
    const o = obs([]);
    const a = det.detect({
      action,
      outcome,
      before: o,
      after: o,
      actionPath: [action],
      stateBefore: "s1",
    });
    expect(a).toBeNull();
  });

  it("flags impossible state (count = NaN)", () => {
    const before = obs([
      { tag: "span", role: "span", id: "count", text: "0", hidden: false },
    ]);
    const after = obs([
      { tag: "span", role: "span", id: "count", text: "NaN", hidden: false },
    ]);
    const a = det.detect({
      action,
      outcome: null,
      before,
      after,
      actionPath: [action],
      stateBefore: "s1",
    });
    expect(a?.kind).toBe("IMPOSSIBLE_STATE");
  });
});

describe("planner fallback", () => {
  it("NoopPlanner proposes nothing", () => {
    expect(
      new NoopPlanner().propose({
        screen: "",
        uiTree: [],
        recentActionKeys: [],
        discoveredKinds: [],
      }),
    ).toBeNull();
  });

  it("inventory-bound planner can never bypass the allowed action inventory", () => {
    const uiTree = [
      { tag: "button", role: "button", id: "boom", hidden: false },
    ];
    const inventory = buildInventory(uiTree as never, caps(), {
      allowFaults: false,
    });
    const planner = new InventoryBoundPlanner(
      () => inventory,
      () => 0.5,
    );
    const proposed = planner.propose({
      screen: "",
      uiTree: uiTree as never,
      recentActionKeys: [],
      discoveredKinds: [],
    });
    expect(proposed).not.toBeNull();
    expect(inventory.some((c) => c.actionKey === proposed?.actionKey)).toBe(
      true,
    );
  });
});
