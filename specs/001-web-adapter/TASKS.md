# Specification 001 — Task Graph

Work in dependency order. Mark tasks complete only after their acceptance tests pass.

## W0 — Seeded target

- [x] Deterministic web fixture app with hidden defects (crash, state, validation, navigation, persistence).
- [x] Served by an in-adapter static server; reset/seed available.

## W1 — Environment lifecycle

- [x] create/reset/close via Playwright Chromium.
- [x] Isolated browser context, viewport/locale/timezone set.
- [x] Cleanup after close.

## W2 — Sensing

- [x] url/title observation.
- [x] semantic/accessibility interactive inventory (role/id/visibility).
- [x] screenshot artifact.
- [x] console/page errors.
- [x] network event metadata with redaction.
- [x] storage metadata.
- [x] Playwright trace artifact.

## W3 — Acting

- [x] semantic click/fill/press/select/navigate/back/forward/reload/wait.
- [x] locators/roles/selectors preferred over coordinates.

## W4 — Protocol integration

- [x] map capabilities/actions/observations to IAP; deadlines, cancellation, artifacts, policy/budget.
- [x] adapter (browser) crash vs target (page) failure distinguishable.

## W5 — Demonstration flow

- [x] `inspector run --adapter web` performs a deterministic traversal, emits artifacts, exits cleanly.

## Acceptance (all passing)

1. Adapter passes common conformance suite. → 7 web conformance tests.
2. No host mouse/keyboard required. → Playwright semantic actions only.
3. Reset returns target to identical seeded state. → conformance reset test.
4. Screenshot, semantic tree, console, network, trace correlate to run/step. → artifacts in observation.
5. Forbidden origin navigation rejected. → CAPABILITY_DENIED.
6. Adapter/browser crash classified separately from page crash. → adapter-crash vs target-failure.
7. Clean checkout executes seeded traversal headlessly. → `inspector run --adapter web` in CI.

Gate: M1 exit gate (autonomous headless traversal with replayable, ordered, evidence-rich trace and deterministic reset) satisfied.
