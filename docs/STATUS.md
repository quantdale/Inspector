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

- Milestone: `M7 — Scale, integrations, and unattended operations` — **ACTIVE**
- Specification: `specs/007-scale-integrations/SPEC.md`
- Task graph: `specs/007-scale-integrations/TASKS.md` (to be created at M7 start)
- Next milestone after M7: `M8 — iOS` (environment-deferred)

## Verified gates (M6)

| Gate | Result |
| --- | --- |
| lint (0 errors) | PASS |
| typecheck (exit 0) | PASS |
| test (57 unit tests) | PASS |
| test:integration (44 integration tests, 11 files) | PASS |

M6 exit gate evidence: CLI/PTY, Electron, and Windows adapters all pass the common conformance contract (`runCommonConformance` in adapter-sdk) over spawned JSON-RPC subprocesses; each platform's seeded defect surfaces with correct TARGET_FAILURE/ACTION_FAILED classification; no platform branching in core finding semantics.

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
| M6 Cross-platform adapters | COMPLETE |
| M7 Scale/integrations | ACTIVE |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
