# SPEC-009 — Platform-Neutral Autonomous Exploration

Status: COMPLETE (M9 closed 2026-08-23; see implementation record at the end)
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

---

# Implementation record — W6/W7/W8 (M9 completion)

## W6 — replay-faithful native reproduction (LANDED)

Critical invariant honored everywhere: a real-discovered finding is never
confirmed by mock-backend replay; without a faithful driver findings stay
CANDIDATE with an explicit `candidate-no-replay-driver` ledger entry.

- **Android** (`packages/android/src/replay.ts`): driver refactored to an
  EXPLICITLY selected backend ("mock" | "real" | injected instance) — no
  silent mock fallback. Provenance binding refuses a package mismatch BEFORE
  any device contact (`AndroidReplayTargetMismatchError`). Deterministic
  baseline via bounded `am force-stop` + relaunch (never `pm clear`; seeded
  APK keeps its explicit contract inside the adapter). Hunt wiring passes
  `backend:"real"` bound to the discovered package.
- **CLI/PTTY** (`packages/cli-adapter/src/replay.ts`): every attempt runs in a
  FRESH deterministic PTY session (same program/cwd/env contract, fixture
  `prepare` hook resets scratch state); constrained input vocabulary only;
  backend "real" requires an explicit factory so the native binding stays
  lazy.
- **Windows/UIA** (`packages/windows-adapter/src/replay.ts`): replay identity
  resolves against a FRESH tree — RuntimeId fast path, then AutomationId,
  then controlType+exact name; coordinates never persisted. An unresolvable
  locator yields ACTION_FAILED (automation failure) and NEVER a
  TARGET_FAILURE defect signal; genuine invoke failures yield TARGET_FAILURE
  signals for the pipeline. Missing window fails before any action.
- Session wiring (`runNativeHunt`): async factory support; findings carry
  adapter-family provenance into records/bundles.

## W7 — Android exploration depth (LANDED)

- `uiautomator.ts` rewritten as a deterministic nested-tree walker (handles
  paired + self-closing nodes, entity decoding), preserving resource-id,
  text, content-desc, class, clickable/scrollable/enabled/checkable, bounds,
  and a structural path per node.
- Semantic selector strategy with nth-disambiguation: `#id` →
  `@desc:<v>|<class>` → `~text:<v>|<class>` → `%path=<p>`; resolution re-dumps
  and derives tap coordinates at action time; hidden/disabled nodes are never
  resolvable (stale screens fail honestly).
- Bounded scrolling exposed through the vocabulary (`swipe` down|up),
  geometry derived from a scrollable container in the fresh dump.

## W8 — exploration strategy + proofs (LANDED)

- Session: state/action edge accounting (prefer untried edges from the
  current state), LRU fallback, `coverage-exhausted` vs `no-candidates`
  distinguished, honest adapter-error stop on backend enumeration failures,
  observe deadlines configurable for real devices (30s native).
- Windows backend: ROOT_ONLY_STUB blind-stub guard (two consecutive root-only
  enumerations trigger ONE title-evidenced migration, then honest typed
  failure), surface-detaching controls annotated by evidence and declined
  autonomously ("Keep on top" forensics), UIA bridge default timeout 15s.

## Intentional narrowings (documented, evidence-backed)

- PTY `terminal-resize`: NOT declared in the vocabulary this milestone
  (readScreen remains scrollback-tail; resize without a cell model adds no
  exploration value). Deferred with the cell-buffer work.
- Windows `expandCollapse`/`select` kinds: folded into `click` (InvokePattern)
  for this milestone; the adapter retains expandCollapse ops internally.
- Android `swipe` is container-bounded scrolling only; no arbitrary gestures.
- Keep-on-top class transitions on Win11 remain non-enumerable after the
  rehost; the adapter now annotates such evidenced controls and the explorer
  declines them autonomously (forensics:
  `.inspector/ga-work/hunts/uia-soak/transition-forensics.mts`).
