# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M0.F6.run-manager completed. The core run manager (`@inspector/core`) integrates policy, durable store, artifact store, and the adapter client. `RunManager.startRun` spawns the fake adapter over stdio, negotiates capabilities, and returns a `RunController`. `submitAction` enforces policy first (forbidden actions never reach the adapter), persists a pending action, requests the outcome, and transactionally commits the step; crashes/timeouts leave the action pending for recovery. `resumeRun` reopens durable state, marks in-flight actions `unknown`, and re-observes instead of blindly resubmitting. Acceptance tests 1–5, 7, 8 pass (happy-path ordered events, policy rejection, deterministic budget exhaustion, unknown-outcome no-duplicate restart, crash classification, artifact hash round-trip).

Verified implementation gates: **F0, F1, F2, F3, F4, F5, F6** (lint/typecheck/test/test:integration green; 42 tests across 6 files).

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Milestone: M2 Finding, evidence, reproduction, minimization — **COMPLETE**
- Spec M2: `specs/002-finding-reproduction/SPEC.md` (status COMPLETE)
- Task graph M2: `specs/002-finding-reproduction/TASKS.md` (R0–R6 all checked)

M2 exit gate (seeded defects produce confirmed, minimized, replayable evidence bundles with low/controlled false positives) is satisfied: `@inspector/finding` provides a durable finding lifecycle (status machine + store persistence), hard oracles (target-failure, page-error, explicit DEFECT_* signals), clean replay drivers, reproduction policy (CONFIRMED/FLAKY/REJECTED), delta-debugging minimization, evidence bundle, and regression export. 8 M2 unit tests pass.

## Next milestone

- Milestone: **M3 Autonomous exploration**
- Spec: `specs/003-autonomous-exploration/SPEC.md`
- First waypoint: M3.F0 autonomous-exploration-prep

## Exact next action

Begin M3: implement the exploration loop, state-delta observation, curious action selection, coverage/state-diversity heuristics, exploration budget, and reproducible trace linkage to findings. Run the M3 exit gate.

Continue autonomously; do not stop at the M2/M3 boundary.

## Known blockers

None.

## Do not do yet

- Do not begin Playwright adapter work before M0 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
