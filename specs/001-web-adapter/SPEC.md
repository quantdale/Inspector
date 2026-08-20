# Specification 001 — Web Adapter

## Status

COMPLETE (M1 exit gate satisfied; see `.inspector/state/campaign.yaml`)

## Objective

Implement the first real Inspector environment adapter using Playwright/Chromium so the core can observe and interact with a live web application headlessly and reproducibly.

## Dependencies

- Spec 000 COMPLETE.
- Stable IAP adapter protocol/conformance harness.
- Artifact store and run persistence operational.

## Required behaviors

### W0 — Seeded target

Create a small deterministic web fixture application containing known but initially hidden defects spanning crash, state, validation, navigation, and persistence behavior. Provide reset/seed hooks available only in test mode.

### W1 — Environment lifecycle

Implement create/reset/close, isolated browser context, origin restrictions, deterministic viewport/timezone/locale where practical, and cleanup after crash.

### W2 — Sensing

Expose structured observations for:

- URL/title;
- semantic/accessibility interactive inventory;
- screenshot artifact;
- console/page errors;
- network event metadata with secret/body redaction policy;
- storage/cookie metadata where permitted;
- Playwright trace reference.

### W3 — Acting

Implement semantic click, fill, press, select, navigation, back/forward, reload, wait, and safe evaluation hooks required by deterministic fixtures. Prefer locators/roles/test IDs over coordinates.

### W4 — Protocol integration

Map all capabilities/actions/observations to IAP types, deadlines, cancellation, artifacts, policy and budget accounting. Adapter failure and target failure must remain distinguishable.

### W5 — Demonstration flow

Provide a non-interactive CLI path that starts the seeded target, creates an Inspector run, performs a deterministic traversal, emits artifacts, and exits cleanly.

## Acceptance tests

1. Adapter passes common conformance suite.
2. No host mouse/keyboard control is required.
3. Reset returns the target to identical seeded state.
4. Screenshot, semantic tree, console errors, network events, and trace artifacts correlate to one run/step sequence.
5. Forbidden origin navigation is rejected by policy.
6. Adapter/browser crash is classified separately from page/application crash.
7. A clean checkout can execute the seeded traversal in CI/headless mode.

## Exit gate

Inspector autonomously traverses the seeded web target through typed IAP actions and records a replayable, ordered, evidence-rich trace with deterministic reset.

## Non-goals

- bug confirmation/minimization;
- LLM-driven exploration;
- source repair;
- Firefox/WebKit parity beyond interfaces required to avoid Chromium lock-in.

## Completion transition

Set M1 COMPLETE, activate Spec 002/M2, persist verified revision/gates, and continue.
