# Project Status

Last updated: 2026-08-20

## Campaign

- Mode: **IMPLEMENTATION**
- Campaign status: **ACTIVE**
- Working branch: `main`
- Hardening campaign: **NOT ACTIVE**

## Baseline

The architecture/documentation foundation was merged to `main` in PR #1 at commit `ac74afbcc3824acee457a5cc5b26956ea5c98562`. The M0 foundation kernel is now implemented and all M0 gates pass.

## Active work

- Milestone: `M0 — Foundation kernel` — **COMPLETE (gates passing)**
- Specification: `specs/000-foundation/SPEC.md`
- Task graph: `specs/000-foundation/TASKS.md` (F0–F8 all done)
- Next milestone: `M1 — Web sensing and acting` (`specs/001-web-adapter/SPEC.md`)

## Verified gates (M0)

| Waypoint | Gate | Result |
|---|---|---|
| F0 Workspace bootstrap | lint/typecheck/test/test:integration (empty) | PASS |
| F1 Protocol package | schema rejection fixtures | PASS |
| F2 SQLite durable store | kill/reopen order + unknown recovery | PASS |
| F3 Artifact store | deterministic hash + corruption detection | PASS |
| F4 Adapter SDK + fake adapter | conformance suite (spawned subprocess) | PASS |
| F5 Policy/budget engine | forbidden action never reaches adapter | PASS |
| F6 Core run manager | acceptance tests 1–5,7,8 | PASS |
| F7 CLI | non-interactive fake demonstration | PASS |
| F8 Docs/ADR sync | architecture + dev guide + ADR 0003 | DONE |

Total automated coverage: 27 unit + 18 integration tests across 7 packages.

## Known blockers

None currently known.

## Progress summary

| Milestone | State |
|---|---|
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | PENDING |
| M4 Oracle/repair | PENDING |
| M5 Android | PENDING |
| M6 Cross-platform adapters | PENDING |
| M7 Scale/integrations | PENDING |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
