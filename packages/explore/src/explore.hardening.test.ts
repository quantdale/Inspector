/**
 * Wave-2 hardening tests for the exploration engine (Phase C).
 *
 * Everything here is deterministic and browserless: the RunController boundary
 * is mocked by FakeRunController/FakeEnv, and reproduction replays against a
 * fresh FakeEnv via FakeReplayDriver (mirroring WebReplayDriver's signal
 * translation). Each D<N> section reproduces one defect from the wave-2 list
 * before the fix; the assertions encode the post-fix contract.
 */
import { describe, it, expect, vi } from "vitest";
import type {
  Action,
  ActionOutcome,
  CapabilityDoc,
  Observation,
} from "@inspector/protocol";
import { newId } from "@inspector/protocol";
import type { RunController, SubmitResult } from "@inspector/core";
import type {
  Finding,
  ReplayDriver,
  ReplayResult,
  OracleSignal,
  RegressionScenario,
} from "@inspector/finding";
import { FindingEngine } from "@inspector/finding";
import type { Store } from "@inspector/store-sqlite";
import { ExploreController } from "./campaign.js";
import type { ExploreConfig, ExploreResult } from "./campaign.js";
import {
  stateFingerprint,
  screenFingerprint,
  StateGraph,
  type UiElement,
} from "./state.js";
import { buildInventory } from "./inventory.js";
import { DefaultAnomalyDetector } from "./anomaly.js";
import { mulberry32, hashString } from "./rng.js";

// ---------------------------------------------------------------------------
// Fake environment harness (browserless RunController boundary)
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type FakeElement = UiElement;

interface FakeScreen {
  url?: string;
  elements: FakeElement[];
  storage?: Record<string, string>;
}

interface FakeTransitionRule {
  from: string;
  kind: string;
  selector?: string;
  value?: string;
  /** Navigate to this screen on success. */
  to?: string;
  /** Genuine application crash: TARGET_FAILURE outcome. */
  crash?: boolean;
  /** Environment lost: adapter-error submit result. */
  adapterError?: boolean;
  /** Policy rejection. */
  reject?: boolean;
  /** Automation miss: ACTION_FAILED outcome (never a defect). */
  actionFailed?: boolean;
  /** Rule consumes itself after the first match. */
  once?: boolean;
  artifactRefs?: string[];
}

interface FakeAppSpec {
  screens: Record<string, FakeScreen>;
  initial: string;
  transitions?: FakeTransitionRule[];
  /** observe() throws once more calls than this have been made. */
  observeThrowsAfter?: number;
  /** reset() throws (string becomes the error message). */
  resetThrows?: boolean | string;
  /** Simulated transient/delayed UI: sleep before every act/observe. */
  actionDelayMs?: number;
}

class FakeEnv {
  current: string;
  observes = 0;
  private readonly consumedOnce = new Set<number>();

  constructor(private readonly spec: FakeAppSpec) {
    this.current = spec.initial;
  }

  private match(
    action: Action,
  ): { rule: FakeTransitionRule; index: number } | null {
    const rules = this.spec.transitions ?? [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (rule.once && this.consumedOnce.has(i)) continue;
      if (rule.from !== this.current || rule.kind !== action.kind) continue;
      if (
        rule.selector !== undefined &&
        rule.selector !== String(action.input?.selector ?? "")
      )
        continue;
      if (
        rule.value !== undefined &&
        rule.value !== String(action.input?.value ?? "")
      )
        continue;
      return { rule, index: i };
    }
    return null;
  }

  async submitAction(action: Action): Promise<SubmitResult> {
    const matched = this.match(action);
    const base = {
      actionId: action.id,
      runId: "run-fake",
      environmentId: "env-fake",
      observedAt: new Date().toISOString(),
    };
    if (!matched) {
      return {
        kind: "outcome",
        outcome: { ...base, status: "success", stateAfter: this.current },
      };
    }
    const { rule, index } = matched;
    if (rule.reject) {
      return {
        kind: "rejected",
        decision: { allowed: false, reason: "fake policy rejects this action" },
      };
    }
    if (rule.adapterError) {
      return { kind: "adapter-error", error: "fake adapter lost the environment" };
    }
    if (this.spec.actionDelayMs) await sleep(this.spec.actionDelayMs);
    if (rule.once) this.consumedOnce.add(index);
    if (rule.crash) {
      return {
        kind: "outcome",
        outcome: {
          ...base,
          status: "target-failure",
          error: {
            code: "TARGET_FAILURE",
            message: `IntentionalCrash:${String(action.input?.selector ?? "")}`,
          },
          artifactRefs: rule.artifactRefs,
        },
      };
    }
    if (rule.actionFailed) {
      return {
        kind: "outcome",
        outcome: {
          ...base,
          status: "target-failure",
          error: { code: "ACTION_FAILED", message: "element not found" },
        },
      };
    }
    if (rule.to) this.current = rule.to;
    return {
      kind: "outcome",
      outcome: {
        ...base,
        status: "success",
        stateAfter: this.current,
        artifactRefs: rule.artifactRefs,
      },
    };
  }

  async observe(_fields: string[]): Promise<Observation> {
    this.observes += 1;
    if (this.spec.actionDelayMs) await sleep(this.spec.actionDelayMs);
    if (
      this.spec.observeThrowsAfter !== undefined &&
      this.observes > this.spec.observeThrowsAfter
    ) {
      throw new Error("fake observer degraded");
    }
    const screen = this.spec.screens[this.current] ?? { elements: [] };
    return {
      id: newId("obs"),
      runId: "run-fake",
      environmentId: "env-fake",
      sequence: this.observes,
      source: "fake-env",
      capturedAt: new Date().toISOString(),
      summary: {
        url: screen.url ?? `fake://${this.current}`,
        uiTree: structuredClone(screen.elements),
        storage: { ...(screen.storage ?? {}) },
      },
    };
  }

  async reset(): Promise<void> {
    if (this.spec.resetThrows) {
      throw new Error(
        typeof this.spec.resetThrows === "string"
          ? this.spec.resetThrows
          : "fake reset failed",
      );
    }
    this.current = this.spec.initial;
  }
}

class FakeRunController {
  readonly caps: CapabilityDoc;
  readonly runId = "run-fake";
  readonly environmentId = "env-fake";

  constructor(
    readonly env: FakeEnv,
    caps?: CapabilityDoc,
  ) {
    this.caps = caps ?? defaultCaps();
  }

  observe(fields: string[]): Promise<Observation> {
    return this.env.observe(fields);
  }

  submitAction(action: Action): Promise<SubmitResult> {
    return this.env.submitAction(action);
  }

  reset(): Promise<void> {
    return this.env.reset();
  }
}

function defaultCaps(
  over: Partial<CapabilityDoc["capabilities"]> = {},
): CapabilityDoc {
  return {
    protocolVersion: "0.1",
    adapter: "fake-web",
    capabilities: {
      observe: ["url", "uiTree", "storage", "pageErrors", "title"],
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
      faults: [],
      coverage: [],
      ...over,
    },
  };
}

/** Replays a captured path against a *fresh* fake environment (browserless). */
class FakeReplayDriver implements ReplayDriver {
  constructor(private readonly makeSpec: () => FakeAppSpec) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    const env = new FakeEnv(this.makeSpec());
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    for (const a of actions) {
      const r = await env.submitAction(a);
      if (r.kind === "outcome") {
        outcomes.push(r.outcome);
        if (
          r.outcome.status === "target-failure" &&
          r.outcome.error?.code === "TARGET_FAILURE"
        ) {
          signals.push({ kind: "PAGE_ERROR", detail: r.outcome.error.message });
        }
      }
    }
    return { outcomes, signals, observations: [] };
  }
}

/** Wrapper whose nth call can be forced to produce a non-reproducing result. */
class FlakyReplayDriver implements ReplayDriver {
  private calls = 0;
  constructor(
    private readonly inner: ReplayDriver,
    private readonly failOn: (n: number) => boolean,
  ) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    this.calls += 1;
    if (this.failOn(this.calls)) {
      return { outcomes: [], signals: [], observations: [] };
    }
    return this.inner.replay(actions);
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function crashApp(): FakeAppSpec {
  return {
    initial: "home",
    screens: {
      home: { elements: [{ tag: "button", role: "button", id: "boom" }] },
    },
    transitions: [
      { from: "home", kind: "click", selector: "#boom", crash: true, artifactRefs: ["artifact://trace-crash"] },
    ],
  };
}

function twoCrashApp(): FakeAppSpec {
  return {
    initial: "home",
    screens: {
      home: {
        elements: [
          { tag: "button", role: "button", id: "boomA" },
          { tag: "button", role: "button", id: "boomB" },
          { tag: "button", role: "button", id: "safe" },
        ],
      },
      page2: {
        elements: [
          { tag: "button", role: "button", id: "back" },
          { tag: "button", role: "button", id: "safe2" },
        ],
      },
    },
    transitions: [
      { from: "home", kind: "click", selector: "#boomA", crash: true },
      { from: "home", kind: "click", selector: "#boomB", crash: true },
      { from: "home", kind: "click", selector: "#safe", to: "page2" },
      { from: "page2", kind: "click", selector: "#back", to: "home" },
    ],
  };
}

/** Healthy two-screen cycle app with a counter: zero defects. */
function cycleApp(extra: Partial<FakeAppSpec> = {}): FakeAppSpec {
  return {
    initial: "home",
    screens: {
      home: {
        elements: [
          { tag: "button", role: "button", id: "go" },
          { tag: "button", role: "button", id: "inc" },
          { tag: "span", role: "status", id: "count", text: "0" },
        ],
      },
      page2: {
        elements: [
          { tag: "button", role: "button", id: "back" },
          { tag: "span", role: "status", id: "label", text: "page two" },
        ],
      },
    },
    transitions: [
      { from: "home", kind: "click", selector: "#go", to: "page2" },
      { from: "page2", kind: "click", selector: "#back", to: "home" },
      { from: "home", kind: "click", selector: "#inc" },
    ],
    ...extra,
  };
}

function kaboomApp(extra: Partial<FakeAppSpec> = {}): FakeAppSpec {
  return {
    initial: "home",
    screens: {
      home: { elements: [{ tag: "button", role: "button", id: "kaboom" }] },
    },
    transitions: [
      { from: "home", kind: "click", selector: "#kaboom", adapterError: true },
    ],
    ...extra,
  };
}

interface HarnessOptions {
  spec: FakeAppSpec;
  config?: Partial<ExploreConfig>;
  caps?: CapabilityDoc;
  store?: Store;
  findingEngine?: FindingEngine;
  driverFactory?: () => ReplayDriver;
}

function makeHarness(opts: HarnessOptions): {
  controller: ExploreController;
  run: FakeRunController;
  env: FakeEnv;
} {
  const env = new FakeEnv(opts.spec);
  const run = new FakeRunController(env, opts.caps);
  const controller = new ExploreController({
    run: run as unknown as RunController,
    store: opts.store,
    findingEngine: opts.findingEngine,
    replayDriverFactory: opts.driverFactory,
    config: {
      seed: 42,
      maxActions: 40,
      maxResets: 6,
      enableFaultInjection: false,
      disposable: false,
      ...opts.config,
    },
  });
  return { controller, run, env };
}

function projectResult(r: ExploreResult): Record<string, unknown> {
  return {
    actionsExecuted: r.actionsExecuted,
    statesVisited: r.statesVisited,
    transitions: r.transitions,
    resets: r.resets,
    actionKindSequence: r.actionKindSequence,
    anomalyClassKeys: r.anomalies.map((a) => a.classKey).sort(),
    stoppedReason: r.stoppedReason,
  };
}

// ---------------------------------------------------------------------------
// D1: finish() error isolation + incremental persistence
// ---------------------------------------------------------------------------

describe("D1 finish() error isolation", () => {
  it("one failing replay driver must not destroy the remaining findings", async () => {
    const putFinding = vi.fn();
    const store = { putFinding } as unknown as Store;
    let factoryCalls = 0;
    const { controller } = makeHarness({
      spec: twoCrashApp(),
      store,
      findingEngine: new FindingEngine(),
      driverFactory: () => {
        factoryCalls += 1;
        if (factoryCalls === 2) {
          throw new Error("chromium failed to launch (driver #2)");
        }
        return new FakeReplayDriver(twoCrashApp);
      },
      config: {
        seed: 7,
        maxActions: 30,
        maxResets: 6,
        reproducibleAttempts: 2,
        reproducibleMinSuccesses: 1,
      },
    });

    const result = await controller.run_();

    // Both anomalies were discovered...
    expect(result.anomalies.length).toBe(2);
    // ...the first was fully confirmed despite the second's driver exploding.
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.status).toBe("CONFIRMED");
    expect(result.evidenceBundles.length).toBe(1);
    // The failure is recorded, not swallowed.
    const errorOutcome = result.findingOutcomes.find((o) => o.outcome === "error");
    expect(errorOutcome).toBeDefined();
    expect(errorOutcome?.detail).toContain("chromium failed to launch");
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    // Incremental persistence: the confirmed finding reached the store even
    // though the run continued past a reproduction failure.
    expect(
      putFinding.mock.calls.some(
        (call) => (call[0] as { status: string }).status === "CONFIRMED",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D2: promotion gating + real oracle evidence in bundles
// ---------------------------------------------------------------------------

describe("D2 promotion gating and evidence wiring", () => {
  it("does not treat an unverified minimization as verified, and records the reason", async () => {
    const putFinding = vi.fn();
    const store = { putFinding } as unknown as Store;
    const inner = new FakeReplayDriver(crashApp);
    const { controller } = makeHarness({
      spec: crashApp(),
      store,
      findingEngine: new FindingEngine(),
      driverFactory: () => new FlakyReplayDriver(inner, (n) => n % 3 === 0),
      config: {
        seed: 11,
        maxActions: 12,
        maxResets: 4,
        reproducibleAttempts: 2,
        reproducibleMinSuccesses: 1,
      },
    });

    const result = await controller.run_();

    expect(result.findings.length).toBe(1);
    const finding: Finding = result.findings[0]!;
    // Confirmed under the reproduction policy (attempts 1-2 both reproduced)...
    expect(finding.status).toBe("CONFIRMED");
    // ...but minimization failed its own baseline verification and must say so.
    expect(finding.minimization?.verifiedReproduction).toBe(false);
    expect(
      result.findingOutcomes.some(
        (o) => o.outcome === "confirmed-unverified-minimization",
      ),
    ).toBe(true);

    const bundle = result.evidenceBundles[0]!;
    // Bundles carry actual oracle evidence, not an empty array.
    expect(bundle.oracleEvidence.length).toBeGreaterThan(0);
    expect(bundle.oracleEvidence[0]?.kind).toBe("PAGE_ERROR");
    // Artifact refs from the discovering outcome flow into the bundle.
    expect(bundle.artifactRefs).toContain("artifact://trace-crash");
    // Real adapter identity is recorded at ingest and on regressions.
    expect(finding.adapter).toBe("fake-web");
    const scenario: RegressionScenario | undefined =
      result.regressionScenarios[0];
    expect(scenario).toBeDefined();
    expect(scenario?.adapter).toBe("fake-web");
    expect(scenario?.expectOracle).toBe("PAGE_ERROR");
    expect(putFinding.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("records a reason when reproduction rejects the finding", async () => {
    const putFinding = vi.fn();
    const store = { putFinding } as unknown as Store;
    const inner = new FakeReplayDriver(crashApp);
    const { controller } = makeHarness({
      spec: crashApp(),
      store,
      findingEngine: new FindingEngine(),
      driverFactory: () => new FlakyReplayDriver(inner, () => true),
      config: {
        seed: 11,
        maxActions: 12,
        maxResets: 4,
        reproducibleAttempts: 2,
        reproducibleMinSuccesses: 1,
      },
    });

    const result = await controller.run_();

    expect(result.anomalies.length).toBe(1);
    expect(result.findings.length).toBe(0);
    expect(result.findingOutcomes[0]?.outcome).toBe("rejected");
    expect(
      putFinding.mock.calls.some(
        (call) => (call[0] as { status: string }).status === "REJECTED",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D3: policy-rejected actions must not pollute evidence or counters
// ---------------------------------------------------------------------------

describe("D3 rejected actions stay out of the evidence path", () => {
  it("rejected faults never enter counters, kind sequence, or reproducer path", async () => {
    const { controller } = makeHarness({
      spec: {
        initial: "home",
        screens: { home: { elements: [] } },
        transitions: [{ from: "home", kind: "fault", reject: true }],
      },
      caps: defaultCaps({ act: [], faults: ["crash", "timeout"] }),
      config: {
        seed: 5,
        maxActions: 10,
        maxResets: 0,
        enableFaultInjection: true,
        disposable: true,
      },
    });

    const result = await controller.run_();

    expect(result.actionsExecuted).toBe(0);
    expect(result.actionKindSequence).not.toContain("fault");
    expect(result.stoppedReason).toBe("no-candidates");
  });
});

// ---------------------------------------------------------------------------
// D4: impossible-state detector transition gating + generalization
// ---------------------------------------------------------------------------

describe("D4 impossible-state detector", () => {
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

  function detect(beforeEls: FakeElement[], afterEls: FakeElement[]) {
    const mk = (els: FakeElement[]): Observation =>
      ({
        id: "o",
        runId: "r",
        environmentId: "e",
        sequence: 0,
        source: "test",
        capturedAt: new Date().toISOString(),
        summary: { url: "http://x/", uiTree: els, storage: {} },
      }) as Observation;
    return det.detect({
      action,
      outcome: null,
      before: mk(beforeEls),
      after: mk(afterEls),
      actionPath: [action],
      stateBefore: "s1",
    });
  }

  it("flags a genuine counter overflow (numeric -> NaN)", () => {
    const a = detect(
      [{ tag: "span", role: "status", id: "count", text: "0" }],
      [{ tag: "span", role: "status", id: "count", text: "NaN" }],
    );
    expect(a?.kind).toBe("IMPOSSIBLE_STATE");
    expect(a?.severityHint).toBe("high");
  });

  it("flags numeric -> Infinity on any element, not just id=count", () => {
    const a = detect(
      [{ tag: "span", role: "status", id: "total", text: "41" }],
      [{ tag: "span", role: "status", id: "total", text: "Infinity" }],
    );
    expect(a?.kind).toBe("IMPOSSIBLE_STATE");
  });

  it("does NOT flag a healthy app that legitimately displays null", () => {
    const a = detect(
      [{ tag: "span", role: "status", id: "count", text: "null" }],
      [{ tag: "span", role: "status", id: "count", text: "null" }],
    );
    expect(a).toBeNull();
  });

  it("does NOT flag a fresh element with no transition evidence", () => {
    const a = detect(
      [{ tag: "button", role: "button", id: "ok" }],
      [{ tag: "span", role: "status", id: "count", text: "NaN" }],
    );
    expect(a).toBeNull();
  });

  it("does NOT flag non-numeric context transitioning to a sentinel", () => {
    const a = detect(
      [{ tag: "span", role: "status", id: "label", text: "N/A" }],
      [{ tag: "span", role: "status", id: "label", text: "null" }],
    );
    expect(a).toBeNull();
  });

  it("does NOT flag an unchanged numeric value", () => {
    const a = detect(
      [{ tag: "span", role: "status", id: "count", text: "0" }],
      [{ tag: "span", role: "status", id: "count", text: "0" }],
    );
    expect(a).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D5: fingerprint collisions
// ---------------------------------------------------------------------------

describe("D5 fingerprint collisions", () => {
  function obsOf(elements: FakeElement[], storage: Record<string, string> = {}) {
    return {
      id: "o",
      runId: "r",
      environmentId: "e",
      sequence: 0,
      source: "test",
      capturedAt: new Date().toISOString(),
      summary: { url: "http://x/", uiTree: elements, storage },
    } as Observation;
  }

  it("screen identity separates id-identified from name-identified elements", () => {
    const a = obsOf([{ tag: "button", role: "button", id: "save" }]);
    const b = obsOf([{ tag: "input", role: "textbox", name: "save" }]);
    expect(screenFingerprint(b)).not.toBe(screenFingerprint(a));
  });

  it("state identity separates storage states that differ only in values", () => {
    const dark = obsOf(
      [{ tag: "button", role: "button", id: "save" }],
      { theme: "dark" },
    );
    const light = obsOf(
      [{ tag: "button", role: "button", id: "save" }],
      { theme: "light" },
    );
    expect(stateFingerprint(dark)).not.toBe(stateFingerprint(light));
  });

  it("fill dedup hashing survives FNV-1a collisions (v7pwu vs ve5fa)", () => {
    // Documented 32-bit FNV-1a collision found by brute force.
    expect(hashString("v7pwu")).toBe(hashString("ve5fa"));
    const inv = buildInventory(
      [{ tag: "input", role: "textbox", id: "f" }] as never,
      defaultCaps({ act: ["fill"] }),
      { allowFaults: false },
    );
    const keys = inv.filter((c) => c.kind === "fill").map((c) => c.actionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps fingerprints deterministic", () => {
    const o = obsOf([{ tag: "button", role: "button", id: "save" }], {
      theme: "dark",
    });
    expect(stateFingerprint(o)).toBe(stateFingerprint(o));
    expect(screenFingerprint(o)).toBe(screenFingerprint(o));
  });
});

// ---------------------------------------------------------------------------
// D6: press candidates carry concrete keys
// ---------------------------------------------------------------------------

describe("D6 press candidates", () => {
  it("emits concrete non-empty key candidates instead of a valueless press", () => {
    const inv = buildInventory(
      [{ tag: "input", role: "textbox", id: "q" }] as never,
      defaultCaps({ act: ["press"] }),
      { allowFaults: false },
    );
    const presses = inv.filter((c) => c.kind === "press");
    expect(presses.length).toBeGreaterThanOrEqual(4);
    for (const p of presses) {
      expect(typeof p.value).toBe("string");
      expect(p.value!.length).toBeGreaterThan(0);
    }
    expect(presses.some((p) => p.value === "Enter")).toBe(true);
    const keys = presses.map((p) => p.actionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// D7: all-toxic pools are dead ends, never re-executed
// ---------------------------------------------------------------------------

describe("D7 toxic fallback", () => {
  it("treats an all-toxic pool as a dead end instead of re-running the hazard", async () => {
    const { controller } = makeHarness({
      spec: kaboomApp(),
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 3, maxActions: 10, maxResets: 2 },
    });

    const result = await controller.run_();

    // The hazard ran exactly once; afterwards the pool was a dead end and the
    // remaining budget went to reset attempts, not to re-executing the hazard.
    expect(result.actionsExecuted).toBe(1);
    expect(result.resets).toBe(2);
    expect(result.stoppedReason).toBe("no-candidates");
  });
});

// ---------------------------------------------------------------------------
// D8: silent-catch degradation
// ---------------------------------------------------------------------------

describe("D8 degradation visibility", () => {
  it("stops with an explicit reason when the initial observe fails", async () => {
    const { controller } = makeHarness({
      spec: cycleApp({ observeThrowsAfter: 0 }),
      config: { seed: 9, maxActions: 10, maxResets: 2 },
    });

    const result = await controller.run_();

    expect(result.stoppedReason).toBe("initial-observe-failed");
    expect(result.actionsExecuted).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("stops with observer-degraded after consecutive observe failures", async () => {
    const { controller } = makeHarness({
      spec: cycleApp({ observeThrowsAfter: 5 }),
      config: { seed: 9, maxActions: 20, maxResets: 4 },
    });

    const result = await controller.run_();

    expect(result.stoppedReason).toBe("observer-degraded");
    expect(result.warnings.some((w) => w.includes("observe"))).toBe(true);
    expect(result.actionsExecuted).toBeLessThan(20);
  });

  it("records reset failures instead of swallowing them", async () => {
    const { controller } = makeHarness({
      spec: kaboomApp({ resetThrows: "fake reset exploded" }),
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 3, maxActions: 10, maxResets: 2 },
    });

    const result = await controller.run_();

    expect(result.stoppedReason).toBe("reset-failed");
    expect(
      result.warnings.some((w) => w.includes("fake reset exploded")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D9: hygiene batch
// ---------------------------------------------------------------------------

describe("D9 hygiene", () => {
  it("Rng.pick throws a typed error on an empty array", () => {
    expect(() => mulberry32(1).pick([])).toThrow(/empty/i);
  });

  it("Edge.leadsToState keeps the first target (stable)", () => {
    const g = new StateGraph();
    g.recordEdge("s1", "a", "s2", 1);
    g.recordEdge("s1", "a", "s3", 2);
    expect(g.edges.get("s1::a")?.leadsToState).toBe("s2");
  });

  it("escapes quotes and brackets in text-derived selectors", async () => {
    const inv = buildInventory(
      [
        {
          tag: "button",
          role: "button",
          name: 'He said "hi" [ok]',
        },
      ] as never,
      defaultCaps({ act: ["click"] }),
      { allowFaults: false },
    );
    const click = inv.find((c) => c.kind === "click");
    // Buttons carry their label as observed text content, so the selector
    // uses Playwright's text engine (not an aria-label attribute).
    expect(click?.selector).toBe('text="He said \\"hi\\" \\[ok\\]"');
  });

  it("deduplicates identical actionKeys in the inventory", () => {
    const inv = buildInventory(
      [
        { tag: "button", role: "button", id: "dup" },
        { tag: "button", role: "button", id: "dup" },
      ] as never,
      defaultCaps({ act: ["click"] }),
      { allowFaults: false },
    );
    expect(
      inv.filter((c) => c.actionKey === "click:#dup").length,
    ).toBe(1);
  });

  it("bounds a single sequence by the wall budget (per-step check)", async () => {
    const { controller } = makeHarness({
      spec: cycleApp({ actionDelayMs: 25 }),
      config: {
        seed: 21,
        maxActions: 50,
        maxResets: 2,
        maxWallMs: 60,
        sequenceLengths: [12],
      },
    });

    const result = await controller.run_();

    expect(result.stoppedReason).toBe("wall-budget");
    // Without the per-step bound the whole 12-repeat sequence runs first.
    expect(result.actionsExecuted).toBeLessThanOrEqual(6);
  });

  it("reports a shortfall when the finding cap cannot be filled with confirmations", async () => {
    const inner = new FakeReplayDriver(twoCrashApp);
    // Per-path driver: only #boomA paths reproduce; #boomB paths do not.
    class PathAwareDriver implements ReplayDriver {
      async replay(actions: Action[]): Promise<ReplayResult> {
        const base = await inner.replay(actions);
        const touchesBoomB = actions.some(
          (a) => String(a.input?.selector ?? "") === "#boomB",
        );
        return touchesBoomB
          ? { outcomes: [], signals: [], observations: [] }
          : base;
      }
    }
    const { controller: c2 } = makeHarness({
      spec: twoCrashApp(),
      findingEngine: new FindingEngine(),
      driverFactory: () => new PathAwareDriver(),
      config: {
        seed: 7,
        maxActions: 30,
        maxResets: 6,
        maxFindings: 2,
        reproducibleAttempts: 2,
        reproducibleMinSuccesses: 1,
      },
    });

    const result = await c2.run_();

    expect(result.anomalies.length).toBe(2);
    expect(result.findings.length).toBe(1);
    expect(result.stoppedReason).toBe("finding-cap");
    expect(
      result.warnings.some((w) => w.includes("finding-cap")),
    ).toBe(true);
    expect(
      result.findingOutcomes.some((o) => o.outcome === "rejected"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D10: Phase-C torture fixtures (deterministic, browserless)
// ---------------------------------------------------------------------------

describe("D10 torture fixtures", () => {
  it("NO-BUG cycle app produces zero findings through the full pipeline", async () => {
    const spec = cycleApp();
    const { controller } = makeHarness({
      spec,
      findingEngine: new FindingEngine(),
      driverFactory: () => new FakeReplayDriver(cycleApp),
      config: { seed: 99, maxActions: 40, maxResets: 6 },
    });

    const result = await controller.run_();

    expect(result.anomalies.length).toBe(0);
    expect(result.findings.length).toBe(0);
    expect(result.evidenceBundles.length).toBe(0);
    expect(result.actionsExecuted).toBeLessThanOrEqual(40);
  });

  it("is deterministic for a given seed", async () => {
    async function runOnce(): Promise<Record<string, unknown>> {
      const { controller } = makeHarness({
        spec: cycleApp(),
        findingEngine: new FindingEngine(),
        driverFactory: () => new FakeReplayDriver(cycleApp),
        config: { seed: 99, maxActions: 40, maxResets: 6 },
      });
      return projectResult(await controller.run_());
    }
    const a = await runOnce();
    const b = await runOnce();
    expect(b).toEqual(a);
  });

  it("deep chain: walks a long linear app without false findings", async () => {
    const depth = 10;
    const screens: Record<string, FakeScreen> = {};
    const transitions: FakeTransitionRule[] = [];
    for (let i = 0; i < depth; i++) {
      screens[`s${i}`] = {
        elements: [
          {
            tag: "button",
            role: "button",
            id: i + 1 < depth ? "next" : "end",
          },
        ],
        storage: { step: String(i) },
      };
    }
    for (let i = 0; i < depth - 1; i++) {
      transitions.push({
        from: `s${i}`,
        kind: "click",
        selector: "#next",
        to: `s${i + 1}`,
      });
    }
    const spec: FakeAppSpec = { initial: "s0", screens, transitions };
    const { controller } = makeHarness({
      spec,
      findingEngine: new FindingEngine(),
      driverFactory: () => new FakeReplayDriver(() => spec),
      config: { seed: 4, maxActions: 30, maxResets: 3 },
    });

    const result = await controller.run_();

    expect(result.statesVisited).toBeGreaterThanOrEqual(8);
    expect(result.anomalies.length).toBe(0);
    expect(result.actionsExecuted).toBeLessThanOrEqual(30);
  });

  it("wide action space: budget is respected and the run terminates", async () => {
    const elements: FakeElement[] = [];
    for (let i = 0; i < 24; i++) {
      elements.push({ tag: "button", role: "button", id: `b${i}` });
    }
    const spec: FakeAppSpec = {
      initial: "home",
      screens: { home: { elements } },
    };
    const { controller } = makeHarness({
      spec,
      findingEngine: new FindingEngine(),
      driverFactory: () => new FakeReplayDriver(() => spec),
      config: { seed: 8, maxActions: 30, maxResets: 3 },
    });

    const result = await controller.run_();

    expect(result.actionsExecuted).toBeLessThanOrEqual(30);
    expect(result.anomalies.length).toBe(0);
  });

  it("dead end: a state with no exits cannot loop forever", async () => {
    const spec: FakeAppSpec = {
      initial: "home",
      screens: {
        home: { elements: [{ tag: "button", role: "button", id: "only" }] },
        pit: { elements: [] },
      },
      transitions: [
        { from: "home", kind: "click", selector: "#only", to: "pit" },
      ],
    };
    const { controller } = makeHarness({
      spec,
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 6, maxActions: 25, maxResets: 3, noveltyPlateauLimit: 8 },
    });

    const result = await controller.run_();

    expect(result.actionsExecuted).toBeLessThanOrEqual(25);
    expect(result.resets).toBeLessThanOrEqual(3);
    expect(result.anomalies.length).toBe(0);
  });

  it("duplicate-looking states: storage-differentiated screens stay distinct", async () => {
    const advance = { tag: "button", role: "button", id: "advance" };
    const spec: FakeAppSpec = {
      initial: "home",
      screens: {
        home: { elements: [advance], storage: { progress: "0" } },
        s1: { elements: [{ ...advance }], storage: { progress: "1" } },
        s2: { elements: [{ ...advance }], storage: { progress: "2" } },
      },
      transitions: [
        { from: "home", kind: "click", selector: "#advance", to: "s1" },
        { from: "s1", kind: "click", selector: "#advance", to: "s2" },
      ],
    };
    const { controller } = makeHarness({
      spec,
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 13, maxActions: 20, maxResets: 3 },
    });

    const result = await controller.run_();

    expect(result.statesVisited).toBeGreaterThanOrEqual(3);
  });

  it("hidden actions appearing/disappearing terminate cleanly", async () => {
    const spec: FakeAppSpec = {
      initial: "scrA",
      screens: {
        scrA: {
          elements: [
            { tag: "button", role: "button", id: "swap" },
            { tag: "button", role: "button", id: "ghost" },
          ],
        },
        scrB: {
          elements: [
            { tag: "button", role: "button", id: "swap" },
            { tag: "button", role: "button", id: "ghost", hidden: true },
          ],
        },
      },
      transitions: [
        { from: "scrA", kind: "click", selector: "#swap", to: "scrB" },
        { from: "scrB", kind: "click", selector: "#swap", to: "scrA" },
      ],
    };
    const { controller } = makeHarness({
      spec,
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 15, maxActions: 25, maxResets: 3, noveltyPlateauLimit: 8 },
    });

    const result = await controller.run_();

    expect(result.statesVisited).toBeGreaterThanOrEqual(2);
    expect(result.anomalies.length).toBe(0);
    expect(result.actionsExecuted).toBeLessThanOrEqual(25);
  });

  it("stale selectors degrade to misses, never to defects", async () => {
    const spec: FakeAppSpec = {
      initial: "withV",
      screens: {
        withV: {
          elements: [
            { tag: "button", role: "button", id: "vanish" },
            { tag: "button", role: "button", id: "other" },
          ],
        },
        withoutV: {
          elements: [{ tag: "button", role: "button", id: "other" }],
        },
      },
      transitions: [
        {
          from: "withV",
          kind: "click",
          selector: "#vanish",
          to: "withoutV",
          once: true,
        },
        { from: "withV", kind: "click", selector: "#other" },
        { from: "withoutV", kind: "click", selector: "#other" },
      ],
    };
    const { controller } = makeHarness({
      spec,
      caps: defaultCaps({ act: ["click"] }),
      config: { seed: 17, maxActions: 25, maxResets: 3, noveltyPlateauLimit: 8 },
    });

    const result = await controller.run_();

    expect(result.anomalies.length).toBe(0);
    expect(result.findings.length).toBe(0);
    expect(result.actionsExecuted).toBeLessThanOrEqual(25);
  });

  it("delayed/transient UI completes within the wall budget", async () => {
    const { controller } = makeHarness({
      spec: cycleApp({ actionDelayMs: 5 }),
      findingEngine: new FindingEngine(),
      driverFactory: () => new FakeReplayDriver(cycleApp),
      config: { seed: 19, maxActions: 25, maxResets: 3, maxWallMs: 20000 },
    });

    const result = await controller.run_();

    expect(result.actionsExecuted).toBeLessThanOrEqual(25);
    expect(result.anomalies.length).toBe(0);
  });

  it("navigation loops terminate via plateau/reset machinery", async () => {
    const spec: FakeAppSpec = {
      initial: "home",
      screens: {
        home: { elements: [{ tag: "button", role: "button", id: "home" }] },
      },
      transitions: [
        { from: "home", kind: "click", selector: "#home" },
      ],
    };
    const { controller } = makeHarness({
      spec,
      config: { seed: 23, maxActions: 30, maxResets: 3, noveltyPlateauLimit: 6 },
    });

    const result = await controller.run_();

    expect(result.actionsExecuted).toBeLessThanOrEqual(30);
    expect(result.resets).toBeLessThanOrEqual(3);
    expect(result.anomalies.length).toBe(0);
  });

  it("positive control: buggy app yields CONFIRMED findings with oracle evidence", async () => {
    const { controller } = makeHarness({
      spec: twoCrashApp(),
      findingEngine: new FindingEngine(),
      driverFactory: () => new FakeReplayDriver(twoCrashApp),
      config: {
        seed: 7,
        maxActions: 30,
        maxResets: 6,
        reproducibleAttempts: 2,
        reproducibleMinSuccesses: 1,
      },
    });

    const result = await controller.run_();

    expect(result.anomalies.length).toBe(2);
    expect(result.findings.length).toBe(2);
    for (const f of result.findings) {
      expect(f.status).toBe("CONFIRMED");
      expect(f.minimization?.verifiedReproduction).toBe(true);
    }
    expect(result.evidenceBundles.length).toBe(result.findings.length);
    for (const bundle of result.evidenceBundles) {
      expect(bundle.oracleEvidence.length).toBeGreaterThan(0);
      expect(bundle.oracleEvidence[0]?.kind).toBe("PAGE_ERROR");
    }
    expect(result.regressionScenarios.length).toBe(result.findings.length);
    for (const scenario of result.regressionScenarios) {
      expect(scenario.adapter).toBe("fake-web");
      expect(scenario.expectOracle).toBe("PAGE_ERROR");
    }
  });
});
