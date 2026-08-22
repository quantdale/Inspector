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
import {
  FindingEngine,
  type EvidenceBundle,
  type Finding,
  type ReplayDriver,
} from "@inspector/finding";
import { mulberry32 } from "./rng.js";
import { buildNativeInventory } from "./native-inventory.js";
import type { CandidateAction } from "./inventory.js";
import { stateFingerprint, uiTreeOf } from "./state.js";

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
    | "novelty-plateau"
    | "adapter-error";
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
  replayDriverFactory?: () => ReplayDriver,
): Promise<void> {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (sinks.seenClassKeys.has(classKey)) return;
  sinks.seenClassKeys.add(classKey);

  const finding = engine.ingest(
    { kind: "TARGET_FAILURE", detail: outcome.error?.detail ?? message },
    {
      runId: path[0]?.runId,
      title: `TARGET_FAILURE: ${message}`,
      adapter: undefined,
    },
  );

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
    .reproduce(finding, [...path], replayDriverFactory(), {
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
  /** Platform replay driver factory; omit to keep findings at CANDIDATE. */
  replayDriverFactory?: () => ReplayDriver;
}

export async function runNativeHunt(
  deps: NativeSessionDeps,
  config: NativeExplorationConfig,
): Promise<NativeHuntResult> {
  const { run, findingEngine, replayDriverFactory } = deps;
  const caps = run.caps;
  const rng = mulberry32(config.seed >>> 0);
  const sinks: Sinks = {
    findings: [],
    bundles: [],
    seenClassKeys: new Set(),
    warnings: [],
    outcomes: [],
  };

  const seen = new Set();
  const useCount = new Map();
  let plateau = 0;
  let actionsExecuted = 0;
  let stoppedReason: NativeHuntResult["stoppedReason"] = "action-budget";
  const startMs = Date.now();
  const segment: Action[] = [];

  while (true) {
    if (actionsExecuted >= config.maxActions) { stoppedReason = "action-budget"; break; }
    if (Date.now() - startMs > config.maxWallMs) { stoppedReason = "wall-budget"; break; }
    if (config.maxFindings > 0 && sinks.findings.length >= config.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }

    // Observe through the standard pipeline (persists an observation).
    const obs = await run.observe(["uiTree"]);
    const uiTree = uiTreeOf(obs);
    // Fine-grained identity: terminal screens keep constant element ids
    // (line-N), so novelty must include dynamic text/values, not just the
    // visible-control set.
    const fp = stateFingerprint(obs);
    const novel = !seen.has(fp);
    seen.add(fp);
    plateau = novel ? 0 : plateau + 1;
    if (config.noveltyPlateauLimit !== undefined && plateau >= config.noveltyPlateauLimit) {
      stoppedReason = "novelty-plateau";
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
    // Least-recently-executed rotation within the top priority band keeps
    // coverage broad without hammering one control (platform-neutral).
    candidates.sort(
      (a, b) =>
        (useCount.get(a.actionKey) ?? 0) - (useCount.get(b.actionKey) ?? 0) ||
        b.priority - a.priority,
    );
    const band = candidates.slice(0, Math.min(candidates.length, 8));
    const pick: CandidateAction = rng.pick(band);

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
      },
    };

    let submit;
    try {
      submit = await run.submitAction(action);
    } catch (e) {
      sinks.warnings.push(`submit threw for ${pick.kind}: ${String(e).slice(0, 120)}`);
      stoppedReason = "adapter-error";
      break;
    }
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${pick.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${pick.kind}: ${submit.decision.reason ?? "unknown"}`,
      );
      continue;
    }
    if (submit.kind === "duplicate") continue;

    actionsExecuted++;
    segment.push(action);
    useCount.set(pick.actionKey, (useCount.get(pick.actionKey) ?? 0) + 1);

    const outcome = submit.outcome;
    if (
      outcome.status === "target-failure" &&
      outcome.error?.code === "TARGET_FAILURE"
    ) {
      await processFailure(findingEngine, outcome, segment.slice(), sinks, replayDriverFactory);
    }
    await sleep(100);
  }

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
