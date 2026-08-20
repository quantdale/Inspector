# Specification 002 — Finding, Evidence, Reproduction, and Minimization

## Status

COMPLETE (M2 exit gate satisfied; see `.inspector/state/campaign.yaml`)

## Objective

Turn anomalous runtime signals into trustworthy Inspector findings with reproducible evidence instead of treating every suspicion as a bug.

## Dependencies

Specs 000 and 001 COMPLETE.

## Task groups

### R0 — Finding lifecycle

Implement durable finding states, transitions, confidence, severity, source revision, oracle references, reproduction statistics, rejection/flaky reasons, and audit events.

### R1 — Hard oracles

Add deterministic detectors for unhandled crash, uncaught runtime error, failed invariant fixture, impossible HTTP/state condition, and explicit target test-oracle signals.

### R2 — Clean replay

Record action sequences, reset to clean fixture state, replay with deadlines, correlate all observations, and distinguish target/environment nondeterminism.

### R3 — Reproduction policy

Require configurable repeated success before `CONFIRMED`; classify inconsistent failures as `FLAKY` or keep `CANDIDATE`.

### R4 — Sequence minimization

Implement delta-debugging style action removal and input shrinking while preserving oracle failure. Persist original and minimized sequences.

### R5 — Evidence bundle

Produce a portable finding bundle containing metadata, revision, environment, minimized steps, oracle evidence, relevant screenshots/logs/network/trace refs, and replay command.

### R6 — Regression export

Export a deterministic regression scenario/test representation from a confirmed finding without yet repairing source.

## Acceptance tests

- seeded crash and state-corruption defects become `CONFIRMED` only after policy is met;
- seeded non-defect suspicion is rejected or remains candidate;
- minimized sequence is no longer than original and still reproduces;
- flaky seeded behavior is not mislabeled deterministic;
- evidence bundle can replay on a clean checkout/environment;
- state survives controller restart during reproduction.

## Exit gate

Multiple seeded web defects produce confirmed, minimized, replayable evidence bundles with low/controlled false positives.

## Non-goals

- autonomous discovery policy;
- LLM semantic oracle as sole confirmation;
- source repair.

## Completion transition

Set M2 COMPLETE, activate Spec 003/M3, and continue.
