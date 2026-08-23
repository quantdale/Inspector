# Autonomy Model

Inspector separates autonomy into explicit capabilities. A run policy grants only the capabilities needed for that run.

## Capability tiers

### Tier 0 — Observe

Read-only sensors: screenshot, UI tree, DOM/accessibility, logs, traces, network metadata, process status, coverage, database read snapshots.

### Tier 1 — Interact

Act inside an isolated target environment: click, type, swipe, navigate, keyboard input to a PTY, app launch/restart, browser reload.

### Tier 2 — Mutate test state

Reset app data, restore fixtures, modify test database, inject clock/seed, toggle network faults, kill target processes, corrupt disposable test files.

### Tier 3 — Modify source

Create worktree, edit files, install approved dependencies, run build/test tooling.

### Tier 4 — Publish

Create commits, push branches, open PRs, or interact with external issue trackers. This tier is never implied by repair permission.

Production deployment is intentionally outside the default model.

## Run budgets

Every run may bound:

- wall-clock duration
- model requests/tokens/cost
- adapter actions
- state resets
- process kills
- disk bytes
- screenshots/trace bytes
- concurrent environments
- repair attempts per finding
- total source diff size

Budget exhaustion ends or degrades the run deterministically.

## Control loop

```text
checkpoint
  -> observe
  -> update state model
  -> generate candidate actions
  -> policy filter
  -> score actions
  -> execute
  -> collect synchronized observations
  -> evaluate oracles/anomalies
  -> persist
  -> checkpoint
  -> repeat
```

A model may propose actions, but the core chooses from validated candidates after policy checks.

## Crash recovery

A run is resumable only if Inspector can distinguish:

- committed durable step
- in-flight action with unknown outcome
- adapter lost
- environment lost
- process lost
- model call lost

Retryable actions require idempotency semantics. Non-idempotent actions with unknown outcomes trigger re-observation or environment reset rather than blind replay.

Autonomous hunts add a versioned exploration checkpoint beside the generic
low-level run checkpoint. The durable action/step log is authoritative when a
controller dies between a committed action and the explorer snapshot: the
explorer restores the PRNG draw state, graph, recency/toxic/rejected keys,
native tried edges, and finding classes, then reconciles committed metadata
without resubmitting an unknown action. A lagging checkpoint may preserve an
edge with an unknown target until the next authoritative observation; it never
reuses a step sequence or silently starts a fresh campaign with the same run.

Campaign wall-clock budget is measured from the durable campaign creation time,
including controller downtime. This conservative semantic prevents repeated
restart from granting free exploration time. Action, reset, and finding caps
are derived from durable admissions/lifecycle records and the versioned
campaign checkpoint. Checkpoint payloads are checksummed, validated against run,
adapter, explorer, seed, and configuration identity, and retained in a bounded
latest-checkpoint window.

## Repair loop

Repair is a separate state machine:

```text
CONFIRMED
 -> prepare exact-revision worktree
 -> derive regression test/reproducer
 -> diagnose
 -> patch
 -> build
 -> replay minimized sequence
 -> run impact-aware regression set
 -> static gates
 -> RESOLVED or PATCH_FAILED
```

Inspector should prefer generating a failing regression test before source edits where feasible.

## Stop policies

A hunt may stop on:

- budget exhausted
- repeated environment instability
- no meaningful state novelty for N iterations
- finding quota reached
- human stop request
- policy violation
- target revision changed unexpectedly

"Until clean" must therefore mean "until the configured cleanliness/novelty threshold and budget are satisfied," not an impossible proof that no defects exist.
