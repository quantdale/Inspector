# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: **COMPLETE**
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M7 scale/integrations is COMPLETE. `@inspector/scale` provides durable exclusive leases with TTL reclaim, a deterministic priority scheduler over bounded workers, per-item isolated environments, a resource ledger with deterministic global/per-worker budgets, a provider-neutral model router with fallback/escalation, finding clustering with provenance preservation, an MCP-compatible read-only facade with cooperative stop, and adapter registration/discovery with protocol compatibility matrix. The S8 proving campaign runs two isolated workers over four bounded items, injects controller restart, verifies no duplicate execution or cross-worker contamination, and produces a consolidated report.

M7 exit gate satisfied: bounded multi-worker unattended campaign survives controller restart, preserves durable evidence/state, accounts for resources, exposes a stable integration facade.

## Milestone summary

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 Foundation kernel | COMPLETE | fake adapter executes typed loops, crash/restart recovery |
| M1 Web sensing/acting | COMPLETE | Playwright adapter + seeded web app conformance |
| M2 Finding/reproduction | COMPLETE | confirmed/minimized/replayable evidence bundles |
| M3 Autonomous exploration | COMPLETE | 3 hidden defects discovered deterministically |
| M4 Oracle/repair | COMPLETE | full DISCOVERED→CONFIRMED→PATCHING→VERIFYING→RESOLVED loop in isolated worktree |
| M5 Android adapter | COMPLETE | mock ADB conformance + 2 defects confirmed via core pipeline |
| M6 Cross-platform adapters | COMPLETE | CLI/Electron/Windows pass common conformance |
| M7 Scale/unattended ops | COMPLETE | 2-worker campaign survives restart; facade stable |
| M8 iOS | DEFERRED_ENVIRONMENT | no macOS/Xcode/simulator runtime; interfaces fully specified |

Final gates at M7 checkpoint: **lint (0 errors), typecheck (exit 0), test (63 unit), test:integration (47 integration across 12 files)** — all green.

## Known debt (recorded in campaign.yaml)

- Legacy TargetFailureOracle counts ACTION_FAILED target-failures as reproduction; partially mitigated by OracleSuite.
- Web exploration E2E takes ~4–6 min wall clock.
- Production bindings (PTY/UIA/Electron runtime/ADB CLI/emulator) remain hardening items; injectable contracts proven by mocks.

## Resumption notes

- Hardening campaigns are separately invoked (`docs/HARDENING-CAMPAIGN.md`).
- M8 resumption requires a macOS worker with Xcode/iOS Simulator; entry point is an `IosSimulatorBackend` behind the established injectable-backend pattern plus `runCommonConformance`.
