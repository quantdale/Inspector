import { FakeStateMachine } from "@inspector/adapter-fake";
import type { Action, ActionOutcome } from "@inspector/protocol";
import type { OracleSignal, ReplayDriver, ReplayResult } from "./types.js";

export class FakeStateMachineDriver implements ReplayDriver {
  async replay(actions: Action[]): Promise<ReplayResult> {
    const sm = new FakeStateMachine();
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    for (const a of actions) {
      const r = sm.apply({ kind: a.kind, input: a.input });
      const outcome: ActionOutcome = {
        actionId: a.id,
        runId: a.runId,
        environmentId: a.environmentId,
        status: r.status === "target-failure" ? "target-failure" : "success",
        observedAt: new Date().toISOString(),
        stateAfter: r.nextState,
      };
      if (r.status === "target-failure") {
        outcome.error = {
          code: "TARGET_FAILURE",
          message: r.oracleSignal ?? "failure",
          detail: r.summary,
        };
        signals.push({ kind: (r.oracleSignal as OracleSignal["kind"]) ?? "TARGET_FAILURE", detail: r.summary });
      }
      outcomes.push(outcome);
    }
    return { outcomes, signals, observations: [] };
  }
}

export class FlakyDriver implements ReplayDriver {
  constructor(
    private readonly inner: ReplayDriver,
    private readonly reproduceOnOddAttempts = true,
  ) {}
  private attempt = 0;
  async replay(actions: Action[]): Promise<ReplayResult> {
    this.attempt += 1;
    const res = await this.inner.replay(actions);
    const shouldReproduce = this.reproduceOnOddAttempts ? this.attempt % 2 === 1 : this.attempt % 2 === 0;
    if (!shouldReproduce) {
      return { outcomes: [], signals: [], observations: [] };
    }
    return res;
  }
}
