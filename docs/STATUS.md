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

- Milestone: `M6 — Cross-platform adapters (CLI, Electron, Windows)` — **ACTIVE**
- Specification: `specs/006-cross-platform/SPEC.md`
- Task graph: `specs/006-cross-platform/TASKS.md` (to be created at M6 start)
- Next milestone after M6: `M7 — Scale, integrations, and unattended operations` (`specs/007-scale-integrations/SPEC.md`)

## Verified gates (M5)

| Gate | Result |
| --- | --- |
| lint (0 errors) | PASS |
| typecheck (exit 0) | PASS |
| test (57 unit tests) | PASS |
| test:integration (38 integration tests, 8 files) | PASS |

M5 exit gate evidence: the Android adapter passes common conformance over a spawned JSON-RPC subprocess against the injectable ADB backend; reset produces deterministic fixture state; app crashes classify as TARGET_FAILURE vs automation misses as ACTION_FAILED; the unchanged core finding pipeline confirms two seeded Android defects.

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
| M5 Android | COMPLETE |
| M6 Cross-platform adapters | ACTIVE |
| M7 Scale/integrations | PENDING |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
