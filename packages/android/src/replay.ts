import type { Action, ActionOutcome, ReplayResult, OracleSignal } from "@inspector/finding";
import { AndroidAdapterHandler } from "./android-adapter.js";
import { MockAdbBackend } from "./mock-backend.js";

/**
 * Replays captured action paths against a *fresh* mock Android device so
 * reproduction starts from a clean baseline. Genuine application crashes
 * surface as TARGET_FAILURE outcomes and are translated into PAGE_ERROR
 * oracle signals — the same contract as the web replay driver.
 */
export class AndroidReplayDriver {
  constructor(private readonly opts: { artifactBaseDir?: string } = {}) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    const backend = new MockAdbBackend();
    const handler = new AndroidAdapterHandler(backend, {}, this.opts.artifactBaseDir);
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
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
      await handler.lifecycle({ op: "close" }).catch(() => {});
    }
    return { outcomes, signals, observations: [] };
  }
}
