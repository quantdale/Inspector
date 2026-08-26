# Runtime Efficiency Proof — Delta Specification

## ADDED Requirements

### Requirement: Performance changes are benchmark-gated
A performance optimization MUST have a reproducible baseline and before/after measurement on the same relevant fixture/seed/environment class before it is retained as an H5 optimization.

#### Scenario: Candidate optimization is evaluated
- GIVEN a suspected hot path such as web replay, SQLite preparation/aggregation, fingerprinting, temp sweeping, checkpointing, or CI setup
- WHEN an optimization is proposed
- THEN the campaign MUST record baseline command/fixture/seed/run count and timing/resource metrics
- AND MUST record the same metrics after the change
- AND MUST retain the change only when the improvement is material enough to justify its complexity and no correctness contract regresses.

### Requirement: Speculative H4 performance work is not bulk-applied
The preserved unlanded H4 performance patch MUST be treated only as a set of hypotheses. Each idea MUST be independently understood, benchmarked, tested, and either reimplemented/cherry-picked narrowly or rejected.

#### Scenario: Old patch contains multiple optimizations
- GIVEN an old patch combines caching, aggregation, fingerprint, sweep, checkpoint, or CI changes
- WHEN H5 evaluates it
- THEN no bulk apply/merge is permitted
- AND each retained idea MUST have its own evidence and regression coverage.

### Requirement: Performance must not weaken recovery or evidence
An optimization MUST NOT remove or weaken cancellation, budget admission, lease fencing, checkpoint/restart continuity, finding/evidence determinism, clean-runner dependency correctness, or failure visibility solely to improve timing.

#### Scenario: Checkpoint frequency is reduced
- GIVEN profiling shows checkpoint serialization cost is significant
- WHEN a lower checkpoint frequency/coalescing strategy is considered
- THEN crash injection MUST cover the enlarged uncheckpointed window
- AND resumed action/reset/finding/wall budgets, RNG/graph state, findings, evidence, and replay outcome MUST remain equivalent within the declared recovery contract
- OR the optimization MUST be rejected.

### Requirement: Web replay cost is characterized
The existing expensive web exploration/replay path MUST have a current measured cost breakdown before H5 completion, even if no safe optimization is ultimately retained.

#### Scenario: No safe speedup is found
- GIVEN profiling identifies no optimization that is both material and contract-safe
- WHEN H5 completes
- THEN the campaign MAY retain the existing implementation
- BUT MUST record measured evidence, rejected hypotheses, and the remaining debt explicitly rather than claiming performance was solved.
