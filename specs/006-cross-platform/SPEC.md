# Specification 006 — CLI, Electron, and Windows Adapters

## Status

COMPLETE

## Objective

Stress the adapter/evidence model against terminal, hybrid desktop, and native desktop applications.

## Dependencies

Specs 000–005 COMPLETE unless an adapter subphase can proceed independently without compromising campaign order.

## Subphase C — CLI/PTTY adapter

Required:

- isolated subprocess/PTY lifecycle;
- stdout/stderr/exit/signal observations;
- structured command/input actions;
- terminal screen snapshot where needed;
- timeouts/cancellation;
- seeded CLI target with interactive/stateful defects;
- deterministic replay and evidence bundle integration.

Gate: seeded CLI defect is discovered/confirmed through common finding semantics.

## Subphase E — Electron adapter

Required:

- app process lifecycle;
- Playwright/CDP-compatible renderer sensing where supported;
- main-process logs/crashes;
- window inventory;
- semantic actions without physical mouse;
- seeded Electron target;
- reuse web adapter components only behind explicit composition interfaces.

Gate: renderer and main-process seeded defects can be distinguished, reproduced, and evidenced.

## Subphase W — Windows native adapter

Required:

- isolated/session-safe process control;
- Windows UI Automation/Appium-compatible semantic tree/actions;
- window/process/crash/log observations;
- no default host mouse/keyboard injection;
- seeded native Windows target;
- documented isolation limitations and capability policy.

Gate: seeded native defect is discovered/confirmed without core platform branching.

## Common acceptance tests

- all adapters pass common protocol/conformance tests;
- same finding/evidence schema works across platforms;
- platform-specific artifacts are additive, not required by core semantics;
- cancellation/deadlines/environment failure classification remain consistent;
- each adapter provides a deterministic seeded demonstration.

## Exit gate

CLI, Electron, and Windows native adapters each prove the common Inspector control/evidence pipeline.

## Completion transition

Set M6 COMPLETE, activate Spec 007/M7, and continue.
