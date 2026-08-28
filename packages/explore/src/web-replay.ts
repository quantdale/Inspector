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
  /**
   * M12 F9 runtime efficiency: keep ONE adapter subprocess alive across
   * replay() calls and reuse it via lifecycle reset (conformance-proven to
   * return an identical seeded state) instead of paying a full process +
   * browser launch per replay. Callers MUST dispose() when done. Default
   * false preserves the historical close-after-every-replay behavior.
   */
  persistent?: boolean;
}

/**
 * Replays captured action paths against the web adapter so reproduction
 * starts from a clean baseline (the seeded app resets to the login screen on
 * launch). Genuine application crashes surface as TARGET_FAILURE outcomes and
 * are translated into PAGE_ERROR oracle signals.
 */
export class WebReplayDriver {
  private handler: WebAdapterHandler | null = null;
  private persistentAttribution: string | null = null;
  private readonly base: string;

  constructor(private readonly opts: WebReplayOptions = {}) {
    this.base =
      this.opts.artifactBaseDir ??
      join(tmpdir(), `inspector-web-replay-${process.pid}`);
  }

  async replay(actions: Action[]): Promise<ReplayResult> {
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    const persistent = this.opts.persistent === true;
    const first = actions[0];
    const attribution = first
      ? `${first.runId}\u0000${first.environmentId}`
      : null;
    let handler: WebAdapterHandler;
    if (!persistent) {
      handler = new WebAdapterHandler({}, this.base, this.opts.seedHtml);
    } else if (
      this.handler === null ||
      (attribution !== null && attribution !== this.persistentAttribution)
    ) {
      // A persistent driver is scoped to one run/environment. If a caller
      // reuses it for another identity, recreate the adapter so outcomes can
      // never be attributed to the previous lifecycle context.
      if (this.handler) await this.handler.lifecycle({ op: "close" }).catch(() => {});
      handler = new WebAdapterHandler({}, this.base, this.opts.seedHtml);
      await handler.lifecycle({
        op: "create",
        ...(Object.keys(this.createOptions(actions)).length > 0
          ? { options: this.createOptions(actions) }
          : {}),
      });
      this.handler = handler;
      this.persistentAttribution = attribution;
    } else {
      handler = this.handler;
    }
    try {
      if (!persistent) {
        const createOptions = this.createOptions(actions);
        await handler.lifecycle({
          op: "create",
          ...(Object.keys(createOptions).length > 0 ? { options: createOptions } : {}),
        });
      }
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
        // Return to a clean baseline without tearing down the adapter
        // process, so the next replay skips a full relaunch.
        await handler.lifecycle({ op: "reset" }).catch(() => {});
      } else {
        await handler.lifecycle({ op: "close" }).catch(() => {});
      }
    }
    return { outcomes, signals, observations: [] };
  }

  private createOptions(actions: Action[]): Record<string, unknown> {
    const first = actions[0];
    return {
      ...(this.opts.targetUrl !== undefined ? { targetUrl: this.opts.targetUrl } : {}),
      ...(first ? { runId: first.runId, environmentId: first.environmentId } : {}),
    };
  }

  /** Release the persistent adapter subprocess (required when persistent). */
  async dispose(): Promise<void> {
    const handler = this.handler;
    this.handler = null;
    this.persistentAttribution = null;
    if (handler) {
      await handler.lifecycle({ op: "close" }).catch(() => {});
    }
  }
}
