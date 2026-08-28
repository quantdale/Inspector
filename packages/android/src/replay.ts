import type { Action, ActionOutcome, ReplayResult, OracleSignal } from "@inspector/finding";
import { AndroidAdapterHandler } from "./android-adapter.js";
import { MockAdbBackend } from "./mock-backend.js";
import { RealAdbBackend } from "./real-backend.js";
import type { AdbBackend } from "./types.js";

/**
 * SPEC-009 W6: platform-faithful Android replay.
 *
 * CRITICAL INVARIANT: a failure discovered against a REAL device must never
 * be confirmed by replaying against MockAdbBackend. The caller selects the
 * backend EXPLICITLY ("mock" only for deterministic tests of the replay
 * implementation itself, "real" for production replay, or an injected backend
 * instance); there is no silent mock fallback.
 *
 * Provenance binding: when launchPackage is provided, replay refuses to run
 * against a different package than the recorded discovery target, so a stale
 * or retargeted workspace can never validate findings for another app.
 */

/** Thrown before any device contact when provenance would be violated. */
export class AndroidReplayTargetMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AndroidReplayTargetMismatchError";
  }
}

export type AndroidResetStrategy = "force-stop" | "none";

export interface AndroidReplayOptions {
  artifactBaseDir?: string;
  /** Forwarded to lifecycle create - e.g. launchPackage. */
  createOptions?: Record<string, unknown>;
  /**
   * Backend selection: explicit instance, "mock", or "real". Defaults to
   * "mock" ONLY for direct constructor use in deterministic tests; the hunt
   * wiring must pass "real" (or the env-mirroring selection) for real hunts.
   */
  backend?: AdbBackend | "mock" | "real";
  /** Discovered-target package; enforced against createOptions.launchPackage. */
  launchPackage?: string;
  /**
   * Deterministic baseline before replaying:
   *  - "force-stop": am force-stop the package, then let create relaunch it
   *    (safe for system apps like Settings; no data destruction);
   *  - "none": create relaunches without an extra stop.
   * Destructive `pm clear` is NEVER performed here; seeded-APK flows keep
   * their existing explicit uninstall+install contract inside the adapter.
   */
  resetStrategy?: AndroidResetStrategy;
}

function resolveBackend(opts: AndroidReplayOptions): AdbBackend {
  if (opts.backend && opts.backend !== "mock" && opts.backend !== "real") {
    return opts.backend;
  }
  if (opts.backend === "real") return new RealAdbBackend();
  return new MockAdbBackend();
}

export class AndroidReplayDriver {
  constructor(private readonly opts: AndroidReplayOptions = {}) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    // Provenance guard FIRST: refuse before touching any device.
    const createPkg =
      typeof this.opts.createOptions?.launchPackage === "string"
        ? this.opts.createOptions.launchPackage
        : undefined;
    if (
      this.opts.launchPackage !== undefined &&
      createPkg !== undefined &&
      createPkg !== this.opts.launchPackage
    ) {
      throw new AndroidReplayTargetMismatchError(
        `replay target mismatch: discovered '${this.opts.launchPackage}' but replay options target '${createPkg}'; refusing to validate findings for another package`,
      );
    }

    const backend = resolveBackend(this.opts);
    const handler = new AndroidAdapterHandler(backend, {}, this.opts.artifactBaseDir);
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    try {
      if (this.opts.resetStrategy === "force-stop" && createPkg) {
        const devices = await backend.devices();
        const serial = devices[0];
        if (serial) {
          await backend.shell(serial, `am force-stop ${createPkg}`).catch(() => {});
        }
      }
      const first = actions[0];
      const createOptions = {
        ...(this.opts.createOptions ?? {}),
        ...(first
          ? { runId: first.runId, environmentId: first.environmentId }
          : {}),
      };
      await handler.lifecycle({
        op: "create",
        ...(Object.keys(createOptions).length > 0 ? { options: createOptions } : {}),
      });
      for (const a of actions) {
        const outcome = await handler.act({ action: a });
        outcomes.push(outcome);
        if (
          outcome.status === "target-failure" &&
          outcome.error?.code === "TARGET_FAILURE"
        ) {
          signals.push({ kind: "PAGE_ERROR", detail: outcome.error?.message });
        }
      }
    } finally {
      await handler.lifecycle({ op: "close" }).catch(() => {});
    }
    return { outcomes, signals, observations: [] };
  }
}
