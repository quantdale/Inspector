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

## HARDENING CAMPAIGN #1 COMPLETE (2026-08-21)

- Campaign: **HARDENING_1 — COMPLETE**. Implementation campaign state untouched (`IMPLEMENTATION` / `COMPLETE`). Full ledger: `.inspector/state/HARDENING-CHECKPOINT.md`.
- Result: **66 defects confirmed and closed** (5 CRITICAL, 23 HIGH, 38 MEDIUM/LOW) across reliability, recovery, correctness, oracle quality, repair safety, concurrency, adapter robustness, security boundaries, and long-run stability. Zero unresolved Critical/High defects.
- Final gates at the hardening final commit: lint 0 errors (5 warnings); typecheck exit 0; unit **387 passed / 3 skipped** (28 files); integration **101 passed** (19 files, ~262s wall) — including the dogfood proof (6/6), soak (7/7), web torture/hardening (16/16), repair e2e (3/3), explore E2E (2/2), and all adapter conformance suites. Unit suite grew 63 → 387 over the campaign.
- Dogfood proof: Inspector explored its own seeded web app autonomously, discovered the `#boom` defect itself, confirmed it with intact evidence bundles, REJECTED a masking patch (which exposed and fixed H-65: masking-by-removal had been accepted), accepted a valid patch with regression-first proof, applied and replayed it clean on a fixture checkout, persisted RESOLVED state, and ran two more pipelines concurrently without cross-contamination.
- Soak: no material leak or corruption — exactly-once execution across 37 durable restart injections, fenced stale completions, stable RSS/handles/temp dirs, bounded SQLite/artifact growth.
- M8 remains DEFERRED_ENVIRONMENT (no macOS/Xcode runtime became available).
- Remaining debt and next recommended campaign (HARDENING_2: production adapter bindings, SQLite-backed leases, oracle-evaluation persistence, resumable exploration graphs) are recorded in `.inspector/state/campaign.yaml` (`hardening.deferred_debt`) and the hardening checkpoint.
