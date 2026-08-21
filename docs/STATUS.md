# Project Status

Last updated: 2026-08-20

## Campaign

- Mode: **IMPLEMENTATION**
- Campaign status: **COMPLETE**
- Working branch: `main`
- Hardening campaign: **NOT ACTIVE** (separately invoked)

## Active work

None — the implementation campaign M0–M7 is complete. M8 (iOS) is `DEFERRED_ENVIRONMENT` (no macOS/Xcode/simulator runtime; adapter interfaces and remote-worker contract fully specified; resumption requirements recorded in `specs/008-ios/SPEC.md`).

## Verified gates (M7, final)

| Gate | Result |
| --- | --- |
| lint (0 errors) | PASS |
| typecheck (exit 0) | PASS |
| test (63 unit tests) | PASS |
| test:integration (47 integration tests, 12 files) | PASS |

M7 exit gate evidence: a bounded two-worker unattended campaign survives controller restart without duplicating completed work, preserves durable evidence/state in atomic state files, enforces deterministic global/per-worker budgets, clusters duplicate findings with provenance, and exposes an MCP-compatible read-only facade.

## Known blockers

None.

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
| M7 Scale/integrations | COMPLETE |
| M8 iOS | DEFERRED_ENVIRONMENT |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
