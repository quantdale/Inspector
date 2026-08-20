# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `implementation/autonomous-campaign`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M0.F6.run-manager completed. The core run manager (`@inspector/core`) integrates policy, durable store, artifact store, and the adapter client. `RunManager.startRun` spawns the fake adapter over stdio, negotiates capabilities, and returns a `RunController`. `submitAction` enforces policy first (forbidden actions never reach the adapter), persists a pending action, requests the outcome, and transactionally commits the step; crashes/timeouts leave the action pending for recovery. `resumeRun` reopens durable state, marks in-flight actions `unknown`, and re-observes instead of blindly resubmitting. Acceptance tests 1–5, 7, 8 pass (happy-path ordered events, policy rejection, deterministic budget exhaustion, unknown-outcome no-duplicate restart, crash classification, artifact hash round-trip).

Verified implementation gates: **F0, F1, F2, F3, F4, F5, F6** (lint/typecheck/test/test:integration green; 42 tests across 6 files).

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Spec: `specs/000-foundation/SPEC.md` (status COMPLETE)
- Task graph: `specs/000-foundation/TASKS.md` (F0–F8 all checked)

M0 exit gate (deterministic fake environment executes typed observe/act loops, persists ordered events, survives crash/restart, classifies unknown outcomes, passes acceptance tests) is satisfied by the F0–F7 waypoint gates and 45 automated tests.

## Next milestone

- Milestone: **M1 Web sensing and acting**
- Spec: `specs/001-web-adapter/SPEC.md`
- First waypoint: M1.F0 web-adapter-prep

## Exact next action

Begin M1: implement the Playwright/Chromium environment lifecycle, semantic observation (accessibility/UI tree, screenshots, console, network), and conformance against the adapter SDK. Run the M1 exit gate (headless traversal of a seeded app with a complete replayable observation/action trace, conformance passing).

Continue autonomously; do not stop at the M0/M1 boundary.

## Known blockers

None.

## Do not do yet

- Do not begin Playwright adapter work before M0 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
