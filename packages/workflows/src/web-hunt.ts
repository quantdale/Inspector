import { join } from "node:path";
import type { Action, OracleSignal } from "@inspector/finding";
import type { RunController } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import {
  ExploreController,
  WebReplayDriver,
} from "@inspector/explore";
import type { Store } from "@inspector/store-sqlite";
import { webExploreConfig } from "./configs.js";
import { mergeSignals, closeRunGuarded } from "./evidence.js";
import type { HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

export { closeRunGuarded };

/** Await run.close(), giving up (honestly) after 15s instead of hanging. */
export async function closeRunGuardedImpl(run: RunController, warn: ProgressFn): Promise<void> {
  return closeRunGuarded(run, warn);
}

/** Merge replay evidence with the ingest signal, deduplicating exact repeats. */
export function mergeOracleSignals(primary: OracleSignal[], extra: OracleSignal[]): OracleSignal[] {
  return mergeSignals(primary, extra);
}

/* ------------------------------------------------------------------ *
 * Web hunt: proven ExploreController wiring against the real adapter. *
 * ------------------------------------------------------------------ */

export async function runWebHunt(
  run: RunController,
  store: Store,
  req: HuntRequest,
  base: string,
  progress: ProgressFn,
  resume = false,
): Promise<HuntRunResult> {
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);

  // Live progress instrumentation: one line per ~25 actions and per candidate
  // defect. Retained intentionally; it changes no behavior.
  let actions = 0;
  const originalSubmit = run.submitAction.bind(run);
  run.submitAction = async (action: Action) => {
    const result = await originalSubmit(action);
    actions += 1;
    if (actions % 25 === 0) progress(`... ${actions} actions executed`);
    return result;
  };
  const originalIngest = findingEngine.ingest.bind(findingEngine);
  findingEngine.ingest = (
    signal: Parameters<FindingEngine["ingest"]>[0],
    opts: Parameters<FindingEngine["ingest"]>[1],
  ) => {
    progress(`candidate defect detected (${signal.kind})`);
    return originalIngest(signal, opts);
  };

  const controller = new ExploreController({
    run,
    store,
    findingEngine,
    config: webExploreConfig(req),
    resume,
    replayDriverFactory: () =>
      new WebReplayDriver({ artifactBaseDir: join(base, "replay"), targetUrl: req.targetUrl }),
  });

  const result = await controller.run_();
  return {
    runId: result.runId,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: result.resets,
    anomalyCount: result.anomalies.length,
    findings: result.findings,
    evidenceBundles: result.evidenceBundles,
    findingOutcomes: result.findingOutcomes.map((o) => ({
      classKey: o.classKey,
      outcome: o.outcome,
      ...(o.detail !== undefined ? { detail: o.detail } : {}),
      ...(o.findingId !== undefined ? { findingId: o.findingId } : {}),
    })),
    warnings: result.warnings,
  };
}
