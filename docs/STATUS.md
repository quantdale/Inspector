# Project Status

Last updated: 2026-08-20

## Campaign

- Mode: **IMPLEMENTATION**
- Campaign status: **ACTIVE**
- Working branch: `main`
- Hardening campaign: **NOT ACTIVE**

## Baseline

The architecture/documentation foundation was merged to `main` in PR #1 at commit `ac74afbcc3824acee457a5cc5b26956ea5c98562`. All implementation work since has been committed directly to `main`.

## Active work

- Milestone: `M4 — Oracle expansion and autonomous repair` — **ACTIVE**
- Specification: `specs/004-oracle-repair/SPEC.md`
- Task graph: `specs/004-oracle-repair/TASKS.md` (to be created at M4 start)
- Next milestone after M4: `M5 — Android adapter` (`specs/005-android/SPEC.md`)

## Verified gates (M3)

| Gate | Result |
| --- | --- |
| lint (0 errors) | PASS |
| typecheck (exit 0) | PASS |
| test (51 unit tests) | PASS |
| test:integration (27 integration tests, real Chromium) | PASS |

M3 exit gate evidence: the autonomous hunt discovers and confirms 3 distinct hidden seeded web defects (login validation crash, boom crash, increment overflow) with minimized reproducers and evidence bundles on fresh environments; identical seeds produce identical anomaly classKey sets.

## Known blockers

None currently known.

## Progress summary

| Milestone | State |
| --- | --- |
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | COMPLETE |
| M4 Oracle/repair | ACTIVE |
| M5 Android | PENDING |
| M6 Cross-platform adapters | PENDING |
| M7 Scale/integrations | PENDING |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
