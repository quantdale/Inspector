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
  RegressionScenario,
} from "@inspector/finding";
import type { Store, FindingRecord } from "@inspector/store-sqlite";
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
import { DEFAULT_SEQUENCE_LENGTHS } from "./inputs.js";

export interface ExploreConfig {
  seed: number;
  maxActions: number;
  maxWallMs?: number;
  maxResets?: number;
  maxFindings?: number;
  enableFaultInjection?: boolean;
  disposable?: boolean;
  plateauWindow?: number;
  noveltyPlateauLimit?: number;
  /** Consecutive observe() failures tolerated before the run stops (default 3). */
  observeFailureLimit?: number;
  sequenceLengths?: number[];
  reproducibleAttempts?: number;
  reproducibleMinSuccesses?: number;
  weights?: Partial<ScoringWeights>;
  skipReproduction?: boolean;
  observeFields?: string[];
}

/**
 * Honest per-anomaly record of what the reproduction pipeline decided.
 * `confirmed-unverified-minimization` means the reproduction policy confirmed
 * the finding but minimize() could not verify its own baseline.
 */
export type FindingOutcomeKind =
  | "confirmed"
  | "confirmed-unverified-minimization"
  | "rejected"
  | "flaky"
  | "error"
  | "skipped-finding-cap";

export interface FindingOutcome {
  anomalyKey: string;
  classKey: string;
  outcome: FindingOutcomeKind;
  detail?: string;
  findingId?: string;
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
  regressionScenarios: RegressionScenario[];
  findingOutcomes: FindingOutcome[];
  warnings: string[];
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
  /** Action keys the policy refused; they never executed and must not retry. */
  private readonly rejectedActionKeys = new Set<string>();
  /** Degradation notices recorded verbatim for the run result. */
  private readonly warnings: string[] = [];
  private actionPath: Action[] = [];
  private recentActionKeys: string[] = [];
  private actionsExecuted = 0;
  private actionsSinceNewState = 0;
  private resets = 0;
  private consecutiveObserveFailures = 0;
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
    this.sequenceLengths = deps.config.sequenceLengths ?? DEFAULT_SEQUENCE_LENGTHS;
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

  private get observeFailureLimit(): number {
    return this.config.observeFailureLimit ?? 3;
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
    const actionKindSequence: string[] = [];
    // The initial observe is guarded: a broken observer must stop the run
    // with an explicit reason, not crash it.
    const first = await this.observeSafe();
    if (!first) {
      return this.finish(actionKindSequence, "initial-observe-failed");
    }
    this.lastObs = first;
    this.currentState = stateFingerprint(first);
    this.currentScreen = screenFingerprint(first);
    this.graph.visitState(this.currentState, this.currentScreen, 0);

    let obs = this.lastObs!;
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
        if (this.canReset()) {
          if (!(await this.doReset())) {
            return this.finish(actionKindSequence, "reset-failed");
          }
          continue;
        }
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (executed.stopReason) {
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (this.consecutiveObserveFailures >= this.observeFailureLimit) {
        // The observer is persistently broken: continuing would make every
        // action look novel forever. Stop with an explicit reason.
        return this.finish(actionKindSequence, "observer-degraded");
      }
      if (
        this.config.maxFindings &&
        this.anomalies.length >= this.config.maxFindings
      ) {
        // The cap can be reached mid-step; stop immediately instead of
        // mislabeling the run as budget-exhausted.
        return this.finish(actionKindSequence, "finding-cap");
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
    // Actions that previously killed the environment or were policy-rejected
    // are excluded. An all-filtered pool is a dead end: deliberately
    // re-executing a known-bad action would only burn budget.
    const usable = candidates.filter((c) => !this.isBlocked(c.actionKey));
    if (usable.length === 0) return null;
    const ctx = {
      graph: this.graph,
      currentState: this.currentState,
      currentScreen: this.currentScreen,
      recentActionKeys: this.recentActionKeys,
      totalActions: this.actionsExecuted,
      weights: this.config.weights,
    };
    const scored = usable.map((c) => ({ c, s: scoreAction(c, ctx) }));
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

  /**
   * A key is blocked when it was blacklisted as toxic (directly or via its
   * sequence family) or when the policy already rejected it.
   */
  private isBlocked(actionKey: string): boolean {
    if (this.toxicActionKeys.has(actionKey)) return true;
    if (this.rejectedActionKeys.has(actionKey)) return true;
    const base = baseActionKey(actionKey);
    return base !== actionKey && this.toxicActionKeys.has(base);
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
      // Budget attribution: a multi-repeat sequence must never overshoot the
      // remaining action budget.
      const remaining =
        this.config.maxActions - this.actionsExecuted - kinds.length;
      if (remaining <= 0) {
        stopReason = "action-budget";
        break;
      }
      if (
        this.config.maxWallMs &&
        Date.now() - this.startMs > this.config.maxWallMs
      ) {
        stopReason = "wall-budget";
        break;
      }

      const action = this.makeAction({ ...chosen, id: `c_${newId("act")}` });
      const before = this.lastObs!;
      const submit: SubmitResult = await this.run.submitAction(action);

      if (submit.kind === "rejected") {
        // A policy-rejected action never executed: it must not pollute the
        // counters, the recency window, or any anomaly's reproducer path.
        this.rejectedActionKeys.add(chosen.actionKey);
        break;
      }
      if (submit.kind === "duplicate") {
        // Unresolved durable state for this action id: never blindly resend.
        // Explore mints fresh ids, so this is defensive; skip the submission
        // and let the next selection pass proceed from the latest observation.
        this.warnings.push(
          `duplicate submission for ${action.id}; outcome unresolved, skipping`,
        );
        break;
      }

      // The action executed; only now does it enter the evidence path.
      kinds.push(chosen.kind);
      this.recentActionKeys.push(chosen.actionKey);
      if (this.recentActionKeys.length > this.plateauWindow)
        this.recentActionKeys.shift();
      this.actionPath.push(action);

      if (submit.kind === "adapter-error") {
        // The environment was lost or the deadline raced. Blacklist this
        // hazard (including its sequence variants) for the rest of the run
        // and let the caller reset instead of silently retrying an action
        // with an unknown outcome.
        this.toxicActionKeys.add(chosen.actionKey);
        const base = baseActionKey(chosen.actionKey);
        if (base !== chosen.actionKey) this.toxicActionKeys.add(base);
        crashed = true;
        stopReason = "adapter-error";
        break;
      }

      const outcome: ActionOutcome | null = submit.outcome;
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
    } catch (e) {
      // The environment is too broken to restore; the caller must stop. The
      // error is recorded verbatim instead of being swallowed.
      this.warnings.push(`reset failed: ${errorMessage(e)}`);
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
      const obs = await this.observe();
      this.consecutiveObserveFailures = 0;
      return obs;
    } catch (e) {
      this.consecutiveObserveFailures += 1;
      this.warnings.push(
        `observe failed (${this.consecutiveObserveFailures}/${this.observeFailureLimit}): ${errorMessage(e)}`,
      );
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
      regressionScenarios: [],
      findingOutcomes: [],
      warnings: [],
      actionKindSequence,
      stoppedReason,
    };

    if (
      this.config.skipReproduction ||
      !this.findingEngine ||
      !this.replayDriverFactory
    ) {
      base.warnings = this.warnings.slice();
      return base;
    }

    const cap = this.config.maxFindings;

    for (const a of this.anomalies) {
      // Defensive cap: exploration normally stops at the cap already, but
      // finish() must never emit more confirmed findings than allowed.
      if (cap !== undefined && base.findings.length >= cap) {
        base.findingOutcomes.push({
          anomalyKey: a.key,
          classKey: a.classKey,
          outcome: "skipped-finding-cap",
        });
        continue;
      }
      try {
        await this.processAnomaly(a, base);
      } catch (e) {
        // One broken reproduction (driver factory, replay, persist) must not
        // destroy the remaining anomalies: record and continue.
        const detail = errorMessage(e);
        this.warnings.push(`reproduction failed for ${a.classKey}: ${detail}`);
        base.findingOutcomes.push({
          anomalyKey: a.key,
          classKey: a.classKey,
          outcome: "error",
          detail,
        });
      }
    }

    if (
      stoppedReason === "finding-cap" &&
      cap !== undefined &&
      base.findings.length < cap
    ) {
      this.warnings.push(
        `finding-cap shortfall: ${base.findings.length} of ${cap} requested findings confirmed`,
      );
    }

    base.warnings = this.warnings.slice();
    return base;
  }

  /**
   * Reproduce, minimize, and export one anomaly. Throws propagate to the
   * caller's per-anomaly containment; every durable state change is persisted
   * incrementally through the injected store as soon as it exists.
   */
  private async processAnomaly(a: DiscoveredAnomaly, base: ExploreResult): Promise<void> {
    const engine = this.findingEngine!;
    const driver = this.replayDriverFactory!();
    const signal: OracleSignal = {
      kind: a.kind as OracleSignalKind,
      detail: a.message,
    };
    const finding = engine.ingest(signal, {
      runId: this.run.runId,
      title: a.message,
      adapter: this.caps.adapter,
    });
    this.persistFinding(finding);

    const rep = await engine.reproduce(finding, a.actionPath, driver, {
      attempts: this.config.reproducibleAttempts ?? 2,
      minSuccesses: this.config.reproducibleMinSuccesses ?? 1,
    });
    this.persistFinding(rep.finding);

    // Bundle evidence carries the real replay signals plus the ingest signal
    // (deduplicated), and the artifact refs captured by the discovering step.
    const signals = mergeSignals(rep.lastSignals, [signal]);
    const artifactRefs = a.outcome?.artifactRefs ?? [];
    const record = (outcome: FindingOutcomeKind, detail?: string) => {
      const entry: FindingOutcome = {
        anomalyKey: a.key,
        classKey: a.classKey,
        outcome,
        findingId: finding.id,
      };
      if (detail !== undefined) entry.detail = detail;
      base.findingOutcomes.push(entry);
    };

    if (rep.finding.status === "REJECTED") {
      record(
        "rejected",
        rep.stats.lastError ??
          `reproduction policy not satisfied (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`,
      );
      return;
    }
    if (rep.finding.status === "FLAKY") {
      record(
        "flaky",
        `reproduction flaky (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`,
      );
      return;
    }

    const minimized = await engine.minimize(rep.finding, a.actionPath, driver);
    this.persistFinding(rep.finding);

    let confirmed = rep.finding;
    if (rep.finding.status === "MINIMIZED") {
      if (rep.finding.minimization?.verifiedReproduction === true) {
        // Minimization re-verified reproduction under its own probes, so the
        // finding stands confirmed with its minimized reproducer (MINIMIZED ->
        // CONFIRMED is an explicit, allowed transition).
        confirmed = engine.transition(rep.finding, "CONFIRMED", {
          reason: "minimization verified reproduction",
        });
        this.persistFinding(confirmed);
        record("confirmed");
      } else {
        // A minimized-but-unverified finding must never be promoted.
        confirmed = engine.transition(rep.finding, "REJECTED", {
          reason: "minimization did not verify reproduction",
        });
        this.persistFinding(confirmed);
        record("rejected", "minimization did not verify reproduction");
        return;
      }
    } else {
      // Minimization could not verify its own baseline; the finding stays
      // CONFIRMED under the reproduction policy, flagged honestly.
      record(
        "confirmed-unverified-minimization",
        "minimize() baseline verification failed; confirmed by reproduction policy only",
      );
    }

    const bundle = engine.buildBundle(confirmed, a.actionPath, minimized, {
      signals,
      artifactRefs,
      replayCommand: `inspector replay --finding ${confirmed.id}`,
    });
    base.findings.push(confirmed);
    base.evidenceBundles.push(bundle);

    base.regressionScenarios.push(
      engine.exportRegression(confirmed, minimized, signal.kind, {
        adapter: this.caps.adapter,
      }),
    );
  }

  /** Incremental honest persistence of a finding through the injected store. */
  private persistFinding(f: Finding): void {
    if (!this.store) return;
    const record: FindingRecord = {
      id: f.id,
      runId: f.runId,
      status: f.status,
      title: f.title,
      confidence: f.confidence,
      severity: f.severity,
      revision: f.revision,
      oracleIds: JSON.stringify(f.oracleIds),
      reproductionJson: f.reproduction ? JSON.stringify(f.reproduction) : null,
      artifactRefs: JSON.stringify(f.artifactRefs),
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      signature: f.signature ?? null,
      minimizationJson: f.minimization ? JSON.stringify(f.minimization) : null,
      lastTransitionJson: f.lastTransition
        ? JSON.stringify(f.lastTransition)
        : null,
      adapter: f.adapter ?? null,
    };
    try {
      this.store.putFinding(record);
    } catch (e) {
      this.warnings.push(`putFinding failed for ${f.id}: ${errorMessage(e)}`);
    }
  }
}

/** A sequence variant (`seq:<base>:<n>`) collapses onto its base hazard key. */
function baseActionKey(actionKey: string): string {
  const m = /^seq:(.*):\d+$/.exec(actionKey);
  return m ? m[1]! : actionKey;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function signalKey(s: OracleSignal): string {
  const detail =
    typeof s.detail === "string" ? s.detail : (JSON.stringify(s.detail) ?? "");
  return `${s.kind}|${detail}`;
}

/** Merge replay evidence with the ingest signal, deduplicating exact repeats. */
function mergeSignals(
  primary: OracleSignal[],
  extra: OracleSignal[],
): OracleSignal[] {
  const seen = new Set<string>();
  const out: OracleSignal[] = [];
  for (const s of [...primary, ...extra]) {
    const k = signalKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
