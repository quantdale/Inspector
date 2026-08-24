# ADR 0011 — Campaign execution contract, versioned work items, and manifests

Date: 2026-08-24
Status: Accepted (M12)
Supersedes: none

## Context

M7/M11 exposed `UnattendedCampaign` through `inspector campaign`, but the
scheduler itself constructed `FakeAdapterHandler` inline and the CLI accepted
only `--items id=target` assignments with `target=fake`. Real Inspector
workflows could not run as fleet work, and there was no durable description of
complex campaigns.

## Decision

1. **Execution contract** (`@inspector/scale/executor`): the scheduler owns
   queueing, priorities, worker ownership, leasing/fencing, budgets,
   cancellation, resume, lifecycle state, and durable accounting. Item
   EXECUTION is delegated to a pluggable `WorkItemExecutor` with an
   `ExecutionContext` (isolated workspace dir, ledger charge, lease renewal,
   partial-finding persistence, abort signal) and a structured
   `WorkItemResult` carrying findings, evidence paths, run IDs, usage, and a
   stable failure taxonomy (`capability-unavailable`,
   `target-incompatible`, `environment-unavailable`,
   `target-config-invalid`, `execution-failure`, `policy-refusal`,
   `budget-exhausted`). The deterministic fake fixture is one executor
   implementation (`FakeItemExecutor`); real workflows are another
   (`InspectorWorkflowExecutor` in `@inspector/workflows`). The scheduler
   imports no adapter handler or workflow engine.

2. **Versioned assignments** (`inspector-campaign-workitem/1` semantics):
   items carry workflow (`hunt|explore|verify|regress|repair`),
   adapter family (`fake|web|cli|windows|android|electron`), target
   URI/descriptor + config, revision, seed, per-item budgets, priority,
   required capabilities, exclusivity flag, and explicit
   `repairAuthorized`. Legacy `mode` values (including `regression`)
   normalize transparently. Repair requires explicit per-item authorization;
   discovery never implies repair.

3. **Manifests** (`inspector-campaign-manifest/1`): YAML/JSON files describing
   workers, leases, budgets, and item lists. Fully validated before any
   directories/state/work exist; failures raise deterministic issues
   (`CampaignConfigError`), surfaced by the CLI as kind `manifest-invalid`.
   `campaign validate --manifest <path>` validates without creating anything.
   Durable campaign records retain the source path + SHA-256.

4. **Capability-aware routing**: workers present probed capability snapshots
   (browser, pty, uia, adb, electron, display). Items route only to workers
   whose executor supports the family and required tags; unroutable work is
   refused durably exactly once, never faked. Snapshots, assignment
   decisions, refusals, failure classifications, and stop reason persist in
   campaign state for audit/recovery.

5. **Shared workflow services** (`@inspector/workflows`): exploration
   orchestration, workspace/spawn resolution, durable hunt meta (now carrying
   campaign/item/worker provenance), replay-subject machinery, and the fake/
   native/web hunt engines moved below the CLI so interactive commands and
   fleet executors share one implementation. CLI JSON/human contracts are
   unchanged.

6. **Replay efficiency**: `WebReplayDriver` accepts opt-in `persistent`
   mode — one adapter subprocess reused across a finding's reproduce/minimize
   replays via conformance-proven reset semantics — plus an optional
   `ReplayDriver.dispose()` hook the explorer calls per confirmation cycle.
   Default behavior (close after every replay) is unchanged elsewhere.

## Consequences

- Multi-family real-target fleets run under the same durability guarantees as
  the fake fixture (proven by SOAK-J1 plus the M12 restart matrix).
- Environment limitations surface as classified, durable refusals instead of
  silent fakes or hangs.
- The scheduler's concurrency became genuinely parallel; two race-class
  defects were found and fixed with regression coverage (drain-before-report;
  stop-racing-charge classification), and finding persistence is idempotent
  per finding id.
- Release payload gains one pure-JS dependency (`yaml`) for manifest parsing.
