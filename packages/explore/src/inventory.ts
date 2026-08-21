import type { Action, CapabilityDoc } from "@inspector/protocol";
import type { UiElement } from "./state.js";
import { boundaryValues } from "./inputs.js";
import { hashString } from "./rng.js";

export type ExploreActionKind =
  | "click"
  | "fill"
  | "press"
  | "select"
  | "navigate"
  | "back"
  | "forward"
  | "reload"
  | "wait"
  | "fault";

export interface CandidateAction {
  /** Stable-ish per-proposal id; rebuilt whenever the inventory is regenerated. */
  id: string;
  kind: ExploreActionKind;
  selector?: string;
  value?: string;
  risk: Action["risk"];
  /** Dedup key: kind + selector + value (and fault name). */
  actionKey: string;
  sourceElementId?: string;
  isBoundary?: boolean;
  fault?: string;
  /** Base priority hint used by the scorer. */
  priority: number;
  /** When > 1, execute the action this many times in a row (sequence generation). */
  repeat?: number;
  metadata?: Record<string, unknown>;
}

function selectorFor(el: UiElement): string | undefined {
  if (el.id) return `#${el.id}`;
  if (el.name) return `[aria-label="${el.name}"]`;
  return undefined;
}

export interface BuildInventoryOptions {
  allowFaults: boolean;
  allowedOrigins?: string[];
}

export function buildInventory(
  uiTree: UiElement[],
  caps: CapabilityDoc,
  opts: BuildInventoryOptions,
): CandidateAction[] {
  const out: CandidateAction[] = [];
  const actCaps = new Set(caps.capabilities.act ?? []);
  const visible = uiTree.filter((e) => !e.hidden && !e.disabled);

  for (const el of visible) {
    const sel = selectorFor(el);
    if (!sel) continue;
    const isInteractive =
      el.tag === "button" ||
      el.role === "button" ||
      el.tag === "a" ||
      el.tag === "input" ||
      el.tag === "textarea" ||
      el.tag === "select";

    if (el.tag === "button" || el.role === "button" || el.tag === "a") {
      if (actCaps.has("click")) {
        out.push({
          id: `c_${el.id || el.name}`,
          kind: "click",
          selector: sel,
          risk: "interact",
          actionKey: `click:${sel}`,
          sourceElementId: el.id,
          priority: 5,
        });
      }
    } else if (
      el.tag === "input" ||
      el.tag === "textarea" ||
      el.tag === "select"
    ) {
      const values = boundaryValues(el.id || el.name || el.tag);
      if (actCaps.has("fill")) {
        for (const v of values) {
          const boundary = v.length >= 64 || v === "CRASH" || v.includes("<");
          out.push({
            id: `f_${el.id}_${hashString(v)}`,
            kind: "fill",
            selector: sel,
            value: v,
            risk: "interact",
            actionKey: `fill:${sel}:${hashString(v)}`,
            sourceElementId: el.id,
            isBoundary: boundary,
            priority: boundary ? 8 : 4,
          });
        }
      }
      if (actCaps.has("press") && el.tag === "input") {
        out.push({
          id: `p_${el.id}`,
          kind: "press",
          selector: sel,
          risk: "interact",
          actionKey: `press:${sel}`,
          sourceElementId: el.id,
          priority: 2,
        });
      }
      if (actCaps.has("select") && el.tag === "select") {
        out.push({
          id: `s_${el.id}`,
          kind: "select",
          selector: sel,
          value: "0",
          risk: "interact",
          actionKey: `select:${sel}`,
          sourceElementId: el.id,
          priority: 3,
        });
      }
    }

    void isInteractive;
  }

  if (actCaps.has("reload")) {
    out.push({
      id: "g_reload",
      kind: "reload",
      risk: "interact",
      actionKey: "reload",
      priority: 1,
    });
  }
  if (actCaps.has("back")) {
    out.push({
      id: "g_back",
      kind: "back",
      risk: "interact",
      actionKey: "back",
      priority: 1,
    });
  }
  if (actCaps.has("forward")) {
    out.push({
      id: "g_forward",
      kind: "forward",
      risk: "interact",
      actionKey: "forward",
      priority: 1,
    });
  }
  if (actCaps.has("wait")) {
    out.push({
      id: "g_wait",
      kind: "wait",
      risk: "observe",
      actionKey: "wait",
      priority: 0,
    });
  }

  if (opts.allowFaults) {
    for (const f of caps.capabilities.faults ?? []) {
      out.push({
        id: `fault_${f}`,
        kind: "fault",
        fault: f,
        risk: "mutate-test-state",
        actionKey: `fault:${f}`,
        priority: 3,
      });
    }
  }

  return out;
}
