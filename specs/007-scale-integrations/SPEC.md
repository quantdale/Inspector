# Specification 007 — Scale, Integrations, and Unattended Operations

## Status

COMPLETE

## Objective

Evolve the proven single-run system into a practical long-running reliability engine without weakening determinism, isolation, or auditability.

## Dependencies

Specs 000–006 COMPLETE.

## Task groups

### S0 — Worker isolation and concurrency

Add bounded parallel workers, explicit resource ownership, per-worker environment/worktree isolation, quotas, cancellation, and controller restart recovery.

### S1 — Repository map and impact signals

Persist source/module/test ownership maps and change-impact hints used by exploration and repair context selection.

### S2 — Model abstraction/routing

Define provider-neutral model roles/capabilities, fallback/escalation policy, context budgets, structured outputs, and per-request telemetry. No core workflow may depend on one model vendor.

### S3 — Cost/resource accounting

Track model requests/tokens/cost when known, wall time, adapter actions, resets, artifact bytes, worker utilization, and campaign budgets.

### S4 — Finding clustering

Deduplicate/recluster repeated findings by oracle, minimized sequence, stack/error signature, affected state, and revision. Preserve distinct evidence.

### S5 — Scheduling/campaign execution

Support bounded unattended modes such as `hunt`, `regression`, and `repair`, durable schedules/queues where justified, checkpoint/restart, and clean shutdown.

### S6 — External integration facade

Expose an MCP-compatible facade and orchestrator-friendly API/events while keeping IAP internal. External clients cannot bypass policy or mutate durable state inconsistently.

### S7 — Plugin/adapter developer experience

Publish adapter SDK contracts, conformance runner, example adapter, version compatibility matrix, and registration/discovery mechanism.

### S8 — Multi-worker proving campaign

Run at least two isolated workers against seeded/realistic targets, inject controller restart, verify no cross-run artifact/state/worktree contamination, and produce consolidated report.

## Acceptance tests

- concurrent workers cannot mutate each other's environments/worktrees;
- controller restart resumes or safely classifies in-flight work;
- global and per-worker budgets are deterministic;
- model routing failure falls back/escalates according to policy;
- MCP/external calls map through the same policy/action contracts;
- duplicate findings cluster without losing evidence provenance;
- long bounded campaign can terminate/restart cleanly.

## Exit gate

Inspector runs a bounded multi-worker unattended campaign, survives controller restart, preserves durable evidence/state, accounts for resources, and exposes a stable integration facade.

## Completion transition

Set M7 COMPLETE. If M8 environment is available, activate Spec 008. Otherwise mark M8 `DEFERRED_ENVIRONMENT`, run implementation campaign completion checks, and set campaign status COMPLETE.
