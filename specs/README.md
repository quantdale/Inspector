# Inspector Specification Lifecycle

Specifications are executable contracts for the autonomous implementation campaign.

## Active specification

The active spec is named in `.inspector/state/campaign.yaml`. Do not choose a spec based only on directory ordering.

## Required sections

Every implementation spec must define:

- status;
- objective;
- dependencies;
- required behaviors/deliverables;
- invariants;
- task graph/waypoints;
- acceptance tests;
- quality/exit gate;
- non-goals;
- durable-state transition on completion.

## Status values

```text
PENDING
ACTIVE
COMPLETE
BLOCKED
SUPERSEDED
```

Only one primary implementation spec should normally be `ACTIVE`.

## Completion rule

A spec is `COMPLETE` only when all required acceptance tests and its exit gate pass at a known revision. Update campaign state and checkpoint in the same change when practical.

## Next-spec rule

After a spec completes, activate the next roadmap spec and continue. If detailed tasks need refinement, the agent may refine them before implementation without requesting routine approval, provided roadmap/product/architecture contracts are preserved.

## Seeded campaign specs

- `000-foundation` — core protocol/durability/fake adapter/CLI skeleton
- `001-web-adapter` — Playwright senses/hands
- `002-finding-reproduction` — finding/evidence/reproducer/minimizer
- `003-autonomous-exploration` — state model and intelligent exploration
- `004-oracle-repair` — oracle expansion and repair loop
- `005-android` — Android/ADB/UI Automator adapter
- `006-cross-platform` — CLI target, Electron, Windows native adapters
- `007-scale-integrations` — concurrency, routing, orchestration, MCP facade
- `008-ios` — environment-dependent iOS simulator adapter

Broad hardening work is not an automatically activated specification; see `docs/HARDENING-CAMPAIGN.md`.
