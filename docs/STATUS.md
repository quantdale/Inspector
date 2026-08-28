# Project Status

Last updated: HARDENING_6 COMPLETE (2026-08-28; implementation SHA
`8b00f69697596872073d490538e8722688ab41b1`; hosted run `33142638356`
SUCCESS). The exact-blob audit is 590 tracked / 480 reviewed / 0 unreviewed;
local H6.8 gates and all four required hosted lanes pass. M14-M23 remain
COMPLETE; HARDENING_5 remains COMPLETE on `e1e0864`.

## Campaign

- Mode: **HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity** (COMPLETE 2026-08-28; OpenSpec: `openspec/changes/hardening-6-repair-trust/`). Implementation SHA `8b00f69697596872073d490538e8722688ab41b1` passed exact-SHA hosted run `33142638356` across Linux quality/full integration, Windows path/native, Electron Xvfb, and installed-artifact smoke. The final audit is `.inspector/state/HARDENING_6-AUDIT.md` with 590 tracked / 480 reviewed / 0 unreviewed. No M24/release/tag/publication.

- Mode: **HARDENING_5 — Fleet Execution Truth, extended through deep-audit
  verification-outcome-truth, replay-backend-provenance, and durable-history-
  integrity correction** (COMPLETE 2026-08-27 per `.agent/EXECUTION_PROMPT.md`
  and `.inspector/state/campaign.yaml`; hosted run 33034546691 SUCCESS on e1e0864;
  ledger: `.inspector/state/HARDENING-CHECKPOINT.md`, campaign #5). Prior hardening
  campaigns below are retained as historical records.

- Mode: **HARDENING_4 — certification integrity, durable-state atomicity,
  cross-process ownership fencing** (separately invoked via
  `.agent/EXECUTION_PROMPT.md` planner commit e030696; ledger:
  `.inspector/state/HARDENING-CHECKPOINT.md`, campaign #4). [historical]
  Seven defects closed (2 HIGH durability primitives redesigned,
  1 HIGH clean-CI executable resolution, 1 MEDIUM stats semantics,
  3 truth-surface/LOW), each with deterministic regression coverage.
  Hosted certification: Actions run **32936068493 SUCCESS** on the exact
  pushed SHA **`f687ef1`** — Linux quality gate (browser provisioning +
  FULL integration, step-proven via public API), Linux installed-artifact
  smoke, Electron Xvfb real-runtime proof, and Windows path/native lane all
  green. An eighth defect (H4-D8 MEDIUM, node-pty POSIX spawn parity) was
  found by that hosted run's first-ever Linux integration execution and
  closed by `f687ef1` itself.
- HARDENING_3, HARDENING_2: COMPLETE. M13 — Intelligence-Guided Autonomous
  QA: **COMPLETE** (exit gate PASS on `9d65d334`). M12/M11/M10/M9 and all
  earlier milestones COMPLETE; M8 stays `DEFERRED_ENVIRONMENT`. Canonical
  state is recorded in `.inspector/state/campaign.yaml`.
- RC1_FIELD_VALIDATION: **COMPLETE** — decision **GO_WITH_DOCUMENTED_DEBT**
  for candidate **0.1.0-rc.2** (tree `85011ca`). Report:
  `docs/GA-FIELD-VALIDATION-REPORT.md`.
- Implementation campaign M0–M7 + M9: **COMPLETE**. DOGFOOD_RC1:
  **COMPLETE**.
- rc.2 remains **NOT_PUBLISHED and untagged** (no release authority).
- Working branch: `main`

## HARDENING_5 outcome (Fleet Execution Truth + verification-truth / provenance / history integrity)

- **Electron fleet execution truth**: the `electron` family no longer routes through the fake fallback (`familyAdapter`/`adapterSpawn` exhaustive). Unknown/unimplemented families fail before run/workspace side effects. Real Electron campaign lane proven via `InspectorWorkflowExecutor` against `@inspector/electron-adapter` with durable identity, cancellation/budget/checkpoint/finding continuity, and honest refusal when executable/display absent. Hosted Xvfb fleet proof green on run 33034546691 (electron-production + electron-fleet).
- **Windows/UIA campaign truth**: campaign-level Windows work items execute through manifest → scheduler → workflow → real UIA adapter with identity-before-create, mock-real backend parity for reproduction, and `windows-campaign` integration proof locally and in hosted Windows lane.
- **Verification-outcome truth**: replay outcome vocabulary is now explicit (`reproduced` / `clean` / `environment-failure` / `incompatible` / `cancelled` / `budget-denied`). All-error/timeout/cancel reproduction never becomes `REJECTED`; verify environment failures never become `RESOLVED`/`fixed`; regress replay errors never counted as `clean`; zero valid scenarios never returns OK-clean. Budget enforcement is admit-before-consume with actual-use charging; denied admissions perform zero replay work.
- **Backend provenance**: durable replay identity pins `{adapter family, durable adapter id, backend mode, target identity, revision}`; Electron/Windows/CLI/Android backends are explicitly validated and fail closed on missing/malformed provenance unless migration is provably unambiguous. Current-host capability changes cannot silently change historical replay meaning.
- **Cross-platform atomic-write durability**: `workflows/atomic.ts`, `artifact-store`, and `scale/writeJsonAtomic` now use bounded transient-sharing retry (EPERM/EACCES/EBUSY, win32-only, 12 attempts) + unique temp ownership + age-gated cleanup + fsync, matching the StateFile contract proven in HARDENING_4.
- **Measured efficiency**: `StateFile.save` set-fingerprint skip for identical re-saves; other hypotheses (prepared-statement caching, fingerprint co-computation, sweep throttling, etc.) measured and rejected with rationale — no speculative bulk patch landed.
- **Audit certification**: every tracked authored file inventoried via `git ls-files` and content-aware reviewed (not filename-classified). `HARDENING_5-AUDIT.md` balances tracked == reviewed + justified exclusions == 534/534. Repo-contract guards protect history preservation, executable scoping, duplicate YAML keys, and census integrity. Fifteen defects H5-D0..H5-D15 CLOSED with deterministic regression coverage; mutation/property/fault matrices prove error→clean/fixed/rejected, missing admit, erased backend pins, truncated history, and bypassed hosted proof are all caught.


- **Clean-runner CI executable resolution fixed**: browser provisioning now
  runs through the package that owns playwright (`pnpm --filter
  @inspector/adapter-web provision:browser`) instead of a root `pnpm exec`
  that cannot resolve package-local bins under pnpm's isolated layout — the
  exact failure that red-flagged run 32840538303 and silently skipped the
  Linux integration/Xvfb/smoke lanes. A new `@inspector/repo-contract`
  package mechanically guards workspace-executable scoping in CI, browser-
  provisioning order, duplicate YAML keys in durable state, prompt/canonical-
  state campaign agreement, and M13 naming truth.
- **FileLock ownership fencing**: acquisition persists a mandatory random
  ownership token; release is rename-first + token-checked so a stale
  predecessor can never delete a successor's live lock; takeover requires a
  provably dead owner pid (immediate bounded recovery) or an anonymous aged
  directory — live owners are never age-stolen, closing the two-simultaneous-
  owners window.
- **StateFile write-path atomicity**: unique per-save temps make the unlocked
  reader sweep physically unable to delete a live writer's temp; crash debris
  is swept by age; Windows reader/writer sharing violations are absorbed by a
  bounded rename retry (proven real by the new race suite); POSIX dir fsync
  best-effort after rename.
- **Model-runtime stat truth**: aggregate fallbacksUsed now counts real
  fallback transitions only; every counter's exact semantics pinned on the
  type and ADR-0013 amended.

## HARDENING_3 outcome (whole-system hardening)

- **Fleet liveness made deterministic**: scheduler heartbeat renewals are
  contained (a thrown `LockAcquireError` can no longer crash a controller —
  the exact hosted-CI red class), failed attempts no longer consume the
  cadence slot, and ownership truth is generation fencing only. The
  two-controller scenario reports blocked truth with zero duplicate execution,
  stably.
- **CI hermeticity**: browser-backed proofs reclassified into the integration
  lane; Linux quality gate provisions Chromium explicitly; unit lane runs
  browser-free everywhere. No skips added.
- **ModelRuntime contract made true**: admission/persistence faults are
  fail-closed classified terminal outcomes (`budget-gate-error`,
  `model-store-error`) instead of process crashes or unaccounted spend;
  terminal persistence loss is observable (`storeErrors`).
- **Budget numerics fail closed**: provider estimates/usage are untrusted —
  NaN/Infinity/negative/unsafe values can no longer poison holds, fabricate
  refunds, create headroom, stick ceilings open, or quarantine durable state.
- **Taint audit clean**: model/target-derived text stays inside bounded,
  labeled DATA BLOCKs through planner/suspicion/repair decisions
  (models propose; deterministic gates dispose).

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
REAL web campaign vs a live local app, REAL CLI/PTY campaign, REAL android
campaign item on a live AVD, plus **HARDENING_5-proven** Windows/UIA and Electron
campaign lanes (Windows windows-campaign integration + Electron fleet campaign
both green locally and in hosted CI run 33034546691; Electron production runtime
proven on Windows dev host with Electron 43.4.1 and under Linux Xvfb). No deferred
campaign lane remains.

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
| frozen install | PASS (20 workspace packages) |
| lint | PASS (0 errors; 4 pre-existing warnings) |
| typecheck | PASS |
| test (unit) | PASS — 784 passed / 3 skipped across 79 files (M23 final tree; incl. M14 bench, M15 release-provenance, M16 otel, M17 dashboard, M18 redaction/audit, M19 UIA/PTY/Android retry, M20 pHash/visual, M21 lease parity, M22 property-mutation, M23 GA smoke) |
| test:integration | PASS — 211 passed / 2 skipped (51 files) first-run; incl. real web/PTY/AVD/UIA/Electron lanes plus windows-campaign and verify-regress-truth; single android uiautomator-dump exit-137 environmental flake remains the same documented dual-emulator class (green in isolation) and one display-gated Electron skip |
| installed release smoke | PASS (fresh npm prefix, full command surface incl. M23 GA smoke, campaign fleet checks, model steps) |
| hosted CI | HARDENING_5 certified: run 33034546691 SUCCESS on exact pushed SHA e1e0864 (Linux quality 678/211, Windows incl. windows-campaign, Electron Xvfb production+fleet, installed-artifact smoke — all 4 lanes SUCCESS). Prior H4 certified f687ef1. No new hosted run for M14-M23; local gates green on exact final tree. |
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
| M13 Intelligence-guided autonomy | COMPLETE |
| M14 Replay performance | COMPLETE |
| M15 Release provenance | COMPLETE |
| M16 OTel observability | COMPLETE |
| M17 Operator dashboard | COMPLETE |
| M18 Supply-chain security | COMPLETE |
| M19 Platform fidelity | COMPLETE |
| M20 Visual oracle | COMPLETE |
| M21 Distributed fleet | COMPLETE |
| M22 Property & mutation | COMPLETE |
| M23 GA re-certification | COMPLETE |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
