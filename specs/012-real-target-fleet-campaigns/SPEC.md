# SPEC-012 — Real-Target Fleet Campaigns, Capability-Aware Scheduling, and Unattended Runtime Efficiency

Status: ACTIVE
Milestone: M12
Depends on: SPEC-003, SPEC-007, SPEC-009, SPEC-010, SPEC-011

## Objective

Remove the fake-target limitation from Inspector's fleet/campaign product
surface. After M12, `inspector campaign` orchestrates **real Inspector
workflows against real adapter-backed targets** through the same durable,
isolated, policy-guarded machinery used by interactive commands, while the
deterministic fake executor remains available as a test fixture behind the
same contract.

## Product contract

```text
inspector campaign run --manifest campaign.yaml   # file-based complex campaigns
inspector campaign run --items id=fake,...         # backward-compatible quick path
```

A campaign item is a versioned, durable target assignment describing:
workflow (`hunt|explore|verify|regress|repair`), adapter family
(`fake|web|cli|windows|android|electron`), target URI/descriptor +
configuration, revision/provenance, seed, per-item budgets, priority,
required capabilities/exclusivity, and explicit repair authorization state.

Workers route work by **actual capability** (probed backend availability),
never by name alone. Environment limitations are classified honestly as
refusals (`capability-unavailable`, `environment-unavailable`,
`target-incompatible`, `target-config-invalid`, `policy-refusal`,
`execution-failure`, `budget-exhausted`) — never silently converted into
product defects or fake executions.

## Invariants

- The scale scheduler owns queueing, priorities, worker ownership, leasing,
  fencing, budgets, cancellation, resume, lifecycle state, and durable
  accounting. It must not know how any specific workflow or adapter executes.
- Executors own resolving the workflow, resolving the adapter/target,
  constructing the environment, invoking the real engine, and returning
  structured results/findings/artifacts/accounting.
- Campaign items call the production engines (`hunt`, `explore`, `verify`,
  `regress`, `repair`) — no alternate hunt/finding/replay semantics inside
  `@inspector/scale`, no second finding format for fleets.
- Every campaign item executes in an isolated context: its own workspace
  subtree, SQLite store, artifacts, adapter process, environment ID, run ID;
  provenance chain campaign → work item → worker → run → step → finding →
  evidence is durable.
- Restart/lease/fencing/budget guarantees survive real-work execution:
  completed items never repeat; unknown action outcomes are never blindly
  retried; findings never duplicate; stale completions stay fenced; corrupt
  manifests/state fail closed; terminal campaigns refuse inappropriate
  resume.
- Discovery never implies repair: campaign-wide repair requires an explicit,
  auditable per-item authorization AND an explicitly configured provider.
- No automatic push/merge/deploy/release; no host mouse/keyboard hijacking;
  secrets redacted before persistence.
- Performance work preserves clean-state reproduction and evidence quality.

## Workstreams

### F0 — Activation and contracts

Create this specification/task graph, add M12 to the roadmap, activate it in
durable state, record the debt audit baseline.

### F1 — Execution abstraction in @inspector/scale

Introduce `WorkItemExecutor` / `ExecutionContext` / structured result types.
Extract today's inline execution into a deterministic fake executor that is
one implementation behind the contract. The scheduler stops importing
production adapters/workflows directly. Workers execute concurrently under
leases; capability snapshots become part of the assignment decision path.

### F2 — Versioned work-item schema and campaign manifest

Define and validate the v2 assignment schema plus a file-based manifest
(YAML/JSON) carrying workers/budgets/items. Deterministic configuration
errors before any work starts; backward-compatible `--items id=target`
quick path preserved with its existing JSON contract.

### F3 — Real workflow services (@inspector/workflows)

Extract CLI-grade exploration orchestration into reusable service-level
functions so interactive commands and campaign executors share one
implementation. Provide an inspector workflow executor that runs hunt/explore
items against real engines with per-item isolation, usage accounting, and
evidence preservation. Verify/regress reuse their replay/oracle machinery;
repair stays refusal-by-default unless explicitly authorized per item.

### F4 — Capability-aware worker routing

Probe worker backends (browser, PTY, UIA, ADB, Electron) once per worker,
persist snapshots and every routing/refusal decision, and route only
executable work to each worker. Unroutable work is classified and recorded,
never faked.

### F5 — Durable restart/recovery proofs at campaign scale

Deterministic abrupt-termination coverage across queued / environment
creation / active hunt / evidence persistence / finding confirmation /
lease renewal / completion recording / stop / resume, including multiple
controller restarts in one campaign, budget non-reset, fenced stale
completions, and corrupted-state fail-closed behavior.

### F6 — Cancellation and graceful shutdown

Cooperative cancellation reaches active executions; `campaign stop` produces
a deterministic final state retaining committed evidence; SIGINT handling is
portable and tested where possible.

### F7 — Finding aggregation and observability

Campaign output distinguishes observations, candidates, confirmed, clustered
duplicates, flaky, environment failures, automation failures, and repaired
findings; clustering reuses the existing dedup system evidence-preservingly.
`campaign show` exposes elapsed time, worker state, queue depth, assignments,
run IDs, usage (actions/resets/tokens/cost/artifact bytes), lease state,
restart count, refusals, and stop reason without breaking M11 machine
contracts (new fields only, schema version bump where shapes change).

### F8 — Real multi-target campaign proof

Execute bounded real campaigns spanning at least two genuinely different
adapter families available on this host (web + PTY minimum; Windows/UIA,
Electron, Android where healthy). Deterministic fake campaigns remain the
exhaustive scheduler-test vehicle. Honest deferral records for anything the
host cannot exercise.

### F9 — Web replay runtime efficiency

Profile the canonical web explore/replay E2E path (~4–6 minutes recorded
debt). Remove safe dominant costs (redundant browser/environment creation,
duplicate replays, unnecessary capture) without weakening reproduction or
evidence. Record before/after measurements.

### F10 — Installed-artifact campaign proof

Extend release smoke: installed artifact validates a manifest, runs a
deterministic fake multi-worker campaign end to end (run/show/list/stop/
resume paths), and package contents remain free of secrets/temp/workspace
litter.

### F11 — Documentation and final gate

Synchronize README/PRODUCT/ARCHITECTURE/ROADMAP/STATUS/DEVELOPMENT/
AUTONOMY-MODEL/PLATFORM-ADAPTERS/OBSERVABILITY/SECURITY-MODEL, ADRs, spec
checkboxes, campaign state/checkpoint; run the full gate matrix on the final
tree.

## Acceptance tests

- Unit: work-item/manifest validation (valid, invalid, unsupported,
  backward-compat); executor contract; fake executor determinism; capability
  routing incl. unavailable-capability refusal; aggregation classes.
- Integration: real-workflow executor runs hunt/explore items end-to-end
  against real web + PTY targets with per-item isolation; verify/regress
  items replay durable scenarios; repair refusal without authorization;
  restart matrix; stop/resume determinism; multi-worker real campaign proof.
- Scheduler regression: existing M7/M10/M11 campaign behaviors unchanged
  (queueing, leases, budgets, fencing, facade).
- Release smoke extension proves installed-artifact campaign operation.
- Performance measurements recorded before/after optimization.
- All repository gates pass on the final tree.

## Non-goals

- No publication/tag/release/deployment; rc.1/rc.2 provenance untouched.
- M8 iOS remains `DEFERRED_ENVIRONMENT` unless a real macOS/Xcode proof occurs.
- No cloud control plane, dashboard rewrite, or new hardening campaign.
- No weakening of clean-state reproduction, evidence quality, or redaction.

## Exit gate

M12 is complete when: the scheduler has no fundamental dependency on
`FakeAdapterHandler`; the pluggable executor contract exists; the versioned
manifest schema ships; capability routing works with persisted decisions;
real hunt/explore (and verify/regress where feasible) execute as campaign
items; provenance chains are durable; restart/stop guarantees hold at scale;
multi-family real campaigns are proven on this host; clustering works on
campaign findings; performance measurements are recorded; installed-artifact
campaign smoke passes; hosted CI results are truthfully recorded (or the
external blocker evidenced); all gates pass; docs/state match the tree.
