import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Action,
  ActionOutcome,
  ReplayResult,
  OracleSignal,
} from "@inspector/finding";
import { ElectronAdapterHandler } from "./electron-adapter.js";
import type { ElectronBackendMode } from "./real-electron.js";

export interface ElectronReplayOptions {
  artifactBaseDir?: string;
  /**
   * Backend mode for replay. Default resolves like the adapter bin (`auto`):
   * real executable when installed, injectable otherwise. Durable provenance
   * (spawn env `INSPECTOR_ELECTRON_BACKEND`) should pin this explicitly so
   * verify/regress reconstruct the SAME backend that produced the finding.
   */
  backend?: Exclude<ElectronBackendMode, "auto">;
  /**
   * Keep ONE handler across replay() calls and reuse it via lifecycle reset
   * (mirrors WebReplayDriver's M12 F9 efficiency contract). Callers MUST
   * dispose() when done. Default false closes after every replay.
   */
  persistent?: boolean;
}

/**
 * HARDENING_5 H5.4: platform-faithful Electron replay. Re-executes captured
 * action paths against the ELECTRON adapter (real fixture app under a real
 * runtime, or the deterministic injectable backend when provenance recorded
 * that mode) so reproduction, verification, and regression stay inside the
 * family that discovered the finding — never substituted with web or fake.
 *
 * Genuine application crashes surface as TARGET_FAILURE outcomes and are
 * translated into PAGE_ERROR oracle signals, matching web replay semantics.
 */
export class ElectronReplayDriver {
  private handler: ElectronAdapterHandler | null = null;
  private readonly base: string;

  constructor(private readonly opts: ElectronReplayOptions = {}) {
    this.base =
      this.opts.artifactBaseDir ??
      join(tmpdir(), `inspector-electron-replay-${process.pid}`);
  }

  async replay(actions: Action[]): Promise<ReplayResult> {
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    const handler =
      this.opts.persistent === true
        ? (this.handler ??= this.createHandler())
        : this.createHandler();
    try {
      await handler.lifecycle({ op: "create" });
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
      if (this.opts.persistent === true) {
        await handler.lifecycle({ op: "reset" }).catch(() => {});
      } else {
        await handler.lifecycle({ op: "close" }).catch(() => {});
      }
    }
    return { outcomes, signals, observations: [] };
  }

  /** Release the persistent handler (required when persistent). */
  async dispose(): Promise<void> {
    const handler = this.handler;
    this.handler = null;
    if (handler) {
      await handler.lifecycle({ op: "close" }).catch(() => {});
      await handler.shutdown().catch(() => {});
    }
  }

  private createHandler(): ElectronAdapterHandler {
    return new ElectronAdapterHandler(
      {},
      join(this.base, "artifacts"),
      undefined,
      this.opts.backend ?? "auto",
    );
  }
}
