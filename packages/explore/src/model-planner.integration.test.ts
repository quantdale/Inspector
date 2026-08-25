import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityDoc, Observation, Action, ActionOutcome } from "@inspector/protocol";
import { newId } from "@inspector/protocol";
import type { RunController, SubmitResult } from "@inspector/core";
import { ModelRuntime, ScriptedModelProvider, jsonOutcome, malformedJsonOutcome } from "@inspector/model-runtime";
import { Store } from "@inspector/store-sqlite";
import { ExploreController } from "./campaign.js";
import { EXPLORER_VERSION } from "./checkpoint.js";

/* Deterministic browserless fake app (same boundary style as
   explore.hardening.test.ts): a hub with three explored leaves plus an
   underexplored `#secret` path leading to a vault whose `#detonate` button
   crashes the target — the seeded anomaly the semantic planner should reach
   deliberately. */

type Screen = { url: string; elements: Array<Record<string, unknown>> };

const SCREENS: Record<string, Screen> = {
  hub: {
    url: "fake://hub",
    elements: [
      { tag: "button", role: "button", id: "a1", hidden: false },
      { tag: "button", role: "button", id: "b1", hidden: false },
      { tag: "button", role: "button", id: "c1", hidden: false },
      { tag: "button", role: "button", id: "secret", hidden: false },
    ],
  },
  leafA: { url: "fake://leafA", elements: [{ tag: "button", role: "button", id: "back", hidden: false }] },
  leafB: { url: "fake://leafB", elements: [{ tag: "button", role: "button", id: "back", hidden: false }] },
  leafC: { url: "fake://leafC", elements: [{ tag: "button", role: "button", id: "back", hidden: false }] },
  vault: {
    url: "fake://vault",
    elements: [
      { tag: "button", role: "button", id: "detonate", hidden: false },
      { tag: "button", role: "button", id: "back", hidden: false },
    ],
  },
};

const TRANSITIONS: Array<{ from: string; selector?: string; to?: string; crash?: boolean }> = [
  { from: "hub", selector: "#a1", to: "leafA" },
  { from: "hub", selector: "#b1", to: "leafB" },
  { from: "hub", selector: "#c1", to: "leafC" },
  { from: "hub", selector: "#secret", to: "vault" },
  { from: "vault", selector: "#back", to: "hub" },
  { from: "vault", selector: "#detonate", crash: true },
  { from: "leafA", selector: "#back", to: "hub" },
  { from: "leafB", selector: "#back", to: "hub" },
  { from: "leafC", selector: "#back", to: "hub" },
];

class FakeEnv {
  current = "hub";
  observes = 0;
  readonly clickedSelectors: string[] = [];
  /** When set, the next planner-suggested action kills the controller hard. */
  crashOnPlannerAction = false;

  constructor(private readonly store: Store | null, private readonly runId: string) {}

  async submitAction(action: Action): Promise<SubmitResult> {
    const selector = String(action.input?.selector ?? "");
    if (this.crashOnPlannerAction && (action.metadata?.exploration as Record<string, unknown> | undefined)?.plannerSuggested === true) {
      // Simulated process death AFTER acceptance, BEFORE execution.
      throw new Error("injected controller death before planner action execution");
    }
    this.clickedSelectors.push(selector);
    const base = { actionId: action.id, runId: this.runId, environmentId: "env-fake", observedAt: new Date().toISOString() };
    const rule = TRANSITIONS.find((t) => t.from === this.current && t.selector === selector);
    if (!rule || rule.to) {
      if (rule?.to) this.current = rule.to;
      const outcome: ActionOutcome = { ...base, status: "success", stateAfter: this.current };
      this.recordCommitted(action);
      return { kind: "outcome", outcome };
    }
    if (rule.crash) {
      const outcome: ActionOutcome = {
        ...base,
        status: "target-failure",
        error: { code: "TARGET_FAILURE", message: "IntentionalCrash:#detonate" },
      };
      this.recordCommitted(action);
      return { kind: "outcome", outcome };
    }
    throw new Error("unreachable transition match");
  }

  private recordCommitted(_action: Action): void {
    // Store persistence is exercised by the real-pipeline suites; this fixture
    // keeps durable-state coverage on the checkpoint stream only.
  }

  async observe(_fields: string[]): Promise<Observation> {
    this.observes += 1;
    const screen = SCREENS[this.current]!;
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: "env-fake",
      sequence: this.observes,
      source: "fake-env",
      capturedAt: new Date().toISOString(),
      summary: { url: screen.url, uiTree: structuredClone(screen.elements), storage: {} },
    };
  }

  async reset(): Promise<void> {
    this.current = "hub";
  }
}

class FakeRunController {
  readonly caps: CapabilityDoc = {
    protocolVersion: "0.1",
    adapter: "fake-web",
    capabilities: {
      observe: ["url", "uiTree", "storage"],
      act: ["click"],
      lifecycle: ["create", "reset", "close"],
      faults: [],
      coverage: [],
    },
  };
  readonly runId: string;
  readonly environmentId = "env-fake";

  constructor(readonly env: FakeEnv, runId: string) {
    this.runId = runId;
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

function config(seed: number) {
  return {
    seed,
    maxActions: 300,
    maxResets: 0,
    maxFindings: 1,
    skipReproduction: true,
    plateauWindow: 10,
    noveltyPlateauLimit: 25,
  };
}

/** Scripted goal-directed provider: reads the DATA BLOCK of the packet it
 * receives and chooses the offered underexplored `secret` action — proving
 * decisions flow from Inspector-supplied structured context, and that only
 * legal inventory keys can come back. */
function secretSeeker(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    id: "fixture-planner",
    roles: ["planner"],
    respond: (spec) => {
      const key = offeredSecretAction(spec.prompt);
      return key
        ? jsonOutcome({ actionKey: key, goal: "underexplored branch", confidence: 0.95 })
        : malformedJsonOutcome();
    },
  });
}

function offeredSecretAction(prompt: string): string | null {
  const dataStart = prompt.indexOf("DATA BLOCK");
  if (dataStart === -1) return null;
  const jsonStart = prompt.indexOf("{", dataStart);
  if (jsonStart === -1) return null;
  try {
    const packet = JSON.parse(prompt.slice(jsonStart)) as {
      candidateActions?: Array<{ actionKey: string }>;
    };
    const match = (packet.candidateActions ?? []).find((c) => c.actionKey.includes("secret"));
    return match?.actionKey ?? null;
  } catch {
    return null;
  }
}

function modelDeps(provider: ScriptedModelProvider, attribution?: Record<string, unknown>) {
  return {
    runtime: new ModelRuntime().register(provider),
    config: {
      minActionsBetweenCalls: 2,
      stallThreshold: 4,
      nearTieCount: 3,
      confidenceThreshold: 0.5,
      maxCalls: 12,
      timeoutMs: 2000,
    },
    ...(attribution !== undefined ? { attribution } : {}),
  };
}

async function runOnce(opts: {
  seed: number;
  provider?: ScriptedModelProvider;
  attribution?: Record<string, unknown>;
}): Promise<{ result: Awaited<ReturnType<ExploreController["run_"]>>; clicked: string[]; providerCalls: number }> {
  const env = new FakeEnv(null, `run-${opts.seed}`);
  const run = new FakeRunController(env, `run-${opts.seed}`);
  const controller = new ExploreController({
    run: run as unknown as RunController,
    config: config(opts.seed),
    ...(opts.provider ? { model: modelDeps(opts.provider, opts.attribution) } : {}),
  });
  const result = await controller.run_();
  return { result, clicked: env.clickedSelectors, providerCalls: opts.provider?.calls.length ?? 0 };
}

describe("M13 F19/F7: model-assisted exploration against the deterministic engine", () => {
  it("deterministic mode is stable and unchanged for a fixed seed (no model configured)", async () => {
    const first = await runOnce({ seed: 20260824 });
    const second = await runOnce({ seed: 20260824 });
    expect(first.result.actionKindSequence).toEqual(second.result.actionKindSequence);
    expect(first.clicked).toEqual(second.clicked);
    expect(first.result.planner).toBeUndefined();
  });

  it("a scripted planner reaches the seeded vault anomaly in FEWER actions than pure determinism", async () => {
    const plain = await runOnce({ seed: 20260824 });
    expect(plain.result.anomalies.length).toBeGreaterThanOrEqual(1); // sanity: reachable

    const guided = await runOnce({ seed: 20260824, provider: secretSeeker() });
    expect(guided.result.planner).toBeDefined();
    expect(guided.result.planner!.accepted).toBeGreaterThan(0);
    expect(guided.result.planner!.calls).toBeLessThanOrEqual(12);
    expect(guided.clicked.indexOf("#secret")).toBeLessThan(plain.clicked.indexOf("#secret"));
    // Every executed action still came from the legal inventory: no fabricated
    // selectors ever appear.
    for (const selector of guided.clicked) {
      expect(["#a1", "#b1", "#c1", "#secret", "#back", "#detonate"]).toContain(selector);
    }
  });

  it("model failures never perturb the deterministic fallback sequence (RNG untouched)", async () => {
    const plain = await runOnce({ seed: 77 });
    const rejecting = new ScriptedModelProvider({
      id: "broken",
      roles: ["planner"],
      respond: malformedJsonOutcome(),
    });
    const failing = await runOnce({ seed: 77, provider: rejecting });
    expect(failing.result.actionKindSequence).toEqual(plain.result.actionKindSequence);
    expect(failing.clicked).toEqual(plain.clicked);
    expect(rejecting.calls.length).toBeGreaterThan(0);
    expect(failing.result.warnings.some((w) => w.includes("planner suggestion rejected"))).toBe(true);
  });

  it("an accepted decision survives a controller death WITHOUT re-calling the provider or duplicating the action", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m13-resume-"));
    const dbPath = join(dir, "runs.db");
    const store = Store.open(dbPath);
    const runId = "run_m13_resume";
    store.createRun({ id: runId });
    store.createExplorationCampaign({
      runId,
      schemaVersion: 1,
      explorerKind: "web",
      explorerVersion: EXPLORER_VERSION,
      adapter: "fake-web",
      config: {},
    });

    const lifeOneProvider = secretSeeker();
    const envOne = new FakeEnv(store, runId);
    envOne.crashOnPlannerAction = true; // die after acceptance, before execution
    const controllerOne = new ExploreController({
      run: new FakeRunController(envOne, runId) as unknown as RunController,
      store,
      config: { ...config(4242), maxActions: 50 },
      model: modelDeps(lifeOneProvider),
    });
    await expect(controllerOne.run_()).rejects.toThrow("injected controller death");

    // Life 2: fresh controller over the SAME durable campaign/checkpoint.
    // The provider is configured to ALWAYS reject: any successful secret
    // navigation therefore came from the durable pending decision, not from
    // a new model call.
    const lifeTwoProvider = new ScriptedModelProvider({
      id: "life-2",
      roles: ["planner"],
      respond: jsonOutcome({ actionKey: "click#nonexistent", confidence: 0.9 }),
    });
    const envTwo = new FakeEnv(store, runId);
    const controllerTwo = new ExploreController({
      run: new FakeRunController(envTwo, runId) as unknown as RunController,
      store,
      config: { ...config(4242), maxActions: 50 },
      resume: true,
      model: modelDeps(lifeTwoProvider),
    });
    const resumed = await controllerTwo.run_();
    expect(resumed.planner?.accepted ?? 0).toBe(0);
    // Life 1 died BEFORE executing the accepted suggestion (zero clicks);
    // life 2 executes it as its very first action from the restored durable
    // decision — no duplicate across lives, no new model acceptance needed.
    expect(envOne.clickedSelectors.filter((s) => s === "#secret").length).toBe(0);
    expect(envTwo.clickedSelectors[0]).toBe("#secret");
    store.close();
  });

  it("risk escalation: a planner-accepted action that POLICY rejects never executes", async () => {
    const env = new FakeEnv(null, "run-policy");
    const run = new FakeRunController(env, "run-policy");
    let secretSuggestedOnce = false;
    const provider = new ScriptedModelProvider({
      id: "fixture-planner",
      roles: ["planner"],
      respond: (spec) => {
        const dataStart = spec.prompt.indexOf("DATA BLOCK");
        const jsonStart = spec.prompt.indexOf("{", dataStart);
        const packet = JSON.parse(spec.prompt.slice(jsonStart)) as {
          candidateActions?: Array<{ actionKey: string }>;
        };
        const secret = (packet.candidateActions ?? []).find((c) => c.actionKey.includes("secret"));
        if (secret && !secretSuggestedOnce) {
          secretSuggestedOnce = true;
          return { text: JSON.stringify({ actionKey: secret.actionKey, confidence: 0.95 }) };
        }
        return { text: "{broken" };
      },
    });
    // Policy layer refuses #secret AFTER the planner accepted it.
    const originalSubmit = run.submitAction.bind(run);
    run.submitAction = async (action: Action) => {
      if (String((action.input as Record<string, unknown> | null)?.selector ?? "") === "#secret") {
        return {
          kind: "rejected",
          decision: { allowed: false, reason: "policy denies #secret for this target" },
        } as never;
      }
      return originalSubmit(action);
    };
    const controller = new ExploreController({
      run: run as unknown as RunController,
      config: { ...config(99), maxActions: 40 },
      model: modelDeps(provider),
    });
    const result = await controller.run_();
    // The planner DID accept the suggestion...
    expect(result.planner?.accepted).toBeGreaterThan(0);
    // ...but the policy rejection won: #secret never executed and the run
    // continued deterministically instead of crashing or retrying blindly.
    expect(env.clickedSelectors).not.toContain("#secret");
    expect(result.stoppedReason).not.toBe("adapter-error");
  }, 120000);
});
