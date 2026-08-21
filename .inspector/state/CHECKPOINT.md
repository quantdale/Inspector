# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M4 oracle expansion and autonomous repair is COMPLETE. `@inspector/oracle` provides the composable OracleSuite (invariant/persistence/structural candidate oracles + metamorphic relations) with strength/confidence metadata and auditable verdicts, plus weak-suspicion handling: uncorroborated llm/vision/heuristic signals are held at NEEDS_HUMAN_ORACLE regardless of self-reported confidence. `@inspector/repair` provides exact-revision git worktree isolation (dirty-repo refusal, rollback, dispose), hint-ranked byte-bounded source context, regression-first repair (failing scenario materialized and proven pre-patch), a bounded PatchAgent contract with deterministic ScriptedPatchAgent, verification by exact replay + benign-flow masking probe + post-patch regression gate, and RESOLVED only when all gates pass — rejected patches rolled back and preserved in the audit trail.

M4 exit gate satisfied: a seeded defect completes the full autonomous DISCOVERED -> CONFIRMED -> PATCHING -> VERIFYING -> RESOLVED loop without manual debugging; bad patches are automatically rejected/rolled back; weak-suspicion findings are policy-blocked from repair; the primary checkout stays untouched. All four gates green (lint 0 errors; typecheck exit 0; 57 unit tests; 30 integration tests across 7 files).

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Milestone: M2 Finding, evidence, reproduction, minimization — **COMPLETE**
- Milestone: M3 Autonomous exploration — **COMPLETE**
- Milestone: M4 Oracle expansion and autonomous repair — **COMPLETE**
- Spec M4: `specs/004-oracle-repair/SPEC.md` (status COMPLETE)
- Task graph M4: `specs/004-oracle-repair/TASKS.md` (O0–O1, P0–P5 all checked)

## Next milestone

- Milestone: **M5 Android adapter**
- Spec: `specs/005-android/SPEC.md`
- First waypoint: M5.A0 adb-lifecycle

## Exact next action

Begin M5: create `specs/005-android/TASKS.md`, implement `@inspector/android` — ADB environment lifecycle against an injectable/mock ADB backend, UI Automator helper producing a semantic UI tree, screenshots and semantic actions, emulator state fixtures/snapshots, and a seeded Android target app. Conformance must run without real hardware/emulator. Run the M5 exit gate.

Continue autonomously; do not stop at the M4/M5 boundary.

## Known blockers

None.

## Known debt (recorded in campaign.yaml)

- Replay oracle still counts ACTION_FAILED target-failures as reproduction in the legacy TargetFailureOracle path; partially mitigated by OracleSuite.
- Web exploration E2E takes ~4–6 min wall clock; acceptable but flagged for later perf work.

## Do not do yet

- Do not start iOS adapter work before M6/M7 completion (M8 is environment-deferred).
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
