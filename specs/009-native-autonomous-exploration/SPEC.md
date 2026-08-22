# SPEC-009 — Platform-Neutral Autonomous Exploration

Status: ACTIVE
Milestone: M9 (roadmap entry added in this change)
Origin: DOGFOOD_RC1 audit finding W6 ("ExploreController supports web
vocabulary only"); GA field-validation report residual debt #1.

## Problem

Inspector has production bindings for CLI/PTY, Windows/UIA, Android/ADB, and
web, but product-level autonomous exploration (`inspector hunt`) speaks only
the web vocabulary through `ExploreController`. Non-web platforms require
bespoke out-of-tree driving loops. The largest capability gap between
"production bindings" and "autonomous QA findings" outside web.

## Goals

G1. A capability-driven action vocabulary so adapters declare WHAT they can
    safely do (semantic kinds, target schemes, adapter-declared risk) and the
    core explorer reasons over capabilities — no `if platform === ...`
    branches in core finding/oracle/exploration semantics.
G2. A risk/policy boundary that excludes or requires stronger authorization
    for controls/actions with EXTERNAL side effects (sign-in, purchase, send,
    delete, install/uninstall, permission grants, account mutation,
    destructive filesystem/process actions), combining adapter-declared risk
    class, action kind, policy ceiling, and contextual labels — never labels
    alone.
G3. Production `inspector hunt` autonomously explores non-web targets through
    the STANDARD evidence/finding pipeline (RunManager → submitAction →
    oracle/finding engine → durable store), replacing bespoke loops.
G4. All existing evidence/oracle/finding semantics preserved unchanged.

## Non-goals

- No iOS work (M8 stays DEFERRED_ENVIRONMENT).
- No Electron production-real proof (kept explicit debt until a runtime is
  available).
- No new oracle kinds; existing OracleEngine suites apply unchanged.

## Architecture

### W0 — Vocabulary in protocol (`packages/protocol`)

`Capabilities` gains an optional `vocabulary: ActionKindSpec[]`:

```ts
type ActionRiskClass = "observe" | "interact" | "mutate-test-state"
                     | "external-side-effect";

interface ActionKindSpec {
  kind: string;            // canonical: click/tap, fill/type, press/key/signal,
                           // back/navigate, swipe/scroll, toggle/select,
                           // terminal-input, terminal-resize, invoke,
                           // lifecycle-restart/kill
  targetScheme?:           // how selectors for this kind address targets
    | "css"                // web DOM
    | "uia-runtime-id"     // Windows UIA runtime ids
    | "android-resource-id"
    | "pty-input";         // raw terminal input tokens
  risk: ActionRiskClass;   // adapter-declared DEFAULT risk for the kind
  autonomousEligible: boolean; // false => never auto-selected by the explorer
  description?: string;
}
```

Rules:
- Adapters MAY omit `vocabulary`; consumers fall back to today's behavior.
- `autonomousEligible: false` + risk `external-side-effect` is the expected
  declaration for lifecycle kill/restart and anything operator-shaped.
- JSON-schema validation updated; protocol version unchanged (additive,
  optional field).

### W1 — Adapter declarations

Each real adapter declares its honest vocabulary in its `initialize()`:

- web: css scheme; click/fill/press/select/back/forward/reload/wait;
  interact-risk; all autonomousEligible except none.
- cli (PTY): pty-input scheme; terminal-input (interact), terminal-resize
  (interact); NO shell command synthesis — input tokens come from a fixed
  safe pool.
- windows (UIA): uia-runtime-id scheme; invoke (interact), toggle (interact),
  setValue (interact), expandCollapse (interact), select (interact);
  closeWindow/lifecycle ops NOT exposed as autonomous kinds.
- android: android-resource-id scheme; tap/click (interact), fill (interact),
  press BACK (interact); swipe/scroll when implemented end-to-end;
  lifecycle restart/kill declared but NOT autonomousEligible.

### W2 — Side-effect risk gate (`packages/core` policy + explore)

- `Action.risk` values map onto `ActionRiskClass`; `external-side-effect`
  maps to a NEW action risk value accepted by protocol validation.
- PolicyEngine: rejects actions with effective risk class
  `external-side-effect` unless `policy.allowExternalSideEffects === true`
  (default false). Rejection reason: `EXTERNAL_SIDE_EFFECT_DENIED`.
- Explorer-side deny-pattern filter (defense in depth, applied to candidate
  labels BEFORE policy): sign in/out, log in/out, purchase, checkout, pay,
  send, delete/remove, install/uninstall, grant/allow, upgrade, subscribe,
  reset password, erase/wipe. Matching candidates get effective risk
  `external-side-effect` (hence denied under default policy) even when the
  adapter declared them `interact`.

### W3 — Platform inventories (`packages/explore`)

Per-platform candidate builders producing the SAME `CandidateAction` shape
the scorer/planner already consume:

- `buildUiaInventory(nodes, caps, opts)` — InvokePattern→invoke,
  TogglePattern→toggle, ValuePattern Edit→fill(setValue round-trip),
  ExpandCollapsePattern→select(expand). Window chrome (minimize/maximize/
  close) and offscreen/disabled nodes excluded.
- `buildAndroidInventory(nodes, caps, opts)` — id-bearing visible rows →
  click(tap), EditText→fill boundary values, global BACK press, bounded
  swipe/scroll when the adapter declares it.
- `buildPtyInventory(screenLines, caps, opts)` — terminal-input candidates
  from the fixed safe token pool (motion/edit/save/search keys), no free-form
  command construction.

All three apply the W2 label filter.

### W4 — Generic exploration session + CLI wiring

- `NativeExplorationSession` (explore package): capability-driven loop over
  ANY AdapterHandler — initialize → read vocabulary → observe → build
  inventory via scheme dispatch → score/select (existing scorer) →
  `run.submitAction(...)` → oracle ingestion identical to web hunts →
  novelty plateau / budgets stop conditions. State fingerprinting reuses the
  existing normalized-tree fingerprint (platform-independent by design).
- `inspector hunt --adapter cli|windows|android [--target ...]` spawns the
  corresponding adapter subprocess (already bundled) and runs the generic
  session. Web keeps the proven ExploreController path.

### W5 — Exit proofs (field, installed artifact)

- P-CLI: `inspector hunt --adapter cli` explores vim on a scratch file
  through the standard pipeline (findings list/show + runs show coherent).
- P-WIN: `inspector hunt --adapter windows --target calc` (and mspaint or
  notepad) explores via the standard pipeline without bespoke drivers.
- P-ANDROID: `inspector hunt --adapter android --package com.android.settings`
  explores the preinstalled app on the AVD through the standard pipeline.

## Acceptance criteria

A1. Protocol validation accepts/rejects vocabulary docs per schema; adapters
    without vocabulary behave exactly as before (backward compat test).
A2. Default policy denies external-side-effect actions; explicit opt-in flag
    required; label deny-filter promotes suspicious interact candidates.
    Deterministic unit coverage for both layers.
A3. Each platform inventory builder has deterministic unit coverage including
    chrome/deny-pattern exclusion.
A4. One integration test per platform proves the generic session drives the
    mock/injectable backend end-to-end through RunController + FindingEngine
    with evidence bundles produced.
A5. Field exit proofs P-CLI/P-WIN/P-ANDROID executed against real backends
    with results recorded in campaign state.
