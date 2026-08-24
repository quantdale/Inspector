# Project Status

Last updated: HARDENING_2 COMPLETE (2026-08-24)

## Campaign

- Mode: **M12 — real-target fleet campaigns: COMPLETE; HARDENING_2 — fleet
  runtime integrity, recovery, and state truth (separately invoked): 
  COMPLETE**. M11 and all earlier milestones remain COMPLETE; M8 stays
  `DEFERRED_ENVIRONMENT`.
  Canonical state is recorded in `.inspector/state/campaign.yaml`; the
  HARDENING_2 ledger lives in `.inspector/state/HARDENING-CHECKPOINT.md`.
- RC1_FIELD_VALIDATION: **COMPLETE** — decision **GO_WITH_DOCUMENTED_DEBT**
  for candidate **0.1.0-rc.2** (tree `85011ca`). Report:
  `docs/GA-FIELD-VALIDATION-REPORT.md`.
- Implementation campaign M0–M7 + M9: **COMPLETE**. HARDENING_1:
  **COMPLETE**. DOGFOOD_RC1: **COMPLETE**.
- rc.2 remains **NOT_PUBLISHED and untagged** (no release authority).
- Working branch: `main`

## HARDENING_2 outcome (fleet runtime integrity)

The M12 fleet runtime became genuinely trustworthy under failure:

- **Budgets before consumption**: the real hunt/explore loops obtain budget
  permission BEFORE each budgeted action/reset (`ExecutionContext.admit`) and
  account actual consumption incrementally; exhaustion is a structured,
  durable `budget-exhausted` terminal result that preserves committed
  evidence. Per-item manifest budgets are enforced atomically in the ledger
  (no silently ignored configuration).
- **Cancellation reaches real work**: cooperative stop/SIGINT/max-wall land
  at safe boundaries INSIDE the fake/web/native exploration loops; committed
  findings stay committed; owned claims requeue for resume.
- **Scheduler-managed lease liveness**: heartbeats renew at half-TTL with the
  exact fencing generation while any executor runs; a lost generation aborts
  the stale execution immediately and fences its completion.
- **Crash-safe settlement**: every completion/failure settlement is journalled
  before either durable store is touched; a fresh controller deterministically
  replays partial settlements (the crash between `leases.complete()` and
  execution-recording can no longer strand an item behind a done lease).
- **Durable wall budgets**: `--max-minutes` bounds the CAMPAIGN from its
  persisted start time — process restarts grant no fresh allowance.
- **Truthful lifecycle**: externally-held work yields `blocked` (with reason,
  held count, earliest reclaim) instead of silent exits or false `running`;
  all-refused campaigns report `refused` (exit 2), never success.
- **Fail-closed state truth**: semantically corrupt JSON state (wrong types,
  impossible values, duplicate identities, invalid generations) is quarantined
  and raises `StateCorruptionError` across campaign/ledger/lease stores;
  legitimate pre-M12 shapes migrate deliberately.
- **verify/regress source references**: `targetConfig.sourceItemId` reaches a
  producer's retained workspace through validated, contained, dependency-
  gated provenance (ADR-0012); campaign repair is preflight-rejected as
  unsupported (operator-supervised repair remains THE path).

Real-runtime re-proofs after these changes: deterministic fake campaigns,
REAL web campaign vs a live local app, REAL CLI/PTY campaign, and a REAL
android campaign item on a live AVD all pass. Windows/UIA and Electron
campaign lanes remain unwritten/deferred respectively (Electron executable
absent on this host).

## M12 outcome

`inspector campaign` is now a real-target fleet surface. The scale scheduler
owns queueing, leasing/fencing, budgets, cancellation, resume, and durable
accounting while item EXECUTION is delegated to pluggable executors — the
deterministic fake fixture and a new `InspectorWorkflowExecutor` that runs the
same exploration/replay engines the interactive CLI uses, in per-item isolated,
retained workspaces with campaign→item→worker→run provenance recorded durably.

- Versioned assignments (`inspector-campaign-workitem/1` semantics) and YAML/
  JSON manifests (`inspector-campaign-manifest/1`) validate fully before any
  work starts (`campaign run --manifest`, `campaign validate --manifest`);
  the legacy `--items id=target` quick path is intact.
- Workers route from probed backend capability snapshots (browser/pty/uia/adb/
  electron); unroutable items are durably refused with stable classifications
  — never faked. Snapshots, assignments, refusals, failure classes, stop
  reason, elapsed time, and finding summaries appear in campaign JSON views.
- Restart guarantees hold over REAL work: death between evidence persistence
  and completion recording still completes exactly once after restart with
  monotonic budgets; corrupt state fails closed; terminal campaigns refuse
  duplicate execution; SIGINT drains to a deterministic final state.
- Real multi-family portfolio proven through the scheduler on this host:
  web (Playwright vs a live local app), CLI/PTTY (real ConPTY), android (live
  AVD), plus the full fake-engine pipeline. Repair remains policy-refused for
  campaign items; discovery never implies repair.
- Replay efficiency: persistent per-finding replay drivers remove N−1 adapter
  launches per confirmation cycle with unchanged clean-state semantics;
  measurements recorded in SPEC-012 TASKS F9.
- Installed-artifact smoke now validates a manifest and runs a bounded fake
  multi-worker campaign end-to-end from the packaged CLI.

## M9 outcome

Capability-driven native exploration is product reality: `inspector hunt`
explores real Windows/UIA, CLI/PTTY, and Android targets through the standard
evidence/finding pipeline with platform-faithful replay drivers and
failure-class discipline (automation misses never become defects). Field
proofs on the final tree: Calculator 56 actions/50 states; vim 100 actions/
100 states; com.android.settings 45 actions/19 states (2-state pre-W7
baseline). Full exit gate PASS (unit 515/3skip; integration 137/137 after a
bounded retry of the documented concurrent-startup flake class).

## M10 outcome

The active implementation has a versioned, checksummed exploration checkpoint
stream (`inspector-exploration-checkpoint/1`) alongside low-level run steps.
Serializable Mulberry32 state, StateGraph snapshots, committed-step
reconciliation, durable reset/action budgets, web/native campaign restoration,
finding-class persistence, and `inspector hunt --resume <runId>` are wired.
Deterministic web and native interruption tests plus a bounded multi-restart
soak pass. Real-backend proofs also pass: a Playwright seeded-web hunt was
interrupted at run `run_4842e061213d4415971e879c3615973c` and resumed to its
original 12-action cap (5 states, 1 reset, one confirmed PAGE_ERROR, 28
monotonic steps, 8 retained checkpoints); a real ADB Settings hunt was
interrupted at run `run_7eb518e2e11849a3bcd97a66f73abd0b` and resumed to its
original 8-action cap (3 states, 16 monotonic steps, 8 retained checkpoints).
The available machine has no `vim` executable, and the Calculator UIA create
probe exceeded its 30-second lifecycle deadline; those backends remain
environmental non-proofs, not substituted mock passes. The real web and
Android proofs satisfy the M10 native/backend exit requirement.

The deterministic matrix covers committed-step/checkpoint lag, pending and
unknown actions, seeded multi-restart boundaries, bounded checkpoint history,
corrupt/incompatible checkpoints, native edge/RNG restoration, and CLI
process-kill continuation. The seeded restart soak uses boundaries 1, 2, 4,
and 6 and ends with unique monotonic steps, exactly the configured action
budget, and no checkpoint growth beyond retention 8.

## M11 outcome

The installed CLI now exposes durable `verify`, `regress`, `explore`,
`repair`, and `campaign run|list|show|stop|resume` workflows over the existing
finding, replay/oracle, repair, exploration, and scale engines. Product-facing
JSON schemas and deterministic outcome classes distinguish reproduction,
fixed, flaky, environment failure, incompatible target, policy refusal, and
internal errors. Discovery never implies patching permission.

M11 P5 closed the product-blocking oracle false-positive, realpath repair
containment, freeform redaction, restart-durable budget/accounting, atomic
artifact cleanup, and timestamped web attribution debt. P6 added a production
Playwright Electron binding and deterministic fixture with explicit real vs
injectable selection, plus a real PTY VT viewport/cursor/resize model. The
production Electron field proof has since been **executed for real** on this
Windows host (Electron 43.4.1): lifecycle, renderer actions, evidence,
target-failure classification, reset, and close all pass; headless hosts
defer honestly via an explicit display gate instead of failing or faking.

P7 completed layered Linux/Windows CI configuration, the clean installed
npm-tarball smoke, the end-to-end acceptance matrix, stable CLI error output,
and final documentation/state reconciliation. No rc.2 package, release, or
tag has been published.

## Candidate staleness (GA decision)

Field validation found and fixed two runtime defects (FIELD-1 HIGH:
resume never re-created the environment on a fresh adapter process, fixed in
`cc0d34b` with deterministic regression coverage; FIELD-2 MEDIUM: UIA rehost
recovery could not follow a window that migrated to a new owner pid, fixed in
`e40fa2d`). The original `v0.1.0-rc.1` tag is untouched and remains the
historical validated artifact of record; the GA-proposed candidate is
**0.1.0-rc.2**, rebuilt from tree `85011ca` with full provenance recorded in
`.inspector/state/GA-READINESS.yaml` (`candidate_staleness_decision`). No
replacement tag has been created or pushed.

## Field validation summary

Real targets exercised from the installed rc.2 artifact: web todomvc-react
and todomvc-backbone (honest-zero findings on healthy apps), Windows UIA
Calculator/Paint/Notepad (114 unscripted interactions), vim over real ConPTY
(265 interactions; Ctrl-C/external-kill/close all honest; every
session-attributed vim pid reaped ≤745 ms), Android Settings on a live AVD
(60 actions / 40 clicks / 0 failures), plus the seeded control through the
full finding pipeline. Interrupt/resume soak against the installed artifact:
14 abrupt kills — 11 clean resumes, 3 honestly-documented refusals, zero
UNIQUE/BUSY errors, strictly increasing step sequences, terminal runs refuse
resume. Web pageerror/action-window attribution: 56/56 scenario passes across
8 repetitions per class. Evidence: `.inspector/ga-work/`.

## Verified gates

| Gate | Result |
| --- | --- |
| frozen install | PASS |
| lint | PASS (0 errors; 4 pre-existing warnings) |
| typecheck | PASS |
| test (unit) | PASS (549 passed / 3 skipped at the M12 final sweep) |
| test:integration | PASS — 164 passed / 1 skipped across 39 files (M12 final sweep) |
| M12 acceptance | PASS (SPEC-012 task graph gates F0–F11) |
| installed release smoke | PASS (fresh npm prefix, incl. M12 campaign steps) |
| hosted CI | NOT RUN — no push authority this session; lanes remain CONFIGURED-not-yet-run |

M11 final evidence on the current tree: P1-P4 product integration proofs
and P5 safety gates pass; P6 typecheck/lint pass, VT viewport integration
passes, Electron injectable conformance is 2/2, and the real Electron
production proof now executes against an actual Electron 43.4.1 process on
this host (the only skip left is the executable-absent refusal case). P7's
installed-artifact smoke passes from a fresh npm prefix
(`inspector-cli-0.1.0-m11.0.tgz`, including the fake `explore` workflow).
The latest clean candidate SHA-256 is
`2149dc76f09e4409e953270fa6c0481a9500439369ee09c595048765e10963ae`, with
manifest source commit `23a4a27dcff472bd709c3b93b29572ad087564a5` and
`source.dirty: false`; earlier candidates remain historical record.

M10 final-gate evidence is the `c0835d7` implementation commit plus the
following state-synchronization commit; historical RC1 reports remain
unchanged.

## Known blockers

None blocking continued validation.

## Milestone summary

| Milestone | State |
| --- | --- |
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | COMPLETE |
| M4 Oracle/repair | COMPLETE |
| M5 Android | COMPLETE |
| M6 Cross-platform adapters | COMPLETE |
| M7 Scale/integrations | COMPLETE |
| M8 iOS | DEFERRED_ENVIRONMENT |
| M9 Platform-neutral exploration | COMPLETE |
| M10 Resumable exploration | COMPLETE |
| M11 Operator workflows/distribution | COMPLETE |
| M12 Real-target fleet campaigns | COMPLETE |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
