/**
 * SPEC-009 W3: per-platform candidate inventories.
 *
 * All builders produce the same CandidateAction shape the existing
 * scorer/planner consume, and ALL of them pass every candidate through the
 * W2 autonomy classification (adapter-declared vocabulary risk + contextual
 * label deny-patterns). Platform knowledge lives HERE, never in core finding
 * semantics.
 */
import type { CapabilityDoc } from "@inspector/protocol";
import type { UiElement } from "./state.js";
import { boundaryValues } from "./inputs.js";
import { strongHash } from "./rng.js";
import type { CandidateAction, ExploreActionKind } from "./inventory.js";
import { classifyAutonomy } from "./autonomy.js";

interface BuildOpts {
  allowFaults: boolean;
}

function eligible(
  caps: CapabilityDoc,
  kind: string,
  label: string | undefined,
): boolean {
  return classifyAutonomy({ caps, kind, label }).eligible;
}

  /** UIA pattern names projected by the windows adapter's rich observe. */
interface PatternedElement extends UiElement {
  patterns?: string[];
  automationId?: string;
  controlType?: string;
  surfaceDetaching?: boolean;
}

const has = (p: string[] | undefined, name: string): boolean =>
  Array.isArray(p) && p.some((x) => x.includes(name));

export function buildUiaInventory(
  uiTree: UiElement[],
  caps: CapabilityDoc,
  opts: BuildOpts,
): CandidateAction[] {
  const out: CandidateAction[] = [];
  const actCaps = new Set(caps.capabilities.act ?? []);
  for (const el of uiTree as PatternedElement[]) {
    if (el.hidden || el.disabled) continue;
    const label = el.name ?? el.text ?? "";
    // Window chrome destroys/hides the target — never a candidate.
    if (/^(minimize|maximize|close)\b/i.test(label.trim())) continue;

    if (actCaps.has("click") && has(el.patterns, "InvokePattern")) {
      const verdict = classifyAutonomy({ caps, kind: "click", label });
      if (!verdict.eligible) continue;
      // Adapter-evidenced surface-detaching controls are declined
      // autonomously (exploration continuity); they remain visible in
      // observations for operators.
      if (el.surfaceDetaching) continue;
      out.push({
        id: `uic_${strongHash(el.id ?? label)}`,
        kind: "click",
        selector: `#${el.id}`,
        risk: "interact",
        actionKey: `click:${el.id}`,
        sourceElementId: el.id,
        priority: 5,
        // SPEC-009 W6: semantic descriptors for cross-restart replay. The
        // RuntimeId selector is the fast path; the driver falls back to
        // these when the fresh tree no longer contains the rid.
        automationId: el.automationId || undefined,
        controlName: label || undefined,
        controlType: el.controlType,
      });
    }
    if (actCaps.has("fill") && el.role === "input" && has(el.patterns, "ValuePattern")) {
      const verdict = classifyAutonomy({ caps, kind: "fill", label });
      if (!verdict.eligible) continue;
      for (const v of boundaryValues(label || "field")) {
        out.push({
          id: `uif_${strongHash((el.id ?? "") + v)}`,
          kind: "fill",
          selector: `#${el.id}`,
          value: v,
          risk: "interact",
          actionKey: `fill:${el.id}:${strongHash(v)}`,
          sourceElementId: el.id,
          priority: v.length >= 64 ? 8 : 4,
        });
      }
    }
    void opts;
  }
  return out;
}

export function buildAndroidInventory(
  uiTree: UiElement[],
  caps: CapabilityDoc,
  _opts: BuildOpts,
): CandidateAction[] {
  const out: CandidateAction[] = [];
  const actCaps = new Set(caps.capabilities.act ?? []);

  // Selector disambiguation state: identical semantic selectors get @nth.
  const seenSel = new Map<string, number>();
  const selectorFor = (el: UiElement): string => {
    let base: string;
    if (el.id) base = `#${el.id}`;
    else if (el.desc) base = `@desc:${el.desc}|${el.tag}`;
    else if (el.text && el.text.length <= 60) base = `~text:${el.text}|${el.tag}`;
    else if (typeof el.path === "string") base = `%path=${el.path}`;
    else return "";
    const n = seenSel.get(base) ?? 0;
    seenSel.set(base, n + 1);
    return n === 0 ? base : `${base}@${n}`;
  };

  for (const el of uiTree as (UiElement & { clickable?: boolean })[]) {
    if (el.hidden || el.disabled) continue;
    const label = el.text ?? el.name ?? "";
    const tappable = el.clickable === true || el.role === "button" || Boolean(el.id);

    if (actCaps.has("click") && tappable) {
      if (!eligible(caps, "click", label)) continue;
      const sel = selectorFor(el);
      if (!sel) continue;
      out.push({
        id: `ac_${strongHash(sel)}`,
        kind: "click",
        selector: sel,
        risk: "interact",
        actionKey: `click:${sel}`,
        sourceElementId: el.id,
        priority: el.clickable ? 6 : el.role === "button" ? 5 : 4,
      });
    }
    if (actCaps.has("fill") && el.role === "input") {
      if (!eligible(caps, "fill", label)) continue;
      const sel = selectorFor(el);
      if (!sel) continue;
      for (const v of boundaryValues(el.id ?? label ?? "field")) {
        out.push({
          id: `af_${strongHash(sel + v)}`,
          kind: "fill",
          selector: sel,
          value: v,
          risk: "interact",
          actionKey: `fill:${sel}:${strongHash(v)}`,
          sourceElementId: el.id,
          priority: 4,
        });
      }
    }
  }

  // Bounded scrolling inside declared scrollable containers (W7).
  if (actCaps.has("swipe") && eligible(caps, "swipe", undefined)) {
    const hasScroller = (uiTree as (UiElement & { scrollable?: boolean })[]).some(
      (e) => e.scrollable && !e.hidden,
    );
    if (hasScroller) {
      out.push({
        id: "as_down",
        kind: "swipe",
        value: "down",
        risk: "interact",
        actionKey: "scroll:down",
        priority: 2,
      });
      out.push({
        id: "as_up",
        kind: "swipe",
        value: "up",
        risk: "interact",
        actionKey: "scroll:up",
        priority: 1,
      });
    }
  }

  if (actCaps.has("press") && eligible(caps, "press", undefined)) {
    out.push({
      id: "ab_back",
      kind: "press",
      value: "4", // KEYCODE_BACK
      risk: "interact",
      actionKey: "press:back",
      priority: 1,
    });
  }
  return out;
}

/**
 * Fixed SAFE terminal-input pool. The explorer never synthesizes arbitrary
 * shell commands; these are motion/edit/search/save keystrokes that are
 * meaningful in interactive TUIs (proven against real vim) and harmless in
 * a plain shell.
 */
const PTY_SAFE_TOKENS: readonly string[] = [
  "j", "k", "0", "^", "gg", "G", "x", "u", "dd", "i", "a", "o", "w", "b",
  "n", "~", ":w\r", "/inspect\r", "ga-field-text ",
];

export function buildPtyInventory(
  uiTree: UiElement[],
  caps: CapabilityDoc,
  _opts: BuildOpts,
): CandidateAction[] {
  void uiTree; // terminal state enters via novelty scoring, not targeting
  const out: CandidateAction[] = [];
  const actCaps = new Set(caps.capabilities.act ?? []);
  if (actCaps.has("fill")) {
    for (const token of PTY_SAFE_TOKENS) {
      out.push({
        id: `pty_${strongHash(token)}`,
        kind: "fill",
        value: token,
        risk: "interact",
        actionKey: `terminal-input:${token}`,
        priority: 3,
      });
    }
  }
  if (actCaps.has("press")) {
    out.push({
      id: "pty_ctrlc",
      kind: "press",
      value: "\u0003", // Ctrl-C
      risk: "interact",
      actionKey: "press:ctrl-c",
      priority: 2,
    });
  }
  return out;
}

/** Scheme dispatch driven ENTIRELY by the adapter's declared vocabulary. */
export function buildNativeInventory(
  uiTree: UiElement[],
  caps: CapabilityDoc,
  opts: BuildOpts,
): CandidateAction[] {
  const vocab = caps.capabilities.vocabulary ?? [];
  const schemes = new Set(vocab.map((v) => v.targetScheme));
  if (schemes.has("uia-runtime-id")) return buildUiaInventory(uiTree, caps, opts);
  if (schemes.has("android-resource-id")) return buildAndroidInventory(uiTree, caps, opts);
  if (schemes.has("pty-input")) return buildPtyInventory(uiTree, caps, opts);
  return [];
}

/** Narrow the shared CandidateAction kinds for native sessions. */
export type NativeKind = Extract<
  ExploreActionKind,
  "click" | "fill" | "press"
>;
