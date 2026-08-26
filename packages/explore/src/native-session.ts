/**
 * SPEC-009 W4: platform-neutral autonomous exploration session.
 *
 * Drives ANY adapter through the standard RunController pipeline (policy →
 * durable steps/actions/observations → oracle/finding engine). There are no
 * platform branches here: candidate generation is dispatched purely by the
 * adapter's declared vocabulary target scheme, and every action flows through
 * submitAction so evidence/oracle/finding semantics are identical to web
 * hunts.
 *
 * Reproduction honesty: when the caller supplies a replayDriverFactory for
 * the platform (web and Android have one today), findings go through the full
 * bounded reproduce→confirm pipeline. When none is available, candidates stay
 * CANDIDATE status and are reported as such — never silently confirmed.
 */
import { newId, type Action, type ActionOutcome } from "@inspector/protocol";
import type { RunController } from "@inspector/core";
import type { ActionRecord, Store } from "@inspector/store-sqlite";
import {
  FindingEngine,
  type EvidenceBundle,
  type Finding,
  type ReplayDriver,
} from "@inspector/finding";
import { mulberry32, restoreRng, type RngSnapshot } from "./rng.js";
import { buildNativeInventory } from "./native-inventory.js";
import type { CandidateAction } from "./inventory.js";
import type { ExplorationControl } from "./control.js";
import { StateGraph, screenFingerprint, stateFingerprint, uiTreeOf } from "./state.js";
import {
  EXPLORER_VERSION,
  configFingerprint,
  loadLatestCheckpoint,
  writeCheckpoint,
  type ExplorationCheckpointPayload,
  type FindingOutcomeSnapshot,
} from "./checkpoint.js";

export interface NativeExplorationConfig {
  seed: number;
  maxActions: number;
  maxWallMs: number;
  maxFindings: number;
  /** Consecutive no-novelty observations before declaring a plateau. */
  noveltyPlateauLimit?: number;
}

export interface NativeHuntResult {
  runId: string;
  seed: number;
  stoppedReason:
    | "action-budget"
    | "wall-budget"
    | "finding-cap"
    | "no-candidates"
    | "coverage-exhausted"
    | "novelty-plateau"
    | "adapter-error"
    /** HARDENING_2: cooperative campaign stop / pre-consumption budget stop. */
    | "cancelled"
    | "budget-exhausted";
  actionsExecuted: number;
  statesVisited: number;
  anomalies: number;
  findings: Finding[];
  evidenceBundles: EvidenceBundle[];
  findingOutcomes: Array<{
    classKey: string;
    outcome: string;
    detail?: string;
    findingId?: string;
  }>;
  warnings: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sinks {
  findings: Finding[];
  bundles: EvidenceBundle[];
  seenClassKeys: Set<string>;
  warnings: string[];
  outcomes: NativeHuntResult["findingOutcomes"];
}

async function processFailure(
  engine: FindingEngine,
  outcome: ActionOutcome,
  path: Action[],
  sinks: Sinks,
  replayDriverFactory?: () => ReplayDriver | Promise<ReplayDriver>,
  adapterId?: string,
  processedFindingClassKeys?: Set<string>,
  store?: Store,
): Promise<void> {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (processedFindingClassKeys?.has(classKey)) return;
  sinks.seenClassKeys.add(classKey);

  const durable = store?.getFindingByClassKey(path[0]?.runId ?? "", classKey);
  let finding = durable
    ? engine.rehydrate(durable)
    : engine.ingest(
        { kind: "TARGET_FAILURE", detail: outcome.error?.detail ?? message },
        {
          runId: path[0]?.runId,
          title: `TARGET_FAILURE: ${message}`,
          // Provenance: findings must name the adapter family they came from.
          adapter: adapterId ?? undefined,
          classKey,
        },
      );

  if (finding.status === "REPRODUCING") {
    finding = engine.transition(finding, "CANDIDATE", {
      reason: "controller restarted during reproduction",
      actor: "exploration-resume",
    });
  }
  if (finding.status === "MINIMIZED" && finding.minimization?.verifiedReproduction === true) {
    finding = engine.transition(finding, "CONFIRMED", {
      reason: "resume completed persisted minimization",
      actor: "exploration-resume",
    });
  }
  if (finding.status === "CONFIRMED" || finding.status === "RESOLVED" || finding.status === "REGRESSED") {
    sinks.findings.push(finding);
    sinks.outcomes.push({ classKey, outcome: "confirmed", findingId: finding.id });
    return;
  }
  if (finding.status === "REJECTED" || finding.status === "FLAKY") {
    sinks.outcomes.push({ classKey, outcome: finding.status.toLowerCase(), findingId: finding.id });
    return;
  }

  if (!replayDriverFactory) {
    // Honest candidate: recorded, visible, NEVER promoted without a replay.
    sinks.outcomes.push({
      classKey,
      outcome: "candidate-no-replay-driver",
      detail: "no platform replay driver registered; finding stays CANDIDATE",
      findingId: finding.id,
    });
    return;
  }

  const rep = await engine
    .reproduce(finding, [...path], await replayDriverFactory(), {
      attempts: 2,
      minSuccesses: 1,
    })
    .catch((e) => {
      sinks.warnings.push(`reproduction failed: ${String(e).slice(0, 140)}`);
      return null;
    });
  if (!rep) {
    sinks.outcomes.push({ classKey, outcome: "error", findingId: finding.id });
    return;
  }
  if (rep.finding.status === "REJECTED" || rep.finding.status === "FLAKY") {
    sinks.outcomes.push({
      classKey,
      outcome: rep.finding.status.toLowerCase(),
      findingId: finding.id,
    });
    return;
  }
  const bundle = engine.buildBundle(rep.finding, [...path], [...path], {
    signals: rep.lastSignals ?? [],
    replayCommand: `inspector replay --finding ${rep.finding.id}`,
  });
  sinks.findings.push(rep.finding);
  sinks.bundles.push(bundle);
  sinks.outcomes.push({ classKey, outcome: "confirmed", findingId: rep.finding.id });
}

export interface NativeSessionDeps {
  run: RunController;
  findingEngine: FindingEngine;
  /** Platform-faithful replay driver factory; may be async (real backends
   * probe). Omit to keep findings at honest CANDIDATE status. */
  replayDriverFactory?: () => ReplayDriver | Promise<ReplayDriver>;
  store?: Store;
  resume?: boolean;
  /** Campaign execution control (HARDENING_2 D1/D3). */
  control?: ExplorationControl;
}

export async function runNativeHunt(
  deps: NativeSessionDeps,
  config: NativeExplorationConfig,
): Promise<NativeHuntResult> {
  const { run, findingEngine, replayDriverFactory, control } = deps;
  const caps = run.caps;
  const campaign = deps.store?.getExplorationCampaign(run.runId);
  const budget = {
    maxActions: config.maxActions,
    maxResets: 0,
    maxFindings: config.maxFindings,
    maxWallMs: config.maxWallMs,
  };
  const restored = deps.resume
    ? (() => {
        if (!deps.store || !campaign) {
          throw new Error(
            `run ${run.runId} has no durable native exploration campaign; use 'runs resume' only for environment reattachment`,
          );
        }
        return loadLatestCheckpoint(deps.store, {
          runId: run.runId,
          explorerKind: "native",
          explorerVersion: EXPLORER_VERSION,
          adapter: caps.adapter,
          seed: config.seed >>> 0,
          configFingerprint: configFingerprint(config),
        }, budget);
      })()
    : null;
  if (deps.resume && !restored) {
    throw new Error(`run ${run.runId} has no native exploration checkpoint; refusing to start fresh`);
  }
  let rng = restored ? restoreRng(restored.rng) : mulberry32(config.seed >>> 0);
  const sinks: Sinks = {
    findings: [],
    bundles: [],
    seenClassKeys: new Set(restored?.anomalyClassKeys ?? []),
    warnings: [],
    outcomes: (restored?.findingOutcomes ?? []).map((outcome) => ({
      classKey: outcome.classKey,
      outcome: outcome.outcome,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
    })),
  };

  const seen = new Set<string>(restored?.native?.seen ?? []);
  const useCount = new Map<string, number>(restored?.native?.useCount ?? []);
  const triedEdges = new Set<string>(restored?.native?.triedEdges ?? []);
  const blockedActionKeys = new Set<string>(restored?.toxicActionKeys ?? []);
  const rejectedActionKeys = new Set<string>(restored?.rejectedActionKeys ?? []);
  const processedFindingClassKeys = new Set<string>(restored?.processedFindingClassKeys ?? []);
  if (deps.resume && deps.store) {
    for (const record of deps.store.listFindings(1000)) {
      if (record.runId !== run.runId || !record.classKey) continue;
      const terminal = ["CONFIRMED", "RESOLVED", "REGRESSED", "REJECTED", "FLAKY"].includes(record.status);
      if (!terminal) continue;
      sinks.seenClassKeys.add(record.classKey);
      processedFindingClassKeys.add(record.classKey);
      if (sinks.outcomes.some((outcome) => outcome.classKey === record.classKey)) continue;
      if (["CONFIRMED", "RESOLVED", "REGRESSED"].includes(record.status)) {
        const finding = findingEngine.rehydrate(record);
        if (!sinks.findings.some((existing) => existing.id === finding.id)) sinks.findings.push(finding);
        sinks.outcomes.push({ classKey: record.classKey, outcome: "confirmed", findingId: finding.id });
      } else {
        sinks.outcomes.push({ classKey: record.classKey, outcome: record.status.toLowerCase(), findingId: record.id });
      }
    }
  }
  const graph = restored ? StateGraph.fromSnapshot(restored.graph) : new StateGraph();
  let plateau = restored?.native?.plateau ?? 0;
  let actionsExecuted = restored?.actionsExecuted ?? 0;
  let stoppedReason: NativeHuntResult["stoppedReason"] = "action-budget";
  const startMs = Date.parse(campaign?.createdAt ?? restored?.campaignStartedAt ?? new Date().toISOString());
  const campaignStartMs = Number.isFinite(startMs) ? startMs : Date.now();
  const segment: Action[] = restored?.native?.segment?.slice() ?? [];
  let currentState = restored?.currentState ?? "";
  let currentScreen = restored?.currentScreen ?? "";
  let pendingEdge = restored?.native?.pendingEdge;
  let checkpointStepSequence = restored?.stepSequence ?? 0;

  const reconcile = (): void => {
    if (!deps.store || !campaign) return;
    for (const action of deps.store.getInFlightActions(run.runId)) {
      const metadata = parseNativeMetadata(action.metadata_json);
      if (metadata?.actionKey) blockedActionKeys.add(metadata.actionKey);
      if (metadata?.rngAfter) rng = restoreRng(metadata.rngAfter);
      sinks.warnings.push(`unresolved action ${action.id} (${action.status}) retained as non-retryable`);
    }
    const durableCount = deps.store.countRunActions(run.runId);
    const actions = deps.store.listCommittedActionsAfterStep(run.runId, checkpointStepSequence);
    const steps = deps.store.getRunSteps(run.runId);
    for (const committed of actions) {
      const metadata = parseNativeMetadata(committed.action.metadata_json);
      if (!metadata?.actionKey || !metadata.stateBefore) continue;
      if (metadata.rngAfter) rng = restoreRng(metadata.rngAfter);
      const edge = `${metadata.stateBefore}::${metadata.actionKey}`;
      triedEdges.add(edge);
      useCount.set(metadata.actionKey, (useCount.get(metadata.actionKey) ?? 0) + 1);
      const after = steps.find((step) => step.step.sequence === committed.stepSequence + 1 && step.action === null && step.observations.length > 0);
      let target: string | null = null;
      if (after) {
        try {
          const summary = JSON.parse(after.observations[0]!.summary_json) as Record<string, unknown>;
          const observation = { summary } as import("@inspector/protocol").Observation;
          target = stateFingerprint(observation);
          seen.add(target);
          currentState = target;
          currentScreen = screenFingerprint(observation);
          graph.visitState(target, screenFingerprint(observation), durableCount);
        } catch {
          sinks.warnings.push(`post-action observation for ${committed.action.id} was malformed; edge target remains unknown`);
        }
      }
      graph.recordEdge(metadata.stateBefore, metadata.actionKey, target, durableCount);
      if (target === null) pendingEdge = { fromState: metadata.stateBefore, actionKey: metadata.actionKey };
      const reconstructed = nativeActionFromRecord(committed.action, metadata);
      if (reconstructed) segment.push(reconstructed);
    }
    actionsExecuted = Math.max(actionsExecuted, durableCount);
    checkpointStepSequence = Math.max(checkpointStepSequence, deps.store.maxRunStepSequence(run.runId));
  };

  const checkpoint = (): void => {
    if (!deps.store || !campaign) return;
    actionsExecuted = Math.max(actionsExecuted, deps.store.countRunActions(run.runId));
    const payload: ExplorationCheckpointPayload = {
      schema: "inspector-exploration-checkpoint/1",
      version: 1,
      runId: run.runId,
      explorerKind: "native",
      explorerVersion: EXPLORER_VERSION,
      adapter: caps.adapter,
      seed: config.seed >>> 0,
      configFingerprint: configFingerprint(config),
      rng: rng.snapshot(),
      stepSequence: deps.store.maxRunStepSequence(run.runId),
      campaignStartedAt: campaign?.createdAt ?? new Date(campaignStartMs).toISOString(),
      actionsExecuted,
      resets: 0,
      actionsSinceNewState: plateau,
      recentActionKeys: [],
      toxicActionKeys: [...blockedActionKeys].sort(),
      rejectedActionKeys: [...rejectedActionKeys].sort(),
      currentState,
      currentScreen,
      graph: graph.snapshot(),
      actionKindSequence: [],
      actionPath: segment.slice(),
      anomalies: [],
      anomalyClassKeys: [...sinks.seenClassKeys].sort(),
      processedFindingClassKeys: [...processedFindingClassKeys].sort(),
      findingOutcomes: sinks.outcomes.map((outcome) => ({
        anomalyKey: outcome.classKey,
        classKey: outcome.classKey,
        outcome: outcome.outcome,
        ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
      } satisfies FindingOutcomeSnapshot)),
      budget,
      native: {
        seen: [...seen].sort(),
        useCount: [...useCount.entries()].sort(([a], [b]) => a.localeCompare(b)),
        triedEdges: [...triedEdges].sort(),
        plateau,
        segment: segment.slice(),
        ...(pendingEdge ? { pendingEdge } : {}),
      },
    };
    writeCheckpoint(deps.store, payload);
    checkpointStepSequence = payload.stepSequence;
  };

  reconcile();
  checkpoint();

  while (true) {
    if (actionsExecuted >= config.maxActions) { stoppedReason = "action-budget"; break; }
    if (Date.now() - campaignStartMs > config.maxWallMs) { stoppedReason = "wall-budget"; break; }
    if (config.maxFindings > 0 && sinks.outcomes.filter((o) => o.outcome.startsWith("confirmed")).length >= config.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }
    // HARDENING_2 D1/D3: cooperative stop and budget permission at the safe
    // loop boundary, before any further adapter activity.
    if (control?.stopRequested()) { stoppedReason = "cancelled"; break; }
    if (control && !control.admit("action")) { stoppedReason = "budget-exhausted"; break; }

    // Observe through the standard pipeline (persists an observation).
    let obs;
    try {
      obs = await run.observe(["uiTree"]);
    } catch (e) {
      // Honest stop: backend-level enumeration failure (e.g. ROOT_ONLY_STUB,
      // DEAD_WINDOW) ends the session instead of crashing the host process.
      sinks.warnings.push(`observe failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`);
      stoppedReason = "adapter-error";
      break;
    }
    const uiTree = uiTreeOf(obs);
    // Fine-grained identity: terminal screens keep constant element ids
    // (line-N), so novelty must include dynamic text/values, not just the
    // visible-control set.
    const fp = stateFingerprint(obs);
    const novel = !seen.has(fp);
    seen.add(fp);
    currentState = fp;
    currentScreen = screenFingerprint(obs);
    const hadPendingEdge = pendingEdge !== undefined;
    if (pendingEdge) {
      const existing = graph.edges.has(`${pendingEdge.fromState}::${pendingEdge.actionKey}`);
      if (existing) graph.resolveEdgeTarget(pendingEdge.fromState, pendingEdge.actionKey, fp);
      else graph.recordEdge(pendingEdge.fromState, pendingEdge.actionKey, fp, actionsExecuted);
      pendingEdge = undefined;
    }
    if (hadPendingEdge && !novel) graph.visitState(fp, currentScreen, actionsExecuted);
    if (novel) {
      plateau = 0;
      graph.visitState(fp, currentScreen, actionsExecuted);
    } else if (!hadPendingEdge) {
      plateau += 1;
    }
    if (config.noveltyPlateauLimit !== undefined && plateau >= config.noveltyPlateauLimit) {
      // Distinguish an empty inventory from a fully-explored one.
      stoppedReason = uiTree.length > 0 ? "coverage-exhausted" : "no-candidates";
      break;
    }

    // Candidates from the DECLARED vocabulary only.
    const candidates = buildNativeInventory(uiTree, caps, {
      allowFaults: false,
    });
    if (candidates.length === 0) {
      stoppedReason = "no-candidates";
      break;
    }

    // SPEC-009 W8 strategy: prefer actions NOT yet executed FROM THIS STATE
    // (state/action edge accounting), then least-executed overall, then
    // declared priority. Platform-neutral: everything derives from caps.
    const usable = candidates.filter((c) => !blockedActionKeys.has(c.actionKey) && !rejectedActionKeys.has(c.actionKey));
    if (usable.length === 0) {
      stoppedReason = "coverage-exhausted";
      break;
    }
    const fresh = usable.filter(
      (c) => !triedEdges.has(`${fp}::${c.actionKey}`),
    );
    // H5-D4 (HARDENING_5): usage/freshness dominate static priority. The
    // previous priority-first ordering let max-priority boundary fills
    // permanently starve every other candidate (observed: 40/40 fills, zero
    // clicks on the seeded UIA dialog), structurally preventing windows
    // exploration from ever reaching a defect beyond a text box.
    const ranked = (fresh.length > 0 ? fresh : usable)
      .slice()
      .sort(
        (a, b) =>
          (useCount.get(a.actionKey) ?? 0) - (useCount.get(b.actionKey) ?? 0) ||
          b.priority - a.priority,
      );
    const band = ranked.slice(0, Math.min(ranked.length, 6));
    const pick: CandidateAction = rng.pick(band);
    triedEdges.add(`${fp}::${pick.actionKey}`);
    pendingEdge = { fromState: fp, actionKey: pick.actionKey };

    const action: Action = {
      id: newId("act"),
      runId: run.runId,
      environmentId: run.environmentId,
      kind: pick.kind,
      risk: pick.risk === "observe" ? "observe" : "interact",
      // Generous-but-bounded: real-device ops (uiautomator dump, ConPTY
      // round-trips) legitimately take seconds under load.
      deadlineMs: 20000,
      idempotency: "safe-retry",
      input: {
        ...(pick.selector !== undefined ? { selector: pick.selector } : {}),
        ...(pick.value !== undefined ? { value: pick.value } : {}),
        // SPEC-009 W6: semantic replay descriptors ride with the action so
        // platform drivers can re-resolve targets after restarts/rehosts.
        ...(pick.automationId !== undefined ? { automationId: pick.automationId } : {}),
        ...(pick.controlName !== undefined ? { controlName: pick.controlName } : {}),
        ...(pick.controlType !== undefined ? { controlType: pick.controlType } : {}),
      },
      metadata: {
        actionKey: pick.actionKey,
        exploration: { actionKey: pick.actionKey, stateBefore: fp, rngAfter: rng.snapshot() },
      },
    };

    let submit;
    try {
      submit = await run.submitAction(action);
    } catch (e) {
      sinks.warnings.push(`submit threw for ${pick.kind}: ${String(e).slice(0, 120)}`);
      stoppedReason = "adapter-error";
      blockedActionKeys.add(pick.actionKey);
      reconcile();
      checkpoint();
      break;
    }
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${pick.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      blockedActionKeys.add(pick.actionKey);
      reconcile();
      checkpoint();
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${pick.kind}: ${submit.decision.reason ?? "unknown"}`,
      );
      rejectedActionKeys.add(pick.actionKey);
      blockedActionKeys.add(pick.actionKey);
      checkpoint();
      continue;
    }
    if (submit.kind === "duplicate") {
      // This candidate was never admitted: the durable idempotency holder is
      // an older pending/unknown action. Do not let its pre-submit edge look
      // like an executed transition when the next observation reconciles.
      pendingEdge = undefined;
      blockedActionKeys.add(pick.actionKey);
      checkpoint();
      continue;
    }

    actionsExecuted++;
    segment.push(action);
    useCount.set(pick.actionKey, (useCount.get(pick.actionKey) ?? 0) + 1);
    if (control && !control.commit("action")) {
      // The action ran and stays counted; the allowance was spent
      // concurrently. Stop with a truthful structured reason.
      stoppedReason = "budget-exhausted";
      checkpoint();
      break;
    }

    const outcome = submit.outcome;
    if (
      outcome.status === "target-failure" &&
      outcome.error?.code === "TARGET_FAILURE"
    ) {
      await processFailure(
        findingEngine,
        outcome,
        segment.slice(),
        sinks,
        replayDriverFactory,
        caps.adapter,
        processedFindingClassKeys,
        deps.store,
      );
      processedFindingClassKeys.add(`TARGET_FAILURE|${outcome.error?.message ?? "deterministic oracle failure"}`);
    }
    checkpoint();
    await sleep(100);
  }

  checkpoint();

  return {
    runId: run.runId,
    seed: config.seed,
    stoppedReason,
    actionsExecuted,
    statesVisited: seen.size,
    anomalies: sinks.seenClassKeys.size,
    findings: sinks.findings,
    evidenceBundles: sinks.bundles,
    findingOutcomes: sinks.outcomes,
    warnings: sinks.warnings,
  };
}

interface NativeStoredMetadata {
  actionKey?: string;
  stateBefore?: string;
  rngAfter?: RngSnapshot;
}

function parseNativeMetadata(raw: string | null): NativeStoredMetadata | null {
  if (!raw) return null;
  try {
    const wrapper = JSON.parse(raw) as { metadata?: { exploration?: NativeStoredMetadata } | null };
    const exploration = wrapper.metadata?.exploration;
    if (!exploration || typeof exploration !== "object") return null;
    return {
      ...(typeof exploration.actionKey === "string" ? { actionKey: exploration.actionKey } : {}),
      ...(typeof exploration.stateBefore === "string" ? { stateBefore: exploration.stateBefore } : {}),
      ...(exploration.rngAfter !== undefined ? { rngAfter: exploration.rngAfter } : {}),
    };
  } catch {
    return null;
  }
}

function nativeActionFromRecord(record: ActionRecord, metadata: NativeStoredMetadata): Action | null {
  if (!record.metadata_json) return null;
  try {
    const wrapper = JSON.parse(record.metadata_json) as {
      input?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };
    return {
      id: record.id,
      runId: record.run_id,
      environmentId: record.environment_id,
      kind: record.kind,
      risk: record.risk as Action["risk"],
      deadlineMs: record.deadline_ms,
      idempotency: record.idempotency as Action["idempotency"],
      target: null,
      input: wrapper.input ?? null,
      metadata: {
        ...(wrapper.metadata ?? {}),
        exploration: metadata,
      },
    };
  } catch {
    return null;
  }
}
