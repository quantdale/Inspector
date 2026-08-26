import type { RunController } from "@inspector/core";
import type { ReplayDriver } from "@inspector/finding";
import type { Store } from "@inspector/store-sqlite";
import { join } from "node:path";
import { runWebHunt } from "./web-hunt.js";
import type { ExplorationControl, HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

/**
 * HARDENING_5 H5.2: Electron hunt/explore drives the same browser-like
 * ExploreController semantics as web (the Electron adapter deliberately
 * reuses Chromium sensing/acting), but every durable and operator-visible
 * identity stays Electron: the spawned adapter reports `electron-chromium`,
 * run/environment/evidence records carry it, and reproduction replays go
 * through {@link ElectronReplayDriver} — never web-playwright, never fake.
 *
 * Model assistance remains WEB-ONLY by explicit contract (M13); electron
 * exploration stays deterministic.
 */
export async function runElectronHunt(
  run: RunController,
  store: Store,
  req: HuntRequest,
  base: string,
  progress: ProgressFn,
  resume = false,
  control?: ExplorationControl,
): Promise<HuntRunResult> {
  const { ElectronReplayDriver } = await import("../../electron-adapter/src/replay.js");
  const replayFactory = (): ReplayDriver =>
    new ElectronReplayDriver({
      artifactBaseDir: join(base, "replay"),
      // One backend across the finding's reproduce/minimize cycle; the
      // explorer disposes it per confirmation cycle.
      persistent: true,
    });
  return runWebHunt(run, store, req, base, progress, resume, control, undefined, replayFactory);
}
