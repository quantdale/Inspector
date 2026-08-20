# Autonomous Implementation Campaign

This document defines how an AI coding agent can develop Inspector for long periods without human supervision.

## Objective

Convert the architecture repository into a working Inspector implementation through a sequence of durable, test-gated waypoints.

The campaign prioritizes **implementation breadth and end-to-end capability**. Periodic hardening campaigns will later perform deeper audit, stress, cleanup, performance, security, and adversarial work.

## Campaign control plane

Three artifacts are authoritative for execution state:

- `.inspector/state/campaign.yaml` — machine-readable current state;
- `.inspector/state/CHECKPOINT.md` — human/agent-readable recovery note;
- active `specs/<id>-*/SPEC.md` plus task graph — acceptance contract.

`docs/STATUS.md` is a convenient summary but is not the machine source of truth.

## Startup algorithm

A fresh agent must execute this sequence:

```text
fetch latest authorized remote state
checkout main
read campaign.yaml
read CHECKPOINT.md
read AGENTS.md
read active spec/tasks
inspect git status + recent commits
verify the recorded waypoint against actual code
run the smallest sanity gate needed to establish a trustworthy baseline
continue from current waypoint
```

If state disagrees with code, code and passing tests are evidence; campaign state is intent. Reconcile the mismatch explicitly, update the checkpoint, and do not silently assume either side is correct.

## Continuous execution algorithm

```text
while campaign.status == ACTIVE:
    waypoint = next_unblocked_waypoint()
    orient(waypoint)
    implement(waypoint)
    run_targeted_tests()
    run_waypoint_gate()

    if gate_passes:
        mark_waypoint_complete()
        persist_campaign_state()
        write_checkpoint()
        checkpoint_commit_if_authorized()
        activate_next_waypoint()
        continue

    classify_failure()
    repair_if_in_scope()

    if blocked_but_other_work_exists:
        record_blocker()
        activate_independent_waypoint()
        continue

    if no_safe_work_remains:
        campaign.status = BLOCKED
        persist_state()
        stop
```

The agent must not intentionally end a run simply because a convenient stopping point was reached.

## Waypoint granularity

A waypoint should normally represent one coherent, gateable capability taking one or a few related commits, for example:

- workspace bootstrapped and empty gates passing;
- protocol envelope validated;
- transactional action persistence working;
- fake adapter conformance passing;
- Playwright observation bundle working;
- reproducer minimizing a seeded failure.

Do not make waypoints so small that state churn dominates work, or so large that recovery requires rediscovering days of decisions.

## Durable update protocol

At every completed waypoint, update:

1. active/completed waypoint fields in `campaign.yaml`;
2. `CHECKPOINT.md` with what changed, gates run, known issues, and exact next action;
3. the active spec/task checkboxes;
4. architecture/ADR documentation only if behavior or contracts changed.

A checkpoint is valid only if its claimed gate was actually run and passed for the recorded revision.

## Milestone transition protocol

When all tasks in a milestone are complete:

1. run the milestone exit gate from the roadmap/spec;
2. resolve regressions introduced by the milestone;
3. update milestone status to `COMPLETE`;
4. record the verified revision and gate evidence;
5. activate the next milestone/spec;
6. continue automatically.

Do not begin a broad hardening campaign at milestone boundaries unless explicitly requested. Normal exit-gate fixes are part of implementation.

## Missing-spec protocol

If campaign state points to a milestone with no detailed spec:

1. read the milestone section in `docs/ROADMAP.md`;
2. read relevant architecture, product, security, and ADR contracts;
3. create `specs/<next-id>-<slug>/SPEC.md` with objective, dependencies, invariants, tasks, acceptance tests, non-goals, and exit gate;
4. update campaign state to reference it;
5. implement it.

A missing detailed spec is not itself a reason to ask the user unless the roadmap leaves a material product decision unresolved.

## Dependency policy

Prefer dependencies that are:

- mature and actively maintained;
- permissively licensed and compatible with the repository;
- replaceable behind an interface;
- well supported on the target OS/runtime;
- significantly cheaper to adopt than to reimplement.

Pin important toolchain versions. Avoid adding infrastructure merely because it is popular.

## Scope discipline

During implementation campaign mode:

Allowed:

- implementation required by active/future milestones;
- defects encountered in the path of implementation;
- small refactors needed to keep boundaries clean;
- targeted tests and reliability fixes required by gates;
- documentation/ADR synchronization.

Deferred to hardening unless necessary for a gate:

- repository-wide style cleanup;
- massive dependency upgrades;
- exhaustive fuzzing/mutation campaigns;
- speculative performance rewrites;
- broad security audit;
- visual polish dashboard work;
- unrelated refactoring.

## Decision logging

Use an ADR when a decision:

- changes a public/internal protocol contract;
- changes platform ordering or adapter boundaries;
- changes persistence semantics;
- weakens or strengthens a security boundary;
- introduces a major dependency with architectural consequences;
- intentionally deviates from a seeded specification.

Routine implementation details do not need ADRs.

## Context management

Do not load the whole repository into the model on every step.

Maintain a compact working set:

- campaign state;
- checkpoint;
- active spec;
- directly relevant interfaces/tests/files;
- architecture sections implicated by the task.

After a context reset, rehydrate from durable state instead of relying on previous model memory.

## Parallelism

Parallel agents are allowed only when write ownership is clear.

Good split:

```text
worker A: protocol package
worker B: artifact store
worker C: SQLite migration tests
```

Bad split:

```text
multiple workers editing core run state machine simultaneously
```

The coordinating agent owns integration, gate execution, campaign state, and checkpoint updates.

## Definition of a trustworthy handoff

Another agent must be able to answer all of these using repository state alone:

- What campaign is active?
- What milestone/spec is active?
- What is already complete?
- What gate last passed and at which revision?
- What is the exact next task?
- What blockers/known failures exist?
- Which decisions are fixed by ADR?
- What must not be done yet?

If any answer requires chat history, improve the durable documentation before moving on.
