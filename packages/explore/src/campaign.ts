import {
  newId,
  type Action,
  type ActionOutcome,
  type Observation,
  type CapabilityDoc,
} from "@inspector/protocol";
import type { RunController, SubmitResult } from "@inspector/core";
import type {
  FindingEngine,
  ReplayDriver,
  Finding,
  EvidenceBundle,
  OracleSignal,
  OracleSignalKind,
  FindingStatus,
} from "@inspector/finding";
import type { Store } from "@inspector/store-sqlite";
import {
  StateGraph,
  stateFingerprint,
  screenFingerprint,
  uiTreeOf,
} from "./state.js";
import { buildInventory, type CandidateAction } from "./inventory.js";
import { scoreAction, type ScoringWeights } from "./scoring.js";
import {
  DefaultAnomalyDetector,
  type AnomalyDetector,
  type DiscoveredAnomaly,
} from "./anomaly.js";
import { mulberry32, type Rng } from "./rng.js";
import { FaultController } from "./faults.js";
import { NoopPlanner, type Planner, type PlannerContext } from "./planner.js";

export interface ExploreConfig {
  seed: number;
  maxActions: number;
  maxWallMs?: number;
  maxResets?: number;
  maxFindings?: number;
  enableFaultInjection?: boolean;
  disposable?: boolean;
  modelBudget?: number;
  plateauWindow?: number;
  noveltyPlateauLimit?: number;
  sequenceLengths?: number[];
  reproducibleAttempts?: number;
  reproducibleMinSuccesses?: number;
  weights?: Partial<ScoringWeights>;
  skipReproduction?: boolean;
  observeFields?: string[];
}

export interface ExploreResult {
  runId: string;
  seed: number;
  actionsExecuted: number;
  statesVisited: number;
  transitions: number;
  resets: number;
  anomalies: DiscoveredAnomaly[];
  findings: Finding[];
  evidenceBundles: EvidenceBundle[];
  actionKindSequence: string[];
  stoppedReason: string;
}

export interface ExploreDeps {
  run: RunController;
  store?: Store;
  findingEngine?: FindingEngine;
  replayDriverFactory?: () => ReplayDriver;
  config: ExploreConfig;
  caps?: CapabilityDoc;
}

const DEFAULT_OBSERVE = ["url", "uiTree", "storage", "pageErrors", "title"];

export class ExploreController {
  private readonly rng: Rng;
  private readonly graph = new StateGraph();
  private readonly config: ExploreConfig;
  private readonly run: RunController;
  private readonly caps: CapabilityDoc;
  private readonly faults: FaultController;
  private readonly detector: AnomalyDetector;
  private readonly planner: Planner;
  private readonly sequenceLengths: number[];

  private readonly anomalies: DiscoveredAnomaly[] = [];
  private readonly anomalyClassKeys = new Set<string>();
  /** Action keys whose execution lost the environment (deadline/crash). */
  private readonly toxicActionKeys = new Set<string>();
  private actionPath: Action[] = [];
  private recentActionKeys: string[] = [];
  private actionsExecuted = 0;
  private actionsSinceNewState = 0;
  private resets = 0;
  private startMs = 0;
  private lastObs: Observation | null = null;
  private currentState = "";
  private currentScreen = "";

  private findingEngine?: FindingEngine;
  private replayDriverFactory?: () => ReplayDriver;
  private store?: Store;

  constructor(deps: ExploreDeps) {
    this.run = deps.run;
    this.config = deps.config;
    this.caps = deps.caps ?? deps.run.caps;
    this.rng = mulberry32(deps.config.seed >>> 0);
    this.faults = new FaultController(this.caps, {
      enableFaultInjection: !!deps.config.enableFaultInjection,
      disposable: deps.config.disposable ?? false,
    });
    this.detector = new DefaultAnomalyDetector();
    this.planner = new NoopPlanner();
    this.sequenceLengths = deps.config.sequenceLengths ?? [2, 3, 5, 8, 12];
    this.findingEngine = deps.findingEngine;
    this.replayDriverFactory = deps.replayDriverFactory;
    this.store = deps.store;
  }

  private get plateauWindow(): number {
    return this.config.plateauWindow ?? 12;
  }

  private get noveltyPlateauLimit(): number {
    return this.config.noveltyPlateauLimit ?? 40;
  }

  private makeAction(c: CandidateAction): Action {
    const isFault = c.kind === "fault";
    const input: Record<string, unknown> = isFault
      ? { fault: c.fault }
      : c.selector
        ? { selector: c.selector, value: c.value }
        : c.value === undefined
          ? {}
          : { value: c.value };
    return {
      id: newId("act"),
      runId: this.run.runId,
      environmentId: this.run.environmentId,
      kind: c.kind,
      risk: c.risk,
      deadlineMs: 6000,
      idempotency:
        c.risk === "mutate-test-state" ? "never-retry" : "observe-before-retry",
      target: c.selector ? { selector: c.selector } : null,
      input,
      metadata: {
        actionKey: c.actionKey,
        sourceElementId: c.sourceElementId ?? null,
        isBoundary: !!c.isBoundary,
      },
    };
  }

  async run_(): Promise<ExploreResult> {
    this.startMs = Date.now();
    return this.loop();
  }

  private async loop(): Promise<ExploreResult> {
    let obs = await this.observe();
    this.lastObs = obs;
    this.currentState = stateFingerprint(obs);
    this.currentScreen = screenFingerprint(obs);
    this.graph.visitState(this.currentState, this.currentScreen, 0);

    const actionKindSequence: string[] = [];

    while (this.actionsExecuted < this.config.maxActions) {
      if (
        this.config.maxWallMs &&
        Date.now() - this.startMs > this.config.maxWallMs
      ) {
        return this.finish(actionKindSequence, "wall-budget");
      }
      if (
        this.config.maxFindings &&
        this.anomalies.length >= this.config.maxFindings
      ) {
        return this.finish(actionKindSequence, "finding-cap");
      }

      const uiTree = uiTreeOf(obs);
      const inventory = buildInventory(uiTree, this.caps, {
        allowFaults: this.faults.allowed,
      });
      const candidates = this.expandCandidates(inventory);
      const chosen = this.select(candidates);

      if (!chosen) {
        if (this.canReset() && (await this.doReset())) {
          obs = this.lastObs!;
          continue;
        }
        return this.finish(actionKindSequence, "no-candidates");
      }

      const executed = await this.step(chosen);
      this.actionsExecuted += executed.count;
      for (const k of executed.kinds) actionKindSequence.push(k);
      obs = this.lastObs!;

      if (executed.stopReason === "adapter-error") {
        // One lost environment must not end the campaign: restore the baseline
        // and continue (the hazard that caused it is now blacklisted).
        if (this.canReset() && (await this.doReset())) {
          obs = this.lastObs!;
          continue;
        }
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (executed.stopReason) {
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (executed.crashed && this.canReset()) {
        if (!(await this.doReset())) {
          return this.finish(actionKindSequence, "reset-failed");
        }
        obs = this.lastObs!;
        continue;
      }
      if (
        this.actionsSinceNewState > this.noveltyPlateauLimit &&
        this.canReset()
      ) {
        if (!(await this.doReset())) {
          return this.finish(actionKindSequence, "reset-failed");
        }
        obs = this.lastObs!;
        this.actionsSinceNewState = 0;
      }
    }

    return this.finish(actionKindSequence, "action-budget");
  }

  private expandCandidates(inventory: CandidateAction[]): CandidateAction[] {
    const out = inventory.slice();
    const clickables = inventory.filter(
      (c) => c.kind === "click" && c.sourceElementId,
    );
    for (const b of clickables) {
      for (const len of this.sequenceLengths) {
        out.push({
          ...b,
          id: `${b.id}_seq${len}`,
          actionKey: `seq:${b.actionKey}:${len}`,
          repeat: len,
          priority: (b.priority ?? 5) + 1,
        });
      }
    }
    return out;
  }

  private select(candidates: CandidateAction[]): CandidateAction | null {
    if (candidates.length === 0) return null;
    // Actions that previously killed the environment are excluded unless
    // nothing else remains, so a reset cannot loop on the same hazard.
    const usable = candidates.filter(
      (c) => !this.toxicActionKeys.has(c.actionKey),
    );
    const pool = usable.length > 0 ? usable : candidates;
    const ctx = {
      graph: this.graph,
      currentState: this.currentState,
      currentScreen: this.currentScreen,
      recentActionKeys: this.recentActionKeys,
      totalActions: this.actionsExecuted,
      weights: this.config.weights,
    };
    const scored = pool.map((c) => ({ c, s: scoreAction(c, ctx) }));
    let best = -Infinity;
    for (const x of scored) if (x.s > best) best = x.s;
    const top = scored.filter((x) => x.s >= best - 1e-9).map((x) => x.c);
    // Planner fallback: if deterministic selection stalls, ask the planner for
    // a goal, but it can only return a legal inventory member.
    if (
      top.length === 0 ||
      (top.length === 1 &&
        this.recentActionKeys.filter((k) => k === top[0]!.actionKey).length >=
          3)
    ) {
      const planned = this.planner.propose(this.plannerCtx());
      if (planned) return planned;
    }
    return this.rng.pick(top);
  }

  private plannerCtx(): PlannerContext {
    return {
      screen: this.currentScreen,
      uiTree: this.lastObs ? uiTreeOf(this.lastObs) : [],
      recentActionKeys: this.recentActionKeys,
      discoveredKinds: this.anomalies.map((a) => a.kind),
    };
  }

  private async step(chosen: CandidateAction): Promise<{
    count: number;
    kinds: string[];
    crashed: boolean;
    stopReason?: string;
  }> {
    const repeats = chosen.repeat ?? 1;
    const kinds: string[] = [];
    let crashed = false;
    let stopReason: string | undefined;

    for (let i = 0; i < repeats; i++) {
      const action = this.makeAction({ ...chosen, id: `c_${newId("act")}` });
      const before = this.lastObs!;
      const submit: SubmitResult = await this.run.submitAction(action);
      kinds.push(chosen.kind);
      this.recentActionKeys.push(chosen.actionKey);
      if (this.recentActionKeys.length > this.plateauWindow)
        this.recentActionKeys.shift();
      this.actionPath.push(action);

      if (submit.kind === "rejected") {
        break;
      }
      if (submit.kind === "adapter-error") {
        // The environment was lost or the deadline raced. Blacklist this
        // action for the rest of the run and let the caller reset instead of
        // silently retrying an action with an unknown outcome.
        this.toxicActionKeys.add(chosen.actionKey);
        crashed = true;
        stopReason = "adapter-error";
        break;
      }

      const outcome: ActionOutcome | null =
        submit.kind === "outcome" ? submit.outcome : null;
      const after = await this.observeSafe();

      // Detect anomalies against the pre-action state before the graph is
      // advanced, so the recorded reproducer segment matches what happened.
      const stateBefore = this.currentState;
      const anomaly = this.detector.detect({
        action,
        outcome,
        before,
        after,
        actionPath: this.actionPath,
        stateBefore,
      });
      if (anomaly && !this.anomalyClassKeys.has(anomaly.classKey)) {
        this.anomalyClassKeys.add(anomaly.classKey);
        this.anomalies.push(anomaly);
      }

      let isNew = false;
      if (after) {
        const sa = stateFingerprint(after);
        const sc = screenFingerprint(after);
        isNew = this.graph.visitState(sa, sc, this.actionsExecuted);
        this.graph.recordEdge(
          stateBefore,
          chosen.actionKey,
          sa,
          this.actionsExecuted,
        );
        this.currentState = sa;
        this.currentScreen = sc;
        this.lastObs = after;
      } else {
        this.lastObs = before;
      }
      if (isNew) this.actionsSinceNewState = 0;
      else this.actionsSinceNewState += 1;

      if (
        outcome?.status === "target-failure" &&
        outcome.error?.code === "TARGET_FAILURE"
      ) {
        crashed = true;
        break;
      }
      if (outcome && outcome.status !== "success") {
        // Automation miss or unknown outcome: repeating the same action blindly
        // would just burn budget against a stale target state.
        break;
      }
    }

    return { count: kinds.length, kinds, crashed, stopReason };
  }

  private actionsExecutedLocal(): void {
    // removed: the caller counts executions via step().count
  }

  private canReset(): boolean {
    if (!this.config.maxResets) return false;
    return this.resets < this.config.maxResets;
  }

  private async doReset(): Promise<boolean> {
    this.resets += 1;
    try {
      await this.run.reset();
    } catch {
      // The environment is too broken to restore; the caller must stop.
      return false;
    }
    // The environment was restored to its baseline (login screen). Truncate the
    // cumulative action path so each discovered anomaly's reproducer is a clean
    // segment from baseline, rather than re-triggering an earlier crash.
    this.actionPath = [];
    const obs = await this.observeSafe();
    if (!obs) return false;
    this.lastObs = obs;
    this.currentState = stateFingerprint(obs);
    this.currentScreen = screenFingerprint(obs);
    this.graph.visitState(
      this.currentState,
      this.currentScreen,
      this.actionsExecuted,
    );
    this.recentActionKeys = [];
    this.actionsSinceNewState = 0;
    return true;
  }

  private async observe(): Promise<Observation> {
    const fields = this.config.observeFields ?? DEFAULT_OBSERVE;
    return this.run.observe(fields);
  }

  private async observeSafe(): Promise<Observation | null> {
    try {
      return await this.observe();
    } catch {
      return null;
    }
  }

  private async finish(
    actionKindSequence: string[],
    stoppedReason: string,
  ): Promise<ExploreResult> {
    const base: ExploreResult = {
      runId: this.run.runId,
      seed: this.config.seed,
      actionsExecuted: this.actionsExecuted,
      statesVisited: this.graph.stateCount,
      transitions: this.graph.edges.size,
      resets: this.resets,
      anomalies: this.anomalies.slice(),
      findings: [],
      evidenceBundles: [],
      actionKindSequence,
      stoppedReason,
    };

    if (
      this.config.skipReproduction ||
      !this.findingEngine ||
      !this.replayDriverFactory
    ) {
      return base;
    }

    for (const a of this.anomalies) {
      const driver = this.replayDriverFactory();
      const signal: OracleSignal = {
        kind: a.kind as OracleSignalKind,
        detail: a.message,
      };
      const finding = this.findingEngine.ingest(signal, {
        runId: this.run.runId,
        title: a.message,
      });
      const rep = await this.findingEngine.reproduce(
        finding,
        a.actionPath,
        driver,
        {
          attempts: this.config.reproducibleAttempts ?? 2,
          minSuccesses: this.config.reproducibleMinSuccesses ?? 1,
        },
      );
      if (rep.finding.status === "CONFIRMED") {
        const minimized = await this.findingEngine.minimize(
          rep.finding,
          a.actionPath,
          driver,
        );
        // Minimization re-verified reproduction, so the finding stands
        // confirmed with its minimized reproducer (MINIMIZED -> CONFIRMED is
        // an explicit, allowed transition).
        const confirmed =
          (rep.finding.status as FindingStatus) === "MINIMIZED"
            ? this.findingEngine.transition(rep.finding, "CONFIRMED")
            : rep.finding;
        const bundle = this.findingEngine.buildBundle(
          confirmed,
          a.actionPath,
          minimized,
          {
            replayCommand: `inspector replay --finding ${confirmed.id}`,
          },
        );
        base.findings.push(confirmed);
        base.evidenceBundles.push(bundle);
      }
    }

    return base;
  }
}
