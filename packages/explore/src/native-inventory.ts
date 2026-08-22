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
      out.push({
        id: `uic_${strongHash(el.id ?? label)}`,
        kind: "click",
        selector: `#${el.id}`,
        risk: "interact",
        actionKey: `click:${el.id}`,
        sourceElementId: el.id,
        priority: 5,
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
  for (const el of uiTree) {
    if (el.hidden || el.disabled || !el.id) continue;
    const label = el.text ?? el.name ?? "";
    if (actCaps.has("click") && (el.role === "button" || (label && label.length <= 40))) {
      if (!eligible(caps, "click", label)) continue;
      out.push({
        id: `ac_${strongHash(el.id + label)}`,
        kind: "click",
        selector: `#${el.id}`,
        risk: "interact",
        actionKey: `click:${el.id}`,
        sourceElementId: el.id,
        priority: el.role === "button" ? 5 : 4,
      });
    }
    if (actCaps.has("fill") && el.role === "input") {
      if (!eligible(caps, "fill", label)) continue;
      for (const v of boundaryValues(el.id)) {
        out.push({
          id: `af_${strongHash(el.id + v)}`,
          kind: "fill",
          selector: `#${el.id}`,
          value: v,
          risk: "interact",
          actionKey: `fill:${el.id}:${strongHash(v)}`,
          sourceElementId: el.id,
          priority: 4,
        });
      }
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
