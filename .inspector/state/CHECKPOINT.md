# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M3 autonomous exploration is COMPLETE. `@inspector/explore` provides the state/action graph with semantic fingerprints, capability-bounded action inventory, curiosity scoring (novelty/unvisited-edge/boundary/rarity/cycle-penalty), deterministic boundary + sequence input generation, capability-gated fault injection, inventory-bound planner fallback, and the `ExploreController` campaign loop (action/wall/reset/finding budgets, plateau resets, anomaly detection wired into every step, adapter-error recovery via reset + hazard blacklist, post-run reproduce → minimize → confirm against fresh environments).

M3 exit gate satisfied: a bounded autonomous hunt discovers and confirms 3 distinct hidden seeded web defects (login validation crash, boom crash, increment overflow) that are not encoded as scripted tests, each reproduced on fresh Chromium instances with minimized reproducers and evidence bundles; identical seeds produce identical anomaly classKey sets. `pnpm test:integration` 27/27 green.

Verified implementation gates at M3 checkpoint: **lint (0 errors), typecheck (exit 0), test (51 unit), test:integration (27 integration)** all green.

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Milestone: M2 Finding, evidence, reproduction, minimization — **COMPLETE**
- Milestone: M3 Autonomous exploration — **COMPLETE**
- Spec M3: `specs/003-autonomous-exploration/SPEC.md` (status COMPLETE)
- Task graph M3: `specs/003-autonomous-exploration/TASKS.md` (E0–E5, E7 checked; E6 deferred by design — no source instrumentation for black-box web target)

## Next milestone

- Milestone: **M4 Oracle expansion and autonomous repair**
- Spec: `specs/004-oracle-repair/SPEC.md`
- First waypoint: M4.O0 oracle-sdk

## Exact next action

Begin M4: create `specs/004-oracle-repair/TASKS.md`, implement `@inspector/oracle` (composable invariant/metamorphic/structural oracles with strength/confidence) and `@inspector/repair` (exact-revision git worktree isolation, evidence-before-patch invariant, regression-first repair, verify-by-replay, rejected-patch rollback), then run the M4 exit gate (one seeded defect completes DISCOVERED → CONFIRMED → PATCHING → VERIFYING → RESOLVED without manual debugging).

Continue autonomously; do not stop at the M3/M4 boundary.

## Known blockers

None.

## Known debt (recorded in campaign.yaml)

- Replay oracle is loose (`TargetFailureOracle` counts ACTION_FAILED target-failures as reproduction); tighten during M4 oracle work.
- Web exploration E2E takes ~4–6 min wall clock; acceptable but flagged for later perf work.

## Do not do yet

- Do not start Android/iOS/CLI/Electron/Windows adapter work before M4 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
