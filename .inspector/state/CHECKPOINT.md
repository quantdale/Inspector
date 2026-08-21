# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M6 cross-platform adapters are COMPLETE. `@inspector/adapter-sdk` now carries the common conformance contract (`runCommonConformance`: version negotiation, deterministic baseline + reset, semantic uiTree, TARGET_FAILURE vs ACTION_FAILED classification). Three new packages satisfy it: `@inspector/cli-adapter` (injectable PtyBackend + seeded "seedcli" REPL; line-entry interaction model; process death -> TARGET_FAILURE, command-not-found -> ACTION_FAILED), `@inspector/electron-adapter` (deliberately reuses web Chromium semantics with Electron identity and injectable app content), and `@inspector/windows-adapter` (injectable UiaBackend + SeedBank Win32 dialog mock; invoke/setValue actions). No platform branching in core finding semantics.

M6 exit gate satisfied: all three adapters pass the common conformance contract over spawned JSON-RPC subprocesses, produce evidence in the same IAP schema, and keep platform logic inside adapter packages. All four gates green.

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Milestone: M2 Finding, evidence, reproduction, minimization — **COMPLETE**
- Milestone: M3 Autonomous exploration — **COMPLETE**
- Milestone: M4 Oracle expansion and autonomous repair — **COMPLETE**
- Milestone: M5 Android adapter — **COMPLETE**
- Milestone: M6 Cross-platform adapters — **COMPLETE**
- Spec M6: `specs/006-cross-platform/SPEC.md` (status COMPLETE)
- Task graph M6: `specs/006-cross-platform/TASKS.md` (C0–C3 all checked)

## Next milestone

- Milestone: **M7 Scale, integrations, and unattended operations**
- Spec: `specs/007-scale-integrations/SPEC.md`
- First waypoint: M7.S0 worker-orchestration

## Exact next action

Begin M7: create `specs/007-scale-integrations/TASKS.md`; implement `@inspector/scale` — isolated parallel workers with SQLite-backed leases, deterministic scheduling, finding dedup/clustering, model router + token/cost accounting, MCP facade exposing Inspector capabilities over JSON-RPC, crash-safe multi-run recovery, and plugin/adapter discovery. Run the M7 exit gate (bounded unattended campaign across >=2 isolated workers, controller-restart recovery, stable external control).

Continue autonomously; do not stop at the M6/M7 boundary.

## Known blockers

None.

## Known debt (recorded in campaign.yaml)

- Replay oracle still counts ACTION_FAILED target-failures as reproduction in the legacy TargetFailureOracle path; partially mitigated by OracleSuite.
- Web exploration E2E takes ~4–6 min wall clock; acceptable but flagged for later perf work.
- Real PTY/UIA/Electron-runtime bindings remain production hardening items; the injectable contracts are proven by mocks per spec blocker policy.

## Do not do yet

- Do not start iOS adapter implementation before M7 completion (M8 is environment-deferred).
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
