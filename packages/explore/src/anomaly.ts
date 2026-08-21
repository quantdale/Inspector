import type { Action, ActionOutcome, Observation } from "@inspector/protocol";

export interface DiscoveredAnomaly {
  /** Detailed dedup key (defect instance). */
  key: string;
  /** Normalized dedup key (defect class) used to avoid duplicate findings. */
  classKey: string;
  kind: string;
  message: string;
  stateBefore: string;
  actionPath: Action[];
  outcome?: ActionOutcome;
  severityHint?: "high" | "medium" | "low";
}

export interface DetectParams {
  action: Action;
  outcome: ActionOutcome | null;
  before: Observation;
  after: Observation | null;
  actionPath: Action[];
  stateBefore: string;
}

export interface AnomalyDetector {
  detect(params: DetectParams): DiscoveredAnomaly | null;
}

/**
 * Default detector: a genuine application crash (pageerror -> TARGET_FAILURE)
 * and structural "impossible state" (e.g. a counter showing NaN). Automation
 * misses (ACTION_FAILED) are deliberately NOT treated as defects.
 */
export class DefaultAnomalyDetector implements AnomalyDetector {
  detect({
    action,
    outcome,
    after,
    actionPath,
    stateBefore,
  }: DetectParams): DiscoveredAnomaly | null {
    if (
      outcome &&
      outcome.status === "target-failure" &&
      outcome.error?.code === "TARGET_FAILURE"
    ) {
      const msg = outcome.error?.message ?? "application crash";
      return {
        key: `crash:${stateBefore}:${action.kind}:${action.input?.selector ?? ""}:${msg.slice(0, 40)}`,
        classKey: `PAGE_ERROR:${msg.slice(0, 40)}`,
        kind: "PAGE_ERROR",
        message: msg,
        stateBefore,
        actionPath: actionPath.slice(),
        outcome,
        severityHint: "high",
      };
    }

    if (after) {
      const impossible = findImpossibleState(after);
      if (impossible) {
        return {
          key: `impossible:${stateBefore}:${action.kind}:${action.input?.selector ?? ""}:${impossible}`,
          classKey: `IMPOSSIBLE_STATE:${impossible}`,
          kind: "IMPOSSIBLE_STATE",
          message: impossible,
          stateBefore,
          actionPath: actionPath.slice(),
          severityHint: "high",
        };
      }
    }

    return null;
  }
}

function findImpossibleState(obs: Observation): string | null {
  const uiTree =
    (obs.summary as { uiTree?: Array<{ id?: string; text?: string }> })
      ?.uiTree ?? [];
  for (const el of uiTree) {
    if (el.id === "count" && el.text != null) {
      const t = el.text.trim();
      if (
        t === "NaN" ||
        t === "undefined" ||
        t === "null" ||
        t === "Infinity"
      ) {
        return `count shows impossible value: ${t}`;
      }
    }
  }
  return null;
}
