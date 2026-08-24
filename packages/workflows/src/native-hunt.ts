import type { RunController } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { runNativeHunt, type NativeSessionDeps } from "@inspector/explore";
import type { Store } from "@inspector/store-sqlite";
import { nativeExploreConfig } from "./configs.js";
import type { ExplorationControl, HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

/**
 * SPEC-009 W4: native (non-web) hunts share the fake walker's proven loop
 * shape but drive ANY adapter through its DECLARED vocabulary via
 * runNativeHunt. Without a platform-faithful replay driver (web/seeded-mock
 * only today), native findings stay CANDIDATE — recorded, never confirmed.
 */
export async function runNativeHuntCommand(
  run: RunController,
  store: Store,
  req: HuntRequest,
  _base: string,
  progress: ProgressFn,
  resume = false,
  control?: ExplorationControl,
): Promise<HuntRunResult> {
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);

  // SPEC-009 W6: platform-faithful replay. Android findings discovered on a
  // real device are reproduced against a REAL adb backend bound to the SAME
  // package (force-stop reset; never pm clear, never mock).
  let replayDriverFactory: NativeSessionDeps["replayDriverFactory"];
  if (req.adapter === "android") {
    const { AndroidReplayDriver } = await import("../../android/src/replay.js");
    const launchPackage = req.target ?? "com.android.settings";
    const createOptions = { launchPackage };
    replayDriverFactory = () =>
      new AndroidReplayDriver({
        backend: "real",
        createOptions,
        launchPackage,
        resetStrategy: "force-stop",
      });
  } else if (req.adapter === "windows") {
    const { WindowsUiaReplayDriver } = await import("../../windows-adapter/src/replay.js");
    const targetTitle = req.target;
    replayDriverFactory = () => new WindowsUiaReplayDriver({ targetTitle });
  }

  const result = await runNativeHunt(
    { run, findingEngine, store, resume, ...(control ? { control } : {}), ...(replayDriverFactory ? { replayDriverFactory } : {}) },
    nativeExploreConfig(req),
  );
  progress(`native hunt stopped: ${result.stoppedReason}`);
  return {
    runId: result.runId,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: 0,
    anomalyCount: result.anomalies,
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
