import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebAdapterHandler } from "@inspector/adapter-web";
import type {
  Action,
  ActionOutcome,
  ReplayResult,
  OracleSignal,
} from "@inspector/finding";

export interface WebReplayOptions {
  artifactBaseDir?: string;
}

/**
 * Replays captured action paths against a *fresh* web adapter so reproduction
 * starts from a clean baseline (the seeded app resets to the login screen on
 * launch). Genuine application crashes surface as TARGET_FAILURE outcomes and
 * are translated into PAGE_ERROR oracle signals.
 */
export class WebReplayDriver {
  constructor(private readonly opts: WebReplayOptions = {}) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    const base =
      this.opts.artifactBaseDir ??
      join(tmpdir(), `inspector-web-replay-${process.pid}`);
    const handler = new WebAdapterHandler({}, base);
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
