# Specification 003 — Task Graph

## E0 — State model

- [x] Normalized state/screen fingerprints from semantic UI structure, visible control set, field values, and storage keys.
- [x] Evolving state/action graph (`StateGraph`) with visit counts and edge recording.

## E1 — Action inventory

- [x] Legal candidate actions generated from adapter capabilities and visible semantic elements only.
- [x] Risk class, action key (dedup), boundary flags, and priority attached to every candidate.

## E2 — Exploration scoring

- [x] Novelty, unvisited-edge, boundary-value, screen-rarity, and cycle-penalty weights combined in `scoreAction`.
- [x] Deterministic tie-breaking via seeded PRNG over the top-scored set.

## E3 — Stateful/adversarial inputs

- [x] Bounded deterministic boundary values (empty, long, sentinel "CRASH", markup, numeric) per field.
- [x] Multi-step sequence candidates (repeat lengths 2/3/5/8/12) for accumulation/overflow probing; all seeded and replayable.

## E4 — Fault injection

- [x] Fault candidates gated behind explicit enable + disposable-environment + capability checks (`FaultController`).
- [x] Adapter-side fault actions (crash/reload/storageReset) validated against capability list.

## E5 — Planner fallback

- [x] `NoopPlanner` default; planner proposals resolve only to legal inventory members (`InventoryBoundPlanner`), never direct side effects.

## E6 — Coverage/change guidance

- Deferred by design: no source instrumentation exists for the black-box web target; scoring accepts external weight hints as the extension point.

## E7 — Campaign controller

- [x] `ExploreController`: action/wall/reset/finding budgets, novelty plateau detection with reset, cycle avoidance window.
- [x] Anomaly detection wired into the step loop (TARGET_FAILURE crashes + impossible-state); automation misses (ACTION_FAILED) never filed as defects.
- [x] Post-run reproduce → minimize → confirm pipeline against fresh environments; findings re-confirmed after successful minimization.
- [x] Environment-loss recovery: adapter errors reset the campaign and blacklist the hazard instead of terminating; unknown outcomes are never blindly retried.

## Acceptance (all passing)

- deterministic seed reproduces an exploration path (identical anomaly classKey sets across runs);
- cycle avoidance prevents trivial navigation loops;
- budgets terminate campaigns cleanly (action-budget/wall-budget/finding-cap/no-candidates);
- fault injection cannot run without disposable-environment capability;
- planner cannot bypass allowed action inventory;
- Inspector discovers multiple hidden seeded defects not encoded as scripted tests (3 distinct classes: login validation crash, boom crash, increment overflow);
- confirmed findings pass Spec 002 reproduction requirements (reproduce + minimize + evidence bundle on fresh drivers).

Gate: M3 exit gate satisfied — bounded autonomous hunt discovers and confirms several hidden seeded web defects with reproducible evidence and no host input hijacking (`pnpm test:integration` 27/27 green).
