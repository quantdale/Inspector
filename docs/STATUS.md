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

- Milestone: `M5 — Android adapter` — **ACTIVE**
- Specification: `specs/005-android/SPEC.md`
- Task graph: `specs/005-android/TASKS.md` (to be created at M5 start)
- Next milestone after M5: `M6 — Cross-platform adapters` (`specs/006-cross-platform/SPEC.md`)

## Verified gates (M4)

| Gate | Result |
| --- | --- |
| lint (0 errors) | PASS |
| typecheck (exit 0) | PASS |
| test (57 unit tests) | PASS |
| test:integration (30 integration tests, 7 files) | PASS |

M4 exit gate evidence: a seeded defect completes the full autonomous DISCOVERED -> CONFIRMED -> PATCHING -> VERIFYING -> RESOLVED loop in an isolated git worktree; bad patches are rejected and rolled back with an audit trail; weak-suspicion findings are policy-blocked from repair; the primary checkout remains untouched.

## Known blockers

None currently known.

## Progress summary

| Milestone | State |
| --- | --- |
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | COMPLETE |
| M4 Oracle/repair | COMPLETE |
| M5 Android | ACTIVE |
| M6 Cross-platform adapters | PENDING |
| M7 Scale/integrations | PENDING |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
