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
  /** Serve this HTML instead of the default seeded app (repair verification). */
  seedHtml?: string;
  /** Reproduce against an external localhost target instead of the seeded
   * app; forwarded as a lifecycle-create option to the spawned adapter. */
  targetUrl?: string;
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
    const handler = new WebAdapterHandler({}, base, this.opts.seedHtml);
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    try {
      await handler.lifecycle(
        this.opts.targetUrl !== undefined
          ? { op: "create", options: { targetUrl: this.opts.targetUrl } }
          : { op: "create" },
      );
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
