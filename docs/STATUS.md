# Project Status

Last initialized: 2026-08-20

## Campaign

- Mode: **IMPLEMENTATION**
- Campaign status: **ACTIVE / READY**
- Working branch: `implementation/autonomous-campaign`
- Hardening campaign: **NOT ACTIVE**

## Baseline

The architecture/documentation foundation was merged to `main` in PR #1 at commit `ac74afbcc3824acee457a5cc5b26956ea5c98562`.

At campaign initialization there is **no implementation code yet** for the TypeScript workspace/packages described by Specification 000. Documentation presence must not be interpreted as implementation completion.

## Active work

- Milestone: `M0 — Foundation kernel`
- Specification: `specs/000-foundation/SPEC.md`
- Task graph: `specs/000-foundation/TASKS.md`
- Active task group: `F0 — Workspace bootstrap`
- Current waypoint: `M0.F0.workspace`
- State: `READY`

## Next action

Initialize the pnpm/TypeScript workspace and package skeletons required by Spec 000, add root lint/typecheck/test/CI scaffolding, then run the F0 gate.

Do not begin Playwright implementation until M0 exits successfully.

## Verified gates

None yet for implementation code.

## Known blockers

None currently known.

## Progress summary

| Milestone | State |
|---|---|
| M0 Foundation | ACTIVE |
| M1 Web adapter | PENDING |
| M2 Finding/reproduction | PENDING |
| M3 Autonomous exploration | PENDING |
| M4 Oracle/repair | PENDING |
| M5 Android | PENDING |
| M6 Cross-platform adapters | PENDING |
| M7 Scale/integrations | PENDING |
| M8 iOS | PENDING / environment-dependent |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
