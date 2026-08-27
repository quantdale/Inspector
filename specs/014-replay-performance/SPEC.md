# SPEC-014 — Replay Performance: Measured Optimization and Benchmark Guard

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M14
Depends on: M13 (SPEC-013)

## Objective

Close the `STILL_OPEN` web-exploration replay cost debt via measured
optimization. The StateFile fingerprint skip has already landed; this
milestone adds replay-phase driver-reuse measurement, persistent-driver
documentation, and a benchmark guard that prevents regression.

In scope is a reproducible baseline, an audited persistent-driver path
for replay, and a benchmark harness that fails CI on replay-cost
regression — not speculative engine rewrites.

## Invariants

- No behavior change: exploration outcomes, finding evidence, and oracle
  verdicts are byte-identical with and without the optimization enabled.
- Replay remains deterministic for a fixed seed/artifact set; StateFile
  fingerprint fast-path never skips a semantically distinct replay.
- No new flake: driver reuse does not leak state between replay sessions
  (storage, cookies, navigation, viewport) and cleans up on failure.
- No policy/evidence/budget/retry contract weakened to chase performance.

## Workstreams

### F0 — Baseline measurement

Capture a reproducible replay-cost baseline on the current tree: wall
time and driver-session count for a fixed web fixture suite (cold vs
warm fingerprint cache). Record methodology, machine profile, and raw
numbers in the spec appendix/checkpoint so F2 has a truthful comparator.
No code change beyond instrumentation required to collect the numbers.

### F1 — Persistent driver audit

Audit the existing persistent-driver / driver-reuse path used during
replay: lifecycle (create → reuse → teardown), isolation guarantees
between replay units, failure/crash cleanup, and interaction with the
StateFile fingerprint skip. Fix only correctness/isolation gaps; publish
a short decision note if reuse is unsafe for any replay class. Output is
an auditable driver-reuse contract, not a new browser engine.

### F2 — Benchmark guard

Add a lightweight benchmark harness that measures replay-phase cost
(driver sessions + wall time) for the fixture suite and fails when cost
regresses beyond an explicit threshold vs the F0 baseline. Deterministic,
CI-runnable without credentials, bounded runtime, stable output format.
Guard is advisory-to-blocking as configured; threshold lives in code.

### F3 — Docs

Update docs to describe the persistent-driver replay optimization, its
scope/limits, the benchmark guard and how to run it, and the measured
savings vs baseline. Reconcile README / ARCHITECTURE / EXPLORATION-ENGINE
/ campaign.yaml / CHECKPOINT.md / ROADMAP as needed.

## Exit gate

- Benchmark harness exists, is deterministic, and shows replay-phase
  savings vs the F0 baseline on the fixture suite (fewer driver sessions
  and/or lower wall time with identical outcomes).
- Full gate green on the exact final tree: lint (0 errors), typecheck
  PASS, unit PASS, integration PASS, `release:smoke` PASS.
- Docs updated (persistent-driver behavior, benchmark usage, measured
  results).
- M14 marked COMPLETE in durable state only after the gate truly passes.

## Non-goals

- Cloud control plane, distributed queues, hosted SaaS.
- Vision models, bespoke/fine-tuned models, vector DB / RAG.
- Reinforcement learning, scheduler/lease rewrite, campaign repair,
  deployment/publication, new browser engine, wholesale refactor.
