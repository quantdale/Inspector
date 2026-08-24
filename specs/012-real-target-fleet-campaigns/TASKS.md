# SPEC-012 Task Graph — Real-Target Fleet Campaigns

Legend: `[ ]` open, `[x]` complete. Each task group ends with its named gate
before the next activates.

## F0 — Activation and contracts

- [x] F0.1 Create SPEC.md + TASKS.md for M12.
- [x] F0.2 Add M12 to docs/ROADMAP.md.
- [x] F0.3 Activate M12 in .inspector/state/campaign.yaml; update CHECKPOINT.md.
- Gate: durable state references SPEC-012; no historical evidence rewritten.

## F1 — Execution abstraction in @inspector/scale

- [x] F1.1 `executor.ts`: WorkItemExecutor, ExecutionContext, WorkItemResult,
      failure taxonomy (capability-unavailable / target-incompatible /
      environment-unavailable / target-config-invalid / execution-failure /
      policy-refusal / budget-exhausted).
- [x] F1.2 Extract inline execution into deterministic fake executor behind the
      contract; scheduler takes an executor option and imports no production
      adapter handler in campaign.ts.
- [x] F1.3 Concurrent worker loops under leases with preserved queue priority;
      capability snapshot hook on the executor contract.
- [x] F1.4 Persist assignment decisions + refusals in durable campaign state.
- Gate: PASSED 2026-08-24 — lint 0 errors/4 pre-existing warnings; typecheck
  PASS; unit 533 passed/3 skipped; integration 155 passed/1 skipped (37
  files) first-run; SOAK-J1 fencing accounting exact (stale==injections);
  campaign.ts imports no adapter handler. Two concurrency defects found and
  fixed with regression coverage via the executor seam: (a) scheduleAll could
  return while claims were in flight; (b) a stop racing an item misclassified
  post-stop charges as budget-exhausted and lost fenced-stale accounting —
  charges taken while stopping are now recorded (`allowWhenStopped`) and
  lease-truth reconciliation takes precedence over failure classification;
  finding persistence is idempotent per finding id.

## F2 — Versioned work-item schema and manifest

- [x] F2.1 v2 assignment schema (`inspector-campaign-workitem/1` semantics in
      validateWorkItem) + validation with deterministic error codes; legacy
      WorkItem accepted and normalized (mode regression alias kept).
- [x] F2.2 Manifest file schema (`inspector-campaign-manifest/1`) parsed from
      YAML/JSON: workers, leases, budgets, items with per-item budgets/
      requirements/explicit repair authorization; sha256 provenance recorded.
- [x] F2.2b `campaign validate --manifest <path>` operation with stable JSON
      schema inspector-cli/campaign-validate/1.
- [x] F2.3 CLI `campaign run --manifest <path>` with full pre-flight validation
      (CampaignConfigError -> stable kind manifest-invalid) and durable source-
      manifest provenance; backward-compatible --items path intact.
- Gate: PASSED 2026-08-24 — 9 new scale unit tests + CLI integration test
  (validate/refusals/end-to-end manifest run); lint 0 errors; typecheck PASS;
  unit 542 passed/3 skipped; integration 156 passed/1 skipped.

## F3 — Real workflow services (@inspector/workflows)

- [x] F3.1 New workspace package @inspector/workflows; exploration
      orchestration moved out of packages/cli/src/hunt.ts into service
      functions (runExploration); workspace/spawn helpers, durable hunt meta,
      evidence writing, replay-subject machinery, and the fake/native/web hunt
      engines all shared. CLI keeps thin flag-parsing/output; hunt/explore JSON
      contracts byte-stable (17/17 cli integration tests unchanged).
- [x] F3.2 InspectorWorkflowExecutor implements WorkItemExecutor: per-item
      isolated workspaces retained under campaign artifacts, real RunManager/
      explorer use, honest usage charging (actions/resets/artifactBytes),
      findings + bundle paths returned, campaign/item/worker provenance
      recorded durably in run meta.
- [x] F3.3 verify/regress items reuse the replay/oracle machinery
      (loadReplaySubject/replayDriverFor moved into workflows); repair items
      are policy-refused by default — discovery never implies repair.
- [x] F3.4 Capability probing for workers (browser/pty/uia/adb/electron) with
      deterministic injection seam for tests.
- Gate: PASSED 2026-08-24 — lint 0 errors/4 pre-existing warnings; typecheck
  PASS; unit 542/3 skipped; integration 38 files / 160 passed / 1 skipped.
  Proofs: REAL web hunt item against a live local app through
  UnattendedCampaign (2 workers, isolated retained workspaces, provenance in
  run meta); fake-family item through the full engine pipeline with standard
  evidence bundle; injected-unavailable adb refusal recorded durably;
  real-device android hunt item proven live (55s, AVD) and gated behind
  INSPECTOR_M12_ANDROID_E2E to avoid cross-fork emulator contention.

## F4 — Capability-aware worker routing

- [x] F4.1 probeWorkerCapabilities(): browser (Playwright+Chromium via
      createRequire), PTY (@lydell/node-pty), Windows UIA bridge (encoded
      PowerShell probe), ADB, Electron executable; display tag on capable
      hosts; deterministic injection seam for tests.
- [x] F4.2 Router matches item required family/capability to worker snapshots;
      unroutable items refused durably up front (never executed on a wrong
      worker, never faked); snapshots + assignment decisions persisted in
      campaign state for audit/recovery.
- [x] F4.3 Routing visibility in `campaign show`/run JSON (additive):
      refusals with stable classifications, failureDetails, stopReason,
      per-worker executor/families/capabilities snapshot.
- Gate: PASSED 2026-08-24 — 5 dedicated routing unit tests (family refusal,
      capability shortfall, mixed-fleet routing, unavailable-executor,
      durable refusal/assignment records); CLI campaign integration tests
      green; lint/typecheck/unit gates green.

## F5 — Durable restart/recovery proofs at scale

- [x] F5.1 Crash-hook executor fixtures: abort after evidence persistence
      (post-work death), plus the pre-existing soak hooks for injected worker
      crashes, ghost-controller lease reclaims, and chunked-stop restarts.
- [x] F5.2 Restart matrix over REAL-workflow execution
      (packages/workflows/src/campaign-restart.integration.test.ts):
      death between evidence persistence and completion recording → restarted
      controller completes exactly once with durable item-store evidence and
      monotonic ledger totals; corrupted campaign state fails closed with
      StateCorruptionError (constructor-level); terminal campaigns refuse
      duplicate execution with zero additional spend; stop/resume is
      deterministic (completed work counts once, budget accounting monotonic).
      SOAK-J1 continues to prove 20+ restart injections, fencing, and budget
      non-reset at scheduler level.
- Gate: PASSED 2026-08-24 — restart matrix 4/4 green; full gates: lint 0
  errors/4 pre-existing warnings; unit 547 passed/3 skipped; integration 39
  files / 164 passed / 1 skipped.

## F6 — Cancellation and graceful shutdown

- [x] F6.1 Cooperative cancellation reaches active claims: stop() aborts the
      campaign signal; claims reconcile against durable lease truth (requeue
      when owned, fenced-stale when lost); completed work always counts once.
      Covered by the F5 stop/resume matrix and SOAK-J1 ghost-reclaim interplay.
- [x] F6.2 SIGINT/SIGTERM handling in CLI campaign run: first signal
      cooperatively stops and drains to a deterministic durable final state;
      second signal escalates (exit 130). Wall-clock bound records reason
      `max-wall`. Windows SIGINT delivery is not reliably testable from child
      processes, so the handler is exercised through the stop path in tests;
      documented honestly.
- Gate: PASSED 2026-08-24 — typecheck PASS; campaign + restart integration
  suites green; no orphaned adapter processes in any M12 proof.

## F7 — Finding aggregation and observability

- [x] F7.1 Campaign report aggregation (`summarizeFindings`): total,
      candidates, confirmed, resolved, regressed, flaky, rejected, other;
      duplicate members collapsed via the existing signature clusterer while
      evidence members are preserved; distinct cluster count.
- [x] F7.2 Observability additions (all additive to M11 contracts):
      elapsedMs, findingSummary, refusals, failureDetails, stopReason,
      per-worker executor/family/capability snapshots, source-manifest
      provenance in `campaign show`/run JSON; executor progress lines now
      stream to stderr via CampaignOptions.onProgress (stdout stays clean).
- Gate: PASSED 2026-08-24 — aggregation unit tests; scale+cli suites green;
      lint 0 errors/4 pre-existing warnings.

## F8 — Real multi-target campaign proof

- [x] F8.1 Deterministic real-web campaign proof (local fixture origin).
- [x] F8.2 Real CLI/PTY campaign proof.
- [x] F8.3 Windows/UIA and/or Electron real campaign proof where this host is
      healthy; honest ENVIRONMENT_DEFERRED records otherwise.
      (Recorded honestly at M12 close: web + CLI/PTY + android legs proven;
      no automated Windows/UIA or Electron CAMPAIGN lane exists — the UIA
      bridge and Electron runtime were proven through interactive/native
      paths instead; Electron executable absent on this host at M12 close.)
- [x] F8.4 Android AVD proof if an emulator is available; honest deferral else.
- Gate: PASSED 2026-08-24 (checkboxes reconciled by HARDENING_2 H2.12 — the
  work was completed and evidenced in commit 5d7d0cd but this file was not
  updated at the time): ≥3 genuinely different real adapter families
  exercised through `UnattendedCampaign` (web, cli-pty, android); deferrals
  documented with exact reason. Re-proven post-HARDENING_2 changes: real-web
  + fake-engine suite green; real-android campaign item green in isolation on
  a live AVD (3 actions, honest usage).

## F9 — Web replay runtime efficiency

- [x] F9.1 Baseline measurements recorded (this host, same tree/day):
      canonical seeded-app explore E2E "discovers multiple defects"
      200262ms/209157ms/224313ms across prior full-suite runs; "deterministic
      seed" variant 88412ms/98586ms/87872ms; replay-dense targetUrl suite
      48322ms/57483ms total.
- [x] F9.2 Safe optimization implemented: WebReplayDriver gained opt-in
      `persistent` mode — ONE adapter subprocess reused across a finding's
      reproduce/minimize replays via lifecycle reset (conformance-proven
      identical seeded state) instead of a process+browser launch per replay.
      ExploreController wires it for every confirmation cycle and disposes
      the driver on all paths (new optional ReplayDriver.dispose hook).
      Default non-persistent behavior unchanged for all other consumers.
- Gate: PASSED WITH MEASUREMENTS 2026-08-24 — behavior preserved exactly:
      seeded-app effectiveness (3 hidden defects, evidence bundles) and seed
      determinism both green (226389ms / 87872ms, within the recorded noise
      band of the baselines above; exploration dominates that path).
      Replay-dense targetUrl suite post-change: 6591ms + 12168ms (18.8s wall)
      vs 29.7-48.3s baseline runs; structurally eliminates N-1 adapter
      launches per finding cycle. Deeper phase-level profiling deferred to a
      separately invoked hardening campaign.

## F10 — Installed-artifact campaign proof

- [x] F10.1 release-smoke extended: installed artifact validates a YAML
      campaign manifest (`campaign validate --manifest`), runs a bounded fake
      multi-worker campaign end-to-end from a manifest (`campaign run
      --manifest`, two workers, exactly-once completions), and inspects it via
      `campaign show` with elapsed-time observability.
- [x] F10.2 `yaml` added to esbuild externals + release payload dependencies;
      package-content assertions unchanged (secrets/temp/workspace/test litter
      still rejected); provenance manifest schema inspector-release/2 intact.
- Gate: PASSED 2026-08-24 — `pnpm release:smoke` PASS end-to-end including all
      M12 campaign steps.

## F11 — Documentation and final gate

- [x] F11.1 Docs synced: ROADMAP (M12 COMPLETE + outcomes), STATUS (campaign,
      gates table incl. hosted-CI honesty note), ADR/0011 campaign executor
      contract + manifest schema; CLI help documents manifests/validate;
      PLATFORM-ADAPTERS capability routing noted via doctor parity.
- [x] F11.2 ADR recorded (docs/ADR/0011-campaign-executor-contract.md).
- [x] F11.3 Operator manifest example lives in `inspector help campaign` and
      docs/STATUS.md points operators to it.
- [x] F11.4 Final gate on the exact final tree: lint 0 errors / 4 pre-existing
      warnings; typecheck PASS; unit 549 passed / 3 skipped (50 files);
      integration 165 passed / 1 skipped across 40 files; pnpm release:smoke
      PASS (incl. installed-campaign steps). campaign.yaml m12 COMPLETE with
      evidence; CHECKPOINT.md synchronized.
- Hosted CI: NOT RUN this session — no push authority; lanes remain
  CONFIGURED-not-yet-run and are reported as such everywhere.
