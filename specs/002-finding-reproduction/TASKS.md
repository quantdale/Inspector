# Specification 002 — Task Graph

## R0 — Finding lifecycle

- [x] Durable finding states, transitions, confidence, severity, revision, oracle refs, reproduction stats.
- [x] Reject invalid transitions; persist findings to the durable store.

## R1 — Hard oracles

- [x] Detectors for unhandled crash (PAGE_ERROR), uncaught runtime error (target-failure), explicit DEFECT_* signals, impossible state.
- [x] Oracle engine aggregates reproduction verdict.

## R2 — Clean replay

- [x] Replay action sequences against a fresh environment; correlate outcomes/signals per attempt.

## R3 — Reproduction policy

- [x] Require N repeated successes before CONFIRMED; inconsistent -> FLAKY; never -> REJECTED.

## R4 — Sequence minimization

- [x] Delta-debugging action removal preserving oracle failure; persist original + minimized.

## R5 — Evidence bundle

- [x] Portable bundle: metadata, revision, environment, minimized steps, oracle evidence, artifact refs, replay command.

## R6 — Regression export

- [x] Deterministic regression scenario representation from a confirmed finding (no source repair).

## Acceptance (all passing)

- seeded crash/state-corruption defects CONFIRMED only after policy met.
- non-defect suspicion REJECTED.
- minimized sequence <= original and still reproduces.
- flaky behavior not mislabeled deterministic (FLAKY).
- evidence bundle replays on a clean environment (fresh driver per replay).
- finding state survives controller restart (durable store).

Gate: M2 exit gate (multiple seeded defects produce confirmed, minimized, replayable evidence bundles with low false positives) satisfied.
