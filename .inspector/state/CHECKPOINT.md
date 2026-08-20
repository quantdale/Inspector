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
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Spec M1: `specs/001-web-adapter/SPEC.md` (status COMPLETE)
- Task graph M1: `specs/001-web-adapter/TASKS.md` (W0–W5 all checked)

M1 exit gate (Inspector autonomously traverses the seeded web target through typed IAP actions and records a replayable, ordered, evidence-rich trace with deterministic reset) is satisfied: the `web-playwright` adapter implements create/reset/close, semantic observation (url/title/UI tree/screenshot/console/network/storage/trace), semantic acting, capability/origin policy, and adapter-vs-target crash classification. 7 web conformance tests + the `inspector run --adapter web` demonstration pass.

## Next milestone

- Milestone: **M2 Finding, evidence, reproduction, minimization**
- Spec: `specs/002-finding-reproduction/SPEC.md`
- First waypoint: M2.F0 finding-reproduction-prep

## Exact next action

Begin M2: implement the finding lifecycle state machine, hard deterministic oracle detectors, clean reset/replay, reproduction thresholds, sequence minimization, and evidence bundle writer. Run the M2 exit gate (seeded defects become confirmed findings with minimized reproducers and replayable evidence; non-defects rejected).

Continue autonomously; do not stop at the M1/M2 boundary.

## Known blockers

None.

## Do not do yet

- Do not begin Playwright adapter work before M0 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
