# Specification 005 — Android Adapter

## Status

PENDING

## Objective

Validate Inspector's platform-independent core against Android using dedicated emulator automation rather than host mouse/keyboard control.

## Dependencies

Specs 000–004 COMPLETE and an Android SDK/emulator environment available.

## Task groups

### A0 — Environment worker

Detect SDK/ADB, provision/select a dedicated emulator, define exclusive ownership, health checks, snapshot/reset, and cleanup.

### A1 — App lifecycle

Install/uninstall/reset package, launch/stop/restart, resolve activity/package, and capture process/device state.

### A2 — Sensors

Collect semantic UI hierarchy via modern UI Automator-compatible helper, screenshot, logcat, crash/ANR/process events, device metadata, and optional app-test fixture state.

### A3 — Actions

Implement semantic tap, text entry, press/back/home as appropriate, scroll/swipe, wait, and app lifecycle actions through the adapter contract. Coordinate actions are fallback only.

### A4 — Deterministic seeded target

Provide or integrate a small Android fixture app with resettable state and known hidden defects across lifecycle, persistence, navigation, and input boundaries.

### A5 — Fault/lifecycle injection

On disposable emulator/app state, support process kill/restart, network mode faults where practical, rotation/configuration changes, and interrupted persistence scenarios behind capabilities.

### A6 — Core pipeline proof

Run autonomous exploration, finding confirmation, minimization, and evidence generation through the unchanged core.

## Acceptance tests

- adapter passes common conformance;
- emulator actions do not require host mouse/keyboard;
- reset produces deterministic fixture state;
- app crash differs from adapter/ADB failure;
- lifecycle interruption can be reproduced from evidence;
- at least one seeded Android defect is autonomously discovered and confirmed through the common finding pipeline;
- no Android conditionals are introduced into core finding/oracle state semantics.

## Exit gate

Inspector proves cross-platform sensing/acting/finding/reproduction on Android with clean adapter boundaries.

## Blocker policy

If local emulator acceleration is unavailable, document the environment blocker and continue independent platform/spec work rather than weakening architecture.

## Completion transition

Set M5 COMPLETE, activate Spec 006/M6, and continue.
