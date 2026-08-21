# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M5 Android adapter is COMPLETE. `@inspector/android` implements the full IAP adapter contract against an injectable `AdbBackend` (production wrapper binds the adb CLI; `MockAdbBackend` simulates a dedicated device), with uiautomator XML parsing into the common semantic element model, semantic tap/text-entry/keyevent actions, screenshot/logcat sensors, package install/uninstall/reset lifecycle, injected device-loss faults, and the SeedDroid fixture app whose hidden defects mirror the web seeded app. Genuine app crashes classify as TARGET_FAILURE, automation misses as ACTION_FAILED — identical outcome semantics to the web adapter, with zero Android logic in core packages.

M5 exit gate satisfied: conformance passes over a spawned JSON-RPC subprocess; reset produces deterministic fixture state; the unchanged FindingEngine + AndroidReplayDriver confirm two seeded Android defects through the standard reproduction policy. All four gates green.

## Active waypoint

- Milestone: M0 Foundation kernel — **COMPLETE**
- Milestone: M1 Web sensing and acting — **COMPLETE**
- Milestone: M2 Finding, evidence, reproduction, minimization — **COMPLETE**
- Milestone: M3 Autonomous exploration — **COMPLETE**
- Milestone: M4 Oracle expansion and autonomous repair — **COMPLETE**
- Milestone: M5 Android adapter — **COMPLETE**
- Spec M5: `specs/005-android/SPEC.md` (status COMPLETE)
- Task graph M5: `specs/005-android/TASKS.md` (A0–A6 all checked)

## Next milestone

- Milestone: **M6 Cross-platform adapters (CLI, Electron, Windows)**
- Spec: `specs/006-cross-platform/SPEC.md`
- First waypoint: M6.C0 cli-pty-adapter

## Exact next action

Begin M6: create `specs/006-cross-platform/TASKS.md`; implement the CLI/PTY adapter against an injectable PTY backend, the Electron adapter reusing web semantics via an injectable renderer backend, and the Windows adapter via an injectable UI Automation backend — each passing the common conformance contract, producing evidence in the same schema, with no platform branching in core finding semantics. Run the M6 exit gate.

Continue autonomously; do not stop at the M5/M6 boundary.

## Known blockers

None.

## Known debt (recorded in campaign.yaml)

- Replay oracle still counts ACTION_FAILED target-failures as reproduction in the legacy TargetFailureOracle path; partially mitigated by OracleSuite.
- Web exploration E2E takes ~4–6 min wall clock; acceptable but flagged for later perf work.
- Real ADB CLI wrapper and emulator provisioning remain production hardening items; the injectable contract is proven by MockAdbBackend per spec blocker policy.

## Do not do yet

- Do not start iOS adapter work before M7 completion (M8 is environment-deferred).
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
