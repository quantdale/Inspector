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

- [ ] F3.1 New workspace package @inspector/workflows; move exploration
      orchestration (request→RunManager→explorer dispatch→evidence) out of
      packages/cli/src/hunt.ts into service functions; CLI keeps thin output
      formatting; hunt/explore JSON contracts byte-stable.
- [ ] F3.2 Inspector workflow executor implementing WorkItemExecutor: per-item
      isolated workspace under campaign artifacts, real RunManager/engine use,
      usage charging from executed actions/resets/artifacts, findings +
      bundle paths returned, provenance (campaignId/workItemId/workerId/runIds)
      recorded durably.
- [ ] F3.3 verify/regress items reuse replay/oracle machinery via services;
      repair items require explicit item authorization AND configured provider,
      otherwise policy-refusal.
- Gate: workflows package unit tests + CLI integration tests prove identical
  command output shapes; campaign integration test runs a REAL web hunt item
  through UnattendedCampaign.

## F4 — Capability-aware worker routing

- [ ] F4.1 probeWorkerCapabilities(): browser (Playwright+Chromium), PTY
      (@lydell/node-pty), Windows UIA bridge, ADB, Electron executable.
- [ ] F4.2 Router matches item required family/capability to worker snapshots;
      unroutable items classified+recorded (never executed on wrong worker);
      snapshots + decisions persisted for audit/recovery.
- Gate: routing unit tests incl. unavailable-capability refusal and mixed-
  fleet assignment; persisted decisions visible in campaign state/show.

## F5 — Durable restart/recovery proofs at scale

- [ ] F5.1 Crash-hook executor fixtures: abort at queued/env-create/active/
      evidence/confirm/renew/complete boundaries.
- [ ] F5.2 Restart matrix tests incl. multiple controller restarts, budget
      non-reset, stale-completion fencing, corrupt-state fail-closed,
      terminal-campaign resume refusal.
- Gate: restart matrix green deterministically (no retries needed).

## F6 — Cancellation and graceful shutdown

- [ ] F6.1 Cooperative cancellation signal reaches workflow service between
      actions; stop() closes adapter/environment resources of active items.
- [ ] F6.2 SIGINT handling in CLI campaign run → cooperative stop →
      deterministic final state; portable tests where the platform allows.
- Gate: stop/resume tests green; no orphaned adapter processes in proofs.

## F7 — Finding aggregation and observability

- [ ] F7.1 Campaign report classes: observations, candidates, confirmed,
      clustered duplicates, flaky, environment failures, automation failures,
      repaired; clustering via existing FindingClusterer with preserved
      evidence links.
- [ ] F7.2 Enriched `campaign show`/run JSON (elapsed, workers busy/available,
      current assignments, queue depth, run IDs, usage incl resets/tokens/
      cost/artifactBytes, lease state, restart count, refusals, stop reason);
      human progress on stderr only.
- Gate: aggregation unit tests; JSON schema assertions; M11 output fields
  remain present (additive change).

## F8 — Real multi-target campaign proof

- [ ] F8.1 Deterministic real-web campaign proof (local fixture origin).
- [ ] F8.2 Real CLI/PTY campaign proof.
- [ ] F8.3 Windows/UIA and/or Electron real campaign proof where this host is
      healthy; honest ENVIRONMENT_DEFERRED records otherwise.
- [ ] F8.4 Android AVD proof if an emulator is available; honest deferral else.
- Gate: ≥2 genuinely different real adapter families exercised through
  `UnattendedCampaign`; deferrals documented with exact reason.

## F9 — Web replay runtime efficiency

- [ ] F9.1 Measure canonical web explore/replay path cost (baseline record).
- [ ] F9.2 Profile dominant costs; implement safe reductions (no weakened
      reproduction/evidence); re-measure and record deltas.
- Gate: measurements recorded in spec/state; full E2E path still passes.

## F10 — Installed-artifact campaign proof

- [ ] F10.1 release-smoke: validate a manifest, run a bounded fake multi-worker
      campaign from the installed artifact, show/list/stop/resume it.
- [ ] F10.2 Package-content assertions still reject secrets/temp/workspace/test
      litter; provenance truthful.
- Gate: pnpm release:smoke PASS including new steps.

## F11 — Documentation and final gate

- [ ] F11.1 Sync README/PRODUCT/ARCHITECTURE/ROADMAP/STATUS/DEVELOPMENT/
      AUTONOMY-MODEL/PLATFORM-ADAPTERS/OBSERVABILITY/SECURITY-MODEL.
- [ ] F11.2 ADR: campaign executor contract + versioned manifest schema.
- [ ] F11.3 Multi-target manifest operator example in docs.
- [ ] F11.4 Final gate: lint/typecheck/test/test:integration/release:smoke +
      M12 acceptance matrix on the exact final tree; campaign.yaml/CHECKPOINT
      synchronized; scoped commits per waypoint.
