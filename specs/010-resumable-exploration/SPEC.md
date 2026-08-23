# SPEC-010 — Resumable Exploration Campaigns

Status: COMPLETE (2026-08-23)
Milestone: M10
Depends on: SPEC-003 E7, SPEC-009

## Objective

An autonomous Inspector hunt survives controller or host process death and
continues from durable state without forgetting explored states/edges, resetting
its effective budgets, repeating unsafe or exhausted work, corrupting finding
provenance, or silently changing its deterministic decision stream.

The existing `runs resume` operation remains a diagnostic environment
reattachment. M10 adds `hunt --resume <runId>` for continuation of the
autonomous campaign itself.

## Architecture decision

Exploration state is owned by a dedicated SQLite campaign/checkpoint stream,
not by the low-level `checkpoints` payload used by `RunController` to recover
step sequence numbers. A campaign row stores the immutable explorer family,
version, adapter identity, and original configuration. Versioned full snapshots
are retained with bounded history and include a checksum. Small durable
exploration events record reset attempts because resets have a budget cost even
when a process dies before the next full checkpoint.

The low-level action/step log remains authoritative for admitted actions and
monotonic step sequences. Action metadata records the semantic action key and
state-before descriptor needed to reconcile a committed action when the
explorer checkpoint lags it. Unknown/pending actions are never replayed.

## Checkpoint contract

`exploration_checkpoints.payload_json` is an
`inspector-exploration-checkpoint/1` document. The payload is plain validated
data, never a class instance. It contains:

- schema version, run id, explorer family/version, adapter identity, seed and
  a configuration fingerprint;
- serializable Mulberry32 state and draw count;
- graph nodes, edges, screen counts, visitation indexes and first-target edge
  semantics;
- current state/screen, action/reset counters, novelty/plateau counters,
  recent action keys, toxic keys, policy-rejected keys;
- native visited fingerprints, per-action use counts and tried edges where
  applicable;
- anomaly class keys, finding-processing keys, active baseline action segment,
  and serialized anomaly/reproducer data;
- the durable run-step boundary and campaign start time used to reconcile
  committed work and wall-clock budget.

Loading validates the schema, identity, explorer family/version, adapter,
configuration fingerprint, checksum, finite counters, graph uniqueness, and
serialized action/anomaly shapes. Unknown versions, malformed/truncated JSON,
stale run identity, and incompatible adapter/configuration fail closed with an
actionable error. A checkpoint may lag committed work; the action/step log is
then reconciled before the next decision.

## Crash reconciliation rules

1. The SQLite action/step transaction is authoritative for admitted actions and
   step sequence. A committed action newer than the checkpoint is counted once
   and its semantic edge is recovered from action metadata plus the immediate
   durable observation when present; if no post-action observation exists, the
   edge is retained with a null target rather than repeated.
2. Pending actions become `unknown` during `RunManager.resumeRun`. Their action
   keys are blocked for the rest of the campaign. Unknown actions are observed
   or safely reset by the existing run recovery path, never blindly resent.
3. Reset attempts are durable events before adapter submission. A pending reset
   event is charged on recovery and is not retried automatically; the recreated
   environment is observed from its adapter-defined baseline.
4. Explorer checkpoints are written after the resulting durable observation and
   state update. A crash during checkpoint insertion leaves the previous valid
   snapshot; checksum and bounded retention make partial/corrupt data fail
   closed.
5. Finding records and exploration finding-class keys are authoritative for
   deduplication. Reproduction remains a separate state machine; an interrupted
   reproduction is resumed only through its durable finding state and never
   treated as a successful replay.

## Determinism and budgets

The RNG state/draw position is serialized directly. With equal observations and
actions, an uninterrupted run and an interrupted/resumed run make identical
subsequent tie-breaking decisions.

Action and reset budgets are campaign totals. The action table and reset-event
stream seed fresh controllers, so restarting cannot create free budget. Wall
time is campaign elapsed wall time from the durable campaign creation timestamp,
including downtime; this conservative semantic prevents a restart from
granting a fresh wall budget and is reported in the CLI. Finding caps and
novelty/plateau state are restored from the checkpoint and durable findings.

## Waypoints

- R0 — state/checkpoint contract and migration
- R1 — deterministic resumable RNG and graph snapshots
- R2 — web explorer persistence/reconciliation
- R3 — native explorer persistence/reconciliation
- R4 — crash-window and budget reconciliation
- R5 — `hunt --resume` continuation UX
- R6 — finding/reproduction continuity and deduplication
- R7 — deterministic interruption matrix and bounded restart soak
- R8 — real web/native interrupt-resume field proofs
- R9 — documentation/state synchronization and final exit gate

## Acceptance and exit gate

- A hunt can be interrupted and resumed in a fresh Inspector process.
- The target is faithfully recreated or safely refused; adapter identity and
  target provenance are never guessed.
- Web and native graph/edge/decision state, RNG, toxic/rejected actions,
  finding-class deduplication and active baseline segment survive.
- Action, reset, finding and campaign wall budgets cannot be reset by restart.
- Unknown actions are never blindly retried and automation failures never enter
  the target-defect pipeline.
- Deterministic fake-adapter interruption tests and a bounded restart soak pass.
- At least one real web and one available real native backend pass an
  interrupt/resume proof; unavailable backends are documented with evidence.
- Frozen install, lint, typecheck, unit and integration gates pass.
- CLI help, README, status/roadmap, autonomy docs, campaign state and
  checkpoint agree with the implementation; historical release records remain
  unchanged.
