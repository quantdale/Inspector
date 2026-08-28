import type { Action, ActionOutcome, ReplayResult, OracleSignal } from "@inspector/finding";
import { CliAdapterHandler } from "./cli-adapter.js";
import { MockPtyBackend } from "./mock-pty.js";
import type { PtyBackend } from "./types.js";

/**
 * SPEC-009 W6: platform-faithful CLI/PTTY replay.
 *
 * Every replay() runs in a FRESH deterministic PTY session: same program,
 * same cwd/env contract (the backend spawns with the caller's process cwd
 * unless overridden), same terminal geometry, scratch fixture reset by the
 * caller-provided `prepare` hook before the session starts. Only the
 * constrained autonomous input vocabulary is replayed - never synthesized
 * shell commands.
 *
 * Backend selection follows the W6 critical invariant: "mock" exists ONLY for
 * deterministic tests of this driver; production wiring passes "real"
 * (@lydell/node-pty) so a real-session finding can never be validated on a
 * mock terminal.
 */
export interface CliPtyReplayOptions {
  /** Program to spawn fresh for every attempt (e.g. "vim", "seedcli"). */
  program: string;
  /** Explicit backend instance, "mock", "real", or a factory for "real". */
  backend?: PtyBackend | "mock" | "real" | (() => PtyBackend);
  /** Optional per-attempt fixture setup (scratch file content, etc.). */
  prepare?: () => void | Promise<void>;
  /** Settle time after spawn before replaying (ms). Default 700. */
  bootSettleMs?: number;
  /** Per-action settle time (ms). Default 150. */
  actionSettleMs?: number;
}

function resolveBackend(opts: CliPtyReplayOptions): PtyBackend {
  const b = opts.backend;
  if (b && b !== "mock" && b !== "real") {
    return typeof b === "function" ? b() : b;
  }
  if (b === "real") {
    throw new Error(
      'CliPtyReplayDriver backend "real" requires a factory (e.g. () => new NodePtyBackend()) so the native binding stays lazy',
    );
  }
  return new MockPtyBackend();
}

export class CliPtyReplayDriver {
  constructor(private readonly opts: CliPtyReplayOptions) {}

  async replay(actions: Action[]): Promise<ReplayResult> {
    if (this.opts.prepare) await this.opts.prepare();
    const handler = new CliAdapterHandler(
      resolveBackend(this.opts),
      undefined,
      this.opts.program,
    );
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    try {
      const first = actions[0];
      await handler.lifecycle({
        op: "create",
        options: {
          runId: first?.runId ?? "replay",
          environmentId: first?.environmentId ?? "env",
        },
      });
      await sleep(this.opts.bootSettleMs ?? 700);
      for (const a of actions) {
        const outcome = await handler.act({ action: a });
        outcomes.push(outcome);
        if (
          outcome.status === "target-failure" &&
          outcome.error?.code === "TARGET_FAILURE"
        ) {
          signals.push({ kind: "PAGE_ERROR", detail: outcome.error?.message });
        }
        await sleep(this.opts.actionSettleMs ?? 150);
      }
    } finally {
      await handler.lifecycle({ op: "close" }).catch(() => {});
    }
    return { outcomes, signals, observations: [] };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
