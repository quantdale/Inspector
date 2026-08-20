# Hardening Campaign Protocol

Hardening is intentionally separate from the implementation campaign.

## Why separate it

An autonomous implementation agent can spend unlimited time polishing already-working areas. Separating campaigns keeps the default objective focused on delivering the next capability while still allowing periodic deep quality pushes.

## When hardening is active

Hardening begins only when explicitly requested by the operator/orchestrator, for example with an instruction equivalent to:

```text
start hardening campaign
```

Normal tests, bug fixes, type safety, and regression repairs required by an implementation gate are **not** hardening; they remain mandatory implementation work.

## Hardening objectives

A hardening campaign may include:

- deep repository audit;
- concurrency/race review;
- exhaustive edge-case testing;
- fuzzing/property/state-machine campaigns;
- mutation testing;
- flake hunting;
- dependency/security review;
- observability gaps;
- crash/restart torture;
- resource leak/performance campaigns;
- visual/accessibility campaigns;
- dead-code/duplication cleanup;
- documentation/code consistency audit.

## Handoff into hardening

Before switching modes:

1. finish or checkpoint the current implementation waypoint;
2. set campaign state mode to `HARDENING` with a named scope;
3. record the implementation resume waypoint;
4. branch/worktree if isolation is needed;
5. define hardening exit criteria.

## Handoff back to implementation

At hardening completion:

1. run the agreed hardening gates;
2. record unresolved debt explicitly;
3. restore campaign mode to `IMPLEMENTATION`;
4. restore the saved implementation waypoint;
5. continue from the roadmap without re-planning completed milestones.

Hardening must never erase durable implementation state.
