import type { Action, ActionOutcome, Observation } from "@inspector/protocol";
import { uiTreeOf, type UiElement } from "./state.js";

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
    before,
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
      const impossible = findImpossibleState(before, after);
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

/** Non-numeric display sentinels that indicate a broken computation. */
const IMPOSSIBLE_TEXTS: ReadonlySet<string> = new Set([
  "NaN",
  "undefined",
  "null",
  "Infinity",
  "-Infinity",
]);

/** Stable identity for uiTree elements without an id. */
function elementKey(el: UiElement): string {
  return el.id || el.name || `${el.tag}:${el.role}`;
}

/**
 * Transition-aware impossible-state check: an element is only impossible when
 * it existed before with a DIFFERENT text that parses as a finite number
 * (numeric context) and now shows a sentinel. A constant legit display (e.g.
 * "null") never transitions into a sentinel and is never flagged; a fresh
 * element with no previous value has no transition evidence either.
 */
function findImpossibleState(
  before: Observation,
  after: Observation,
): string | null {
  const beforeText = new Map<string, string>();
  for (const el of uiTreeOf(before)) {
    if (el.text != null) beforeText.set(elementKey(el), el.text);
  }
  for (const el of uiTreeOf(after)) {
    const t = el.text?.trim();
    if (t === undefined || !IMPOSSIBLE_TEXTS.has(t)) continue;
    const prev = beforeText.get(elementKey(el));
    if (prev === undefined) continue;
    const prevTrim = prev.trim();
    if (prevTrim === t) continue;
    if (!Number.isFinite(Number(prevTrim))) continue;
    return `${elementKey(el)} shows impossible value: ${t}`;
  }
  return null;
}
