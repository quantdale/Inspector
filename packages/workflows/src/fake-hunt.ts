import { newId, type Action } from "@inspector/protocol";
import type { RunController } from "@inspector/core";
import {
  FakeStateMachineDriver,
  FindingEngine,
  OracleEngine,
  type OracleSignal,
  type OracleSignalKind,
} from "@inspector/finding";
import {
  configFingerprint,
  loadLatestCheckpoint,
  restoreRng,
  mulberry32,
  writeCheckpoint,
  StateGraph,
  EXPLORER_VERSION,
  type ExplorationCheckpointPayload,
  type FindingOutcomeSnapshot,
} from "@inspector/explore";
import type { Store } from "@inspector/store-sqlite";
import { fakeExploreConfig } from "./configs.js";
import { mergeSignals } from "./evidence.js";
import { WorkflowError } from "./errors.js";
import type { HuntOutcomeEntry, HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

const FAKE_FILL_VALUES = ["ok", "ok", "", "x".repeat(80), "<script>", "BAD"] as const;

const ORACLE_SIGNAL_KINDS: readonly string[] = [
  "TARGET_FAILURE",
  "PAGE_ERROR",
  "DEFECT_SUBMIT_INVALID",
  "IMPOSSIBLE_STATE",
  "ADAPTER_CRASH",
];

function fakeAction(run: RunController, kind: string, input?: Record<string, unknown>): Action {
  return {
    id: newId("act"),
    runId: run.runId,
    environmentId: run.environmentId,
    kind,
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    ...(input !== undefined ? { input } : {}),
  };
}

function nextFakeAction(
  rng: ReturnType<typeof mulberry32>,
  state: string,
  pendingFillIsBoundary: boolean,
): { kind: string; input?: Record<string, unknown> } {
  switch (state) {
    case "form":
      // Explorer discipline: a boundary value just entered the field, so the
      // very next move is to submit it (otherwise later fills overwrite the
      // hazard and it never reaches the oracle).
      if (pendingFillIsBoundary) return { kind: "submit" };
      // Weight filling over submitting so boundary values reach the defect.
      return rng.pick(["submit", "fillField", "fillField"] as const) === "submit"
        ? { kind: "submit" }
        : { kind: "fillField", input: { name: "default", value: rng.pick(FAKE_FILL_VALUES) } };
    case "done":
      return rng.pick([{ kind: "goHome" }, { kind: "toggleFlag" }] as const);
    case "error":
      return rng.pick([{ kind: "retry" }, { kind: "goHome" }] as const);
    case "home":
    default:
      return rng.pick([
        { kind: "openForm" },
        { kind: "toggleFlag" },
        { kind: "goHome" },
      ] as const);
  }
}

interface FakeFindingSinks {
  findings: import("@inspector/finding").Finding[];
  bundles: import("@inspector/finding").EvidenceBundle[];
  outcomes: HuntOutcomeEntry[];
  seenClassKeys: Set<string>;
  warnings: string[];
}

export async function runFakeHunt(
  run: RunController,
  store: Store,
  req: HuntRequest,
  progress: ProgressFn,
  resume = false,
): Promise<HuntRunResult> {
  const engine = new FindingEngine(OracleEngine.defaults(), store);
  const sinks: FakeFindingSinks = {
    findings: [],
    bundles: [],
    outcomes: [],
    seenClassKeys: new Set<string>(),
    warnings: [],
  };
  const campaign = store.getExplorationCampaign(run.runId);
  const config = fakeExploreConfig(req);
  const budget = {
    maxActions: req.maxActions,
    maxResets: 0,
    maxFindings: req.maxFindings,
    maxWallMs: req.maxMinutes * 60_000,
  };
  const restored = resume
    ? (() => {
        if (!campaign) throw new WorkflowError("not-resumable", `run ${run.runId} has no durable fake exploration campaign`);
        return loadLatestCheckpoint(store, {
          runId: run.runId,
          explorerKind: "fake",
          explorerVersion: EXPLORER_VERSION,
          adapter: campaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(config),
        }, budget);
      })()
    : null;
  if (resume && !restored) throw new WorkflowError("not-resumable", `run ${run.runId} has no fake exploration checkpoint`);
  if (restored) {
    for (const key of restored.anomalyClassKeys) sinks.seenClassKeys.add(key);
    sinks.outcomes.push(...restored.findingOutcomes.map((outcome) => ({
      classKey: outcome.classKey,
      outcome: outcome.outcome,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
    })));
  }
  let rng = restored ? restoreRng(restored.rng) : mulberry32(req.seed >>> 0);
  const statesSeen = new Set<string>(restored?.fake?.statesSeen ?? ["home"]);
  const segment: Action[] = restored?.fake?.segment?.slice() ?? [];
  const blocked = new Set<string>(restored?.toxicActionKeys ?? []);
  const rejected = new Set<string>(restored?.rejectedActionKeys ?? []);
  const processed = new Set<string>(restored?.processedFindingClassKeys ?? []);
  if (resume) {
    for (const record of store.listFindings(1000)) {
      if (record.runId !== run.runId || !record.classKey) continue;
      const terminal = ["CONFIRMED", "RESOLVED", "REGRESSED", "REJECTED", "FLAKY"].includes(record.status);
      if (!terminal) continue;
      sinks.seenClassKeys.add(record.classKey);
      processed.add(record.classKey);
      if (sinks.outcomes.some((outcome) => outcome.classKey === record.classKey)) continue;
      if (["CONFIRMED", "RESOLVED", "REGRESSED"].includes(record.status)) {
        const finding = engine.rehydrate(record);
        if (!sinks.findings.some((existing) => existing.id === finding.id)) sinks.findings.push(finding);
        sinks.outcomes.push({ classKey: record.classKey, outcome: "confirmed", findingId: finding.id });
      } else {
        sinks.outcomes.push({ classKey: record.classKey, outcome: record.status.toLowerCase(), findingId: record.id });
      }
    }
  }
  let state = restored?.fake?.state ?? "home";
  let pendingFillIsBoundary = restored?.fake?.pendingFillIsBoundary ?? false;
  let actionsExecuted = restored?.actionsExecuted ?? 0;
  let consecutiveRejections = 0;
  let stoppedReason = "action-budget";
  const campaignStartMs = Date.parse(campaign?.createdAt ?? restored?.campaignStartedAt ?? new Date().toISOString());
  const startMs = Number.isFinite(campaignStartMs) ? campaignStartMs : Date.now();
  const graph = restored ? StateGraph.fromSnapshot(restored.graph) : new StateGraph();
  if (!restored) graph.visitState("home", "fake:home", 0);
  let checkpointStepSequence = restored?.stepSequence ?? 0;

  const reconcile = (): void => {
    for (const unresolved of store.getInFlightActions(run.runId)) {
      const metadata = parseFakeMetadata(unresolved.metadata_json);
      if (metadata?.actionKey) blocked.add(metadata.actionKey);
      if (metadata?.rngAfter) rng = restoreRng(metadata.rngAfter);
    }
    const durable = store.countRunActions(run.runId);
    for (const committed of store.listCommittedActionsAfterStep(run.runId, checkpointStepSequence)) {
      const metadata = parseFakeMetadata(committed.action.metadata_json);
      if (!metadata?.actionKey) continue;
      if (metadata.rngAfter) rng = restoreRng(metadata.rngAfter);
      const before = metadata.stateBefore ?? state;
      const after = committed.action.state_after;
      if (after) {
        state = after;
        statesSeen.add(after);
        graph.visitState(after, `fake:${after}`, durable);
      }
      graph.recordEdge(before, metadata.actionKey, after, durable);
      const reconstructed = fakeActionFromRecord(committed.action, metadata);
      if (reconstructed) {
        segment.push(reconstructed);
        if (reconstructed.kind === "fillField") {
          pendingFillIsBoundary = reconstructed.input?.value === "BAD";
        } else if (reconstructed.kind === "submit" || reconstructed.kind === "goHome") {
          pendingFillIsBoundary = false;
        }
      }
      if (state === "home") segment.length = 0;
    }
    actionsExecuted = Math.max(actionsExecuted, durable);
    checkpointStepSequence = Math.max(checkpointStepSequence, store.maxRunStepSequence(run.runId));
  };

  const checkpoint = (): void => {
    if (!campaign) return;
    actionsExecuted = Math.max(actionsExecuted, store.countRunActions(run.runId));
    const payload: ExplorationCheckpointPayload = {
      schema: "inspector-exploration-checkpoint/1",
      version: 1,
      runId: run.runId,
      explorerKind: "fake",
      explorerVersion: EXPLORER_VERSION,
      adapter: campaign.adapter,
      seed: req.seed >>> 0,
      configFingerprint: configFingerprint(config),
      rng: rng.snapshot(),
      stepSequence: store.maxRunStepSequence(run.runId),
      campaignStartedAt: campaign.createdAt,
      actionsExecuted,
      resets: 0,
      actionsSinceNewState: 0,
      recentActionKeys: [],
      toxicActionKeys: [...blocked].sort(),
      rejectedActionKeys: [...rejected].sort(),
      currentState: state,
      currentScreen: `fake:${state}`,
      graph: graph.snapshot(),
      actionKindSequence: [],
      actionPath: segment.slice(),
      anomalies: [],
      anomalyClassKeys: [...sinks.seenClassKeys].sort(),
      processedFindingClassKeys: [...processed].sort(),
      findingOutcomes: sinks.outcomes.map((outcome) => ({
        anomalyKey: outcome.classKey,
        classKey: outcome.classKey,
        outcome: outcome.outcome,
        ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
      } satisfies FindingOutcomeSnapshot)),
      budget,
      fake: { state, pendingFillIsBoundary, statesSeen: [...statesSeen].sort(), segment: segment.slice() },
    };
    writeCheckpoint(store, payload);
    checkpointStepSequence = payload.stepSequence;
  };

  reconcile();
  checkpoint();
  const maxWallMs = req.maxMinutes * 60_000;

  while (true) {
    if (actionsExecuted >= req.maxActions) {
      stoppedReason = "action-budget";
      break;
    }
    if (Date.now() - startMs > maxWallMs) {
      stoppedReason = "wall-budget";
      break;
    }
    if (req.maxFindings > 0 && sinks.outcomes.filter((o) => o.outcome.startsWith("confirmed")).length >= req.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }

    let choice: { kind: string; input?: Record<string, unknown> } | null = null;
    let actionKey = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = nextFakeAction(rng, state, pendingFillIsBoundary);
      const candidateKey = fakeChoiceKey(candidate);
      if (blocked.has(candidateKey) || rejected.has(candidateKey)) continue;
      choice = candidate;
      actionKey = candidateKey;
      break;
    }
    if (!choice) {
      stoppedReason = "no-candidates";
      break;
    }
    const stateBeforeAction = state;
    const action = fakeAction(run, choice.kind, choice.input);
    action.metadata = { exploration: { actionKey, stateBefore: state, rngAfter: rng.snapshot() } };
    const submit = await run.submitAction(action);
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${choice.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      blocked.add(actionKey);
      checkpoint();
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${choice.kind}: ${submit.decision.reason ?? "unknown reason"}`,
      );
      consecutiveRejections += 1;
      rejected.add(actionKey);
      blocked.add(actionKey);
      checkpoint();
      if (consecutiveRejections >= 10) {
        stoppedReason = "no-candidates";
        break;
      }
      continue;
    }
    if (submit.kind === "duplicate") {
      sinks.warnings.push(`duplicate submission for ${action.id}; outcome unresolved, skipping`);
      blocked.add(actionKey);
      checkpoint();
      continue;
    }
    consecutiveRejections = 0;
    actionsExecuted += 1;
    segment.push(action);
    if (actionsExecuted % 25 === 0) progress(`... ${actionsExecuted} actions executed`);

    // Track the field under test: a boundary fill must be submitted next.
    if (choice.kind === "fillField") {
      pendingFillIsBoundary = choice.input?.value === "BAD";
    } else if (choice.kind === "submit" || choice.kind === "goHome") {
      pendingFillIsBoundary = false;
    }

    const outcome: import("@inspector/protocol").ActionOutcome = submit.outcome;
    const failed =
      outcome.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE";
    if (failed) {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
      try {
        await processFakeFailure(
          engine,
          run,
          outcome,
          segment.slice(),
          req,
          sinks,
          progress,
          processed,
          store,
        );
      } catch (e) {
        // One broken reproduction must not destroy the hunt: record and move on.
        const detail = e instanceof Error ? e.message : String(e);
        sinks.warnings.push(`finding pipeline failed: ${detail}`);
        sinks.outcomes.push({
          classKey: `TARGET_FAILURE|${outcome.error?.message ?? ""}`,
          outcome: "error",
          detail,
        });
      }
      processed.add(`TARGET_FAILURE|${outcome.error?.message ?? ""}`);
    } else {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
    }
    // Back at baseline: truncate the cumulative path so each reproducer is a
    // clean segment starting from the home state.
    if (state === "home") segment.length = 0;
    graph.visitState(state, `fake:${state}`, actionsExecuted);
    graph.recordEdge(
      stateBeforeAction,
      actionKey,
      state,
      actionsExecuted,
    );
    checkpoint();
  }

  checkpoint();

  return {
    runId: run.runId,
    seed: req.seed,
    stoppedReason,
    actionsExecuted,
    statesVisited: statesSeen.size,
    resets: 0,
    anomalyCount: sinks.seenClassKeys.size,
    findings: sinks.findings,
    evidenceBundles: sinks.bundles,
    findingOutcomes: sinks.outcomes,
    warnings: sinks.warnings,
  };
}

function fakeChoiceKey(choice: { kind: string; input?: Record<string, unknown> }): string {
  return `fake:${choice.kind}:${JSON.stringify(choice.input ?? null)}`;
}

interface FakeStoredMetadata {
  actionKey?: string;
  stateBefore?: string;
  rngAfter?: unknown;
  input?: Record<string, unknown> | null;
}

function parseFakeMetadata(raw: string | null): FakeStoredMetadata | null {
  if (!raw) return null;
  try {
    const wrapper = JSON.parse(raw) as {
      input?: Record<string, unknown> | null;
      metadata?: { exploration?: FakeStoredMetadata } | null;
    };
    const exploration = wrapper.metadata?.exploration;
    if (!exploration || typeof exploration !== "object") return null;
    return {
      ...(typeof exploration.actionKey === "string" ? { actionKey: exploration.actionKey } : {}),
      ...(typeof exploration.stateBefore === "string" ? { stateBefore: exploration.stateBefore } : {}),
      ...(exploration.rngAfter !== undefined ? { rngAfter: exploration.rngAfter } : {}),
      ...(wrapper.input !== undefined ? { input: wrapper.input } : {}),
    };
  } catch {
    return null;
  }
}

function fakeActionFromRecord(record: import("@inspector/store-sqlite").ActionRecord, metadata: FakeStoredMetadata): Action | null {
  return {
    id: record.id,
    runId: record.run_id,
    environmentId: record.environment_id,
    kind: record.kind,
    risk: record.risk as Action["risk"],
    deadlineMs: record.deadline_ms,
    idempotency: record.idempotency as Action["idempotency"],
    target: null,
    input: metadata.input ?? null,
    metadata: { exploration: metadata },
  };
}

/** Ingest -> reproduce -> minimize -> confirm -> bundle for one fake failure. */
async function processFakeFailure(
  engine: FindingEngine,
  run: RunController,
  outcome: import("@inspector/protocol").ActionOutcome,
  path: Action[],
  req: HuntRequest,
  sinks: FakeFindingSinks,
  progress: ProgressFn,
  processedFindingClassKeys: Set<string>,
  store: Store,
): Promise<void> {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (processedFindingClassKeys.has(classKey)) return;
  sinks.seenClassKeys.add(classKey);

  if (req.maxFindings > 0 && sinks.findings.length >= req.maxFindings) {
    sinks.outcomes.push({ classKey, outcome: "skipped-finding-cap" });
    return;
  }

  const signalKind = ORACLE_SIGNAL_KINDS.includes(message)
    ? (message as OracleSignalKind)
    : "TARGET_FAILURE";
  const signal: OracleSignal = { kind: signalKind, detail: outcome.error?.detail ?? message };
  progress(`candidate defect detected (${signalKind})`);

  const durable = store.getFindingByClassKey(run.runId, classKey);
  let finding = durable
    ? engine.rehydrate(durable)
    : engine.ingest(signal, {
        runId: run.runId,
        title:
          message === signalKind
            ? `${signalKind} from deterministic oracle`
            : `${signalKind}: ${message}`,
        adapter: run.caps.adapter,
        classKey,
      });
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
  const makeDriver = () => new FakeStateMachineDriver();

  const rep = await engine.reproduce(finding, path, makeDriver(), {
    attempts: 2,
    minSuccesses: 1,
  });
  const record = (name: string, detail?: string) => {
    const entry: HuntOutcomeEntry = { classKey, outcome: name, findingId: finding.id };
    if (detail !== undefined) entry.detail = detail;
    sinks.outcomes.push(entry);
  };

  if (rep.finding.status === "REJECTED") {
    record("rejected", rep.stats.lastError ?? "reproduction policy not satisfied");
    return;
  }
  if (rep.finding.status === "FLAKY") {
    record(
      "flaky",
      `reproduction flaky (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`,
    );
    return;
  }

  const minimized = await engine.minimize(rep.finding, path, makeDriver());
  let confirmed = rep.finding;
  if (rep.finding.status === "MINIMIZED") {
    if (rep.finding.minimization?.verifiedReproduction === true) {
      confirmed = engine.transition(rep.finding, "CONFIRMED", {
        reason: "minimization verified reproduction",
      });
      record("confirmed");
    } else {
      confirmed = engine.transition(rep.finding, "REJECTED", {
        reason: "minimization did not verify reproduction",
      });
      record("rejected", "minimization did not verify reproduction");
      return;
    }
  } else {
    record(
      "confirmed-unverified-minimization",
      "minimize() baseline verification failed; confirmed by reproduction policy only",
    );
  }

  const bundle = engine.buildBundle(confirmed, path, minimized, {
    signals: mergeSignals(rep.lastSignals, [signal]),
    replayCommand: `inspector replay --finding ${confirmed.id}`,
  });
  sinks.findings.push(confirmed);
  sinks.bundles.push(bundle);
}
