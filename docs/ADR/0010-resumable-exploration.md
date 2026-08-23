# ADR 0010 — Dedicated durable state for resumable exploration

Status: ACCEPTED (M10)

## Context

Inspector already has a generic `checkpoints` table used by `RunController` to
recover low-level step sequence numbers. `ExploreController` and
`runNativeHunt`, however, keep their state in process memory. Reusing the
generic payload without a namespace would mix two contracts and make it
impossible to distinguish a stale low-level checkpoint from a valid explorer
snapshot.

## Decision

Add a dedicated SQLite exploration campaign row, versioned exploration
checkpoint records with checksums and bounded retention, and a small reset-event
stream. Keep the existing generic checkpoint stream unchanged for low-level run
recovery. Persist semantic action metadata in the action row so a committed
step newer than the latest explorer snapshot can be reconciled without replay.

The explorer owns serialization/validation of its plain snapshot contract;
`Store` owns transactional insertion, checksum, latest lookup and retention.

## Consequences

- Latest explorer state is efficiently addressable and cannot be mistaken for a
  `RunController` sequence checkpoint.
- A hard kill between action commit and explorer checkpoint is recoverable from
  the durable step/action/observation log, with unknown targets represented
  honestly rather than rerun.
- Checkpoint storage grows by a bounded retention window, at the cost of a
  schema migration and a little duplicate metadata in the action table.
- Recreated adapters start from their documented baseline; the exploration
  graph is preserved even when the exact live UI state cannot be restored
  without replaying actions.
