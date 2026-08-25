import { join } from "node:path";
import type { Action, OracleSignal } from "@inspector/finding";
import type { RunController } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import {
  ExploreController,
  WebReplayDriver,
  buildSuspicionPacket,
  serializePacket,
} from "@inspector/explore";
import { SemanticSuspector } from "@inspector/oracle";
import type { Store } from "@inspector/store-sqlite";
import { webExploreConfig } from "./configs.js";
import { mergeSignals, closeRunGuarded } from "./evidence.js";
import { StoreModelCallSink, type ResolvedModelSupport } from "./model-support.js";
import type { ExplorationControl, HuntModelSummary, HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

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
  control?: ExplorationControl,
  model?: ResolvedModelSupport,
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
    ...(control ? { control } : {}),
    ...(model
      ? {
          model: {
            runtime: model.runtime,
            ...(model.gate !== undefined ? { gate: model.gate } : {}),
            sink: model.sink ?? new StoreModelCallSink(store),
            ...(model.plannerConfig !== undefined ? { config: model.plannerConfig } : {}),
            ...(model.attribution !== undefined ? { attribution: model.attribution } : {}),
            summarize: model.summarize,
          },
        }
      : {}),
    replayDriverFactory: () =>
      new WebReplayDriver({
        artifactBaseDir: join(base, "replay"),
        targetUrl: req.targetUrl,
        // M12 F9: one adapter subprocess reused across this finding's
        // reproduce/minimize replays; the explorer disposes it per cycle.
        persistent: true,
      }),
  });

  const result = await controller.run_();

  // M13 F8: optional bounded semantic-suspicion evaluation over discovered
  // anomalies. Advisory only — it can never confirm a defect or authorize
  // repair; verdicts surface as warnings + structured model summary.
  const suspicions: NonNullable<HuntModelSummary["suspicions"]> = [];
  if (model?.semanticOracle === true && result.anomalies.length > 0) {
    const suspector = new SemanticSuspector(
      model.runtime,
      {},
      model.gate,
      model.sink ?? new StoreModelCallSink(store),
      model.attribution,
    );
    for (const anomaly of result.anomalies.slice(0, 5)) {
      try {
        const packet = buildSuspicionPacket({
          beforeFingerprint: anomaly.stateBefore,
          actionSummary: `${anomaly.kind}: ${anomaly.message}`,
          hardOracleOutcomes: [],
          artifactHandles: anomaly.outcome?.artifactRefs ?? [],
        });
        const verdict = await suspector.evaluate({ packetJson: serializePacket(packet.packet) });
        suspicions.push({
          classKey: anomaly.classKey,
          disposition: verdict.disposition,
          confidence: verdict.confidence,
          summary: verdict.summary.slice(0, 300),
          ...(verdict.classification !== undefined ? { classification: verdict.classification } : {}),
        });
        progress(`semantic suspicion (${verdict.disposition}) for ${anomaly.classKey}`);
      } catch (err) {
        result.warnings.push(
          `semantic suspicion evaluation failed for ${anomaly.classKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const modelSummary: HuntModelSummary | undefined = model
    ? {
        providers: model.providers.map((p) => p.meta.id),
        ...(result.planner !== undefined ? { planner: result.planner } : {}),
        ...(suspicions.length > 0 ? { suspicions } : {}),
        runtimeStats: { ...model.runtime.stats },
        ...(model.standaloneTotals ? { budgetTotals: model.standaloneTotals() } : {}),
      }
    : undefined;

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
    ...(modelSummary !== undefined ? { model: modelSummary } : {}),
  };
}
