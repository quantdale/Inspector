# Specification 003 — Autonomous Exploration Engine

## Status

PENDING

## Objective

Enable Inspector to discover defects without a predefined scripted path by building and exploiting an application state/action model.

## Dependencies

Specs 000–002 COMPLETE.

## Task groups

### E0 — State model

Create normalized state fingerprints from semantic UI structure, route/location, selected persisted-state summaries, and runtime signals. Store an evolving state/action graph.

### E1 — Action inventory

Generate legal candidate actions from adapter capabilities and semantic elements. Attach preconditions, risk class, novelty metadata, and budget cost.

### E2 — Exploration scoring

Score actions/transitions using novelty, unvisited edges, recent code/change hints, error proximity, boundary value opportunity, state rarity, and cycle penalties.

### E3 — Stateful/adversarial inputs

Generate bounded text/numeric/date/collection boundary cases and meaningful multi-step sequences. Keep generation deterministic/replayable via seeds.

### E4 — Fault injection

For disposable targets, add bounded network failure/latency, reload/process interruption, storage reset/corruption fixtures, and lifecycle disturbances behind explicit capabilities.

### E5 — Planner fallback

Allow an LLM planner to propose goals/actions when deterministic exploration stalls. Planner suggestions pass through the same policy/action validation and are never direct side effects.

### E6 — Coverage/change guidance

When source instrumentation is available, ingest lightweight coverage/change-risk signals as prioritization hints without making coverage the sole objective.

### E7 — Campaign controller

Implement bounded hunt sessions with action/time/model/artifact budgets, novelty plateau detection, checkpointing, and resumable exploration graph.

## Acceptance tests

- deterministic seed reproduces an exploration path;
- cycle avoidance prevents trivial navigation loops;
- budgets terminate campaigns cleanly;
- fault injection cannot run without disposable-environment capability;
- planner cannot bypass allowed action inventory;
- Inspector discovers multiple hidden seeded defects not encoded as scripted tests;
- confirmed findings still pass Spec 002 reproduction requirements.

## Exit gate

A bounded autonomous hunt discovers and confirms several hidden seeded web defects with reproducible evidence and no host input hijacking.

## Completion transition

Set M3 COMPLETE, activate Spec 004/M4, and continue.
