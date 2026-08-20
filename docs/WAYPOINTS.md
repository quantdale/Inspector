# Waypoint and Checkpoint Protocol

Waypoints make unattended development resumable, auditable, and safe across model/session resets.

## Terminology

**Task** — an individual checklist item in a specification.

**Waypoint** — a coherent group of work with a concrete gate and durable checkpoint.

**Milestone** — a roadmap capability containing multiple waypoints.

**Checkpoint** — the persisted statement of the last trusted state plus the exact next action.

## Waypoint identifier format

Use stable IDs:

```text
M<milestone>.<task-group>[.<slice>]
```

Examples:

```text
M0.F0.workspace
M0.F1.protocol-envelope
M1.W2.semantic-observation
M3.E4.boundary-inputs
```

Once recorded in campaign history, do not reuse an ID for different work.

## Waypoint lifecycle

```text
READY -> ACTIVE -> VERIFYING -> COMPLETE
                 -> BLOCKED
                 -> FAILED
```

`COMPLETE` means the waypoint's declared gate passed. Code presence alone is not completion.

## Required checkpoint contents

`.inspector/state/CHECKPOINT.md` must contain:

- campaign and branch;
- active milestone/spec;
- last completed waypoint;
- current/next waypoint;
- verified revision, if any;
- gates actually run and result;
- significant files/components changed;
- known failures/debt intentionally carried forward;
- blockers and required resources;
- exact next action for a fresh agent.

Keep it operational, not narrative.

## Checkpoint cadence

Create/update a durable checkpoint:

- after every completed waypoint;
- before a risky migration or protocol-breaking operation;
- after recovering from a crash or unknown outcome;
- before handing work to another agent;
- at every milestone exit gate.

## Recovery algorithm

A fresh agent should:

1. inspect current HEAD and worktree cleanliness;
2. read `campaign.yaml` and `CHECKPOINT.md`;
3. compare recorded checkpoint revision with Git history;
4. inspect uncommitted changes before assuming they are disposable;
5. rerun the checkpoint's smallest confidence gate if the environment changed materially;
6. resume the recorded next waypoint.

If checkpoint claims disagree with Git/tests, mark the checkpoint stale, reconcile evidence, and update it before continuing.

## Progress reporting

Progress is gate-based, not token/time-based.

Good:

```text
M0: ACTIVE
F0: COMPLETE
F1: ACTIVE (3/6 tasks gate-verified)
Last gate: protocol fixture tests PASS @ <sha>
Next: capability negotiation schema
```

Bad:

```text
Project 42% complete
```

Do not fabricate percentage completeness when task weights are unknown.

## Commit convention

Recommended checkpoint commit subject:

```text
impl(M0.F1): complete protocol envelope waypoint
```

The commit body may include:

```text
Gate: pnpm --filter @inspector/protocol test
State: M0.F1 COMPLETE -> M0.F2 ACTIVE
```

State/checkpoint changes should travel with the code they describe.

## Blocked waypoint handling

A blocker must record:

- what capability/resource is missing;
- evidence the blocker is real;
- attempts already made;
- whether independent work can continue;
- exact condition that unblocks it.

Do not repeatedly retry the same blocked external dependency without new evidence.
