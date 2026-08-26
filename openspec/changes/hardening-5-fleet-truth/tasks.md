# HARDENING_5 Tasks

All boxes start unchecked. A box may be checked only after its stated evidence/gate exists. Update this file as evidence changes; do not pre-mark work from planning assumptions.

## H5.0 — Activate, rehydrate, and prove every-file coverage

- [x] H5.0.1 Reconcile `main`/origin/current Actions; record exact baseline SHA and run/job conclusions.
- [x] H5.0.2 Activate HARDENING_5 in canonical durable state + hardening checkpoint and set `.agent/EXECUTION_PROMPT.md` ACTIVE before implementation edits.
- [x] H5.0.3 Read required state/agent/roadmap/status/spec/ADR documents and inspect at least 30 meaningful recent commits/diffs.
- [x] H5.0.4 Generate `.inspector/state/HARDENING_5-AUDIT.md` from the exact `git ls-files` census.
- [x] H5.0.5 Account for every tracked authored file (or explicit justified non-authored/generated exclusion); record tracked/reviewed/excluded counts that balance exactly.
- [x] H5.0.6 Build adapter-family, fleet, replay, persistence/atomic-write, cancellation/restart, installed-artifact, and CI system maps.
- [x] H5.0.7 Create stable H5 defect IDs and evidence lifecycle entries; recheck open issues/PRs.

## H5.1 — Electron fleet false-execution regression

- [x] H5.1.1 Add a deterministic failing regression that submits an Electron campaign item to an Electron-capable workflow executor and proves current misrouting/fallback behavior.
- [x] H5.1.2 Classify severity/blast radius: run identity, environment identity, evidence, findings, usage, success/refusal status, and operator-visible output.
- [x] H5.1.3 Remove unsafe Electron/unknown → fake mapping from `familyAdapter`, `adapterSpawn`, and every equivalent default path.
- [x] H5.1.4 Make workflow adapter types exhaustive for every accepted `AdapterFamily` or explicitly separate family from explorer kind without losing identity.
- [x] H5.1.5 Prove unknown/unimplemented families fail before run/workspace side effects.

## H5.2 — Real Electron campaign lane

- [x] H5.2.1 Define and validate Electron campaign target/backend configuration and capability requirements.
- [x] H5.2.2 Resolve/spawn `@inspector/electron-adapter` exactly in source and installed-artifact modes.
- [x] H5.2.3 Implement Electron hunt/explore through real Inspector workflow services while preserving Electron run/environment/evidence identity.
- [x] H5.2.4 Thread cancellation, action/reset/wall/artifact budgets, checkpoints, finding persistence, and adapter errors through the Electron path.
- [x] H5.2.5 Add deterministic injectable Electron campaign integration coverage.
- [ ] H5.2.6 Add/extend real Electron Xvfb campaign proof where hosted Linux supports it.
- [x] H5.2.7 Prove absent executable/display produces honest typed environment/capability refusal, never skip-as-success or fake fallback.

## H5.3 — Windows/UIA campaign truth

- [x] H5.3.1 Reproduce a campaign-level Windows/UIA work item through manifest → scheduler → workflow → real UIA adapter on Windows.
- [x] H5.3.2 If existing plumbing is already complete, add the missing regression/field proof and leave implementation minimal; otherwise close only evidenced gaps.
- [x] H5.3.3 Prove Windows run/environment/evidence/replay identity and capability-unavailable behavior.
- [x] H5.3.4 Add a bounded hosted Windows campaign-level gate if runner environment permits; otherwise document precise environment limitation.

## H5.4 — Electron replay / verify / regress / resume

- [x] H5.4.1 Add Electron durable replay-driver support or explicit preflight narrowing; accepted Electron findings must never reach the generic unsupported/fake path.
- [x] H5.4.2 Verify Electron source-item references preserve workspace containment, finding, revision, adapter, backend, and target provenance.
- [x] H5.4.3 Prove `verify` and `regress` execute platform-faithfully against Electron.
- [x] H5.4.4 Prove resume reconstructs the same Electron target/backend and rejects mismatched/stale provenance.
- [ ] H5.4.5 Cover malformed provenance, missing runtime/display, crash/cancel during replay, artifact failure, and automation-failure classification.

## H5.5 — Exhaustive adapter-family contract

- [x] H5.5.1 Inventory every family union/list/map/switch in scale, workflows, CLI, metadata, spawn, exploration, replay, finding/evidence, adapters, packaging, tests, docs.
- [x] H5.5.2 Choose a low-drift typed registry/exhaustive-switch strategy consistent with package dependency direction.
- [x] H5.5.3 Add a matrix/property/repo-contract test enumerating all declared families across validation, capability, execution, identity, and replay/refusal.
- [x] H5.5.4 Add a future-family negative fixture proving CI fails if one required layer omits a declared family.
- [x] H5.5.5 Audit all other default/fallback branches for equivalent silent semantic substitution.

## H5.6 — Cross-platform atomic-write durability

- [x] H5.6.1 Inventory all tracked rename/temp/atomic write and orphan cleanup sites with artifact-class durability contracts.
- [x] H5.6.2 Reproduce Windows sharing violations on affected writers (reference: H4 StateFile reader/writer race suite); `writeJsonAtomic` (workflows) and `ArtifactStore.atomicWrite` lacked the share-retry/fasync that StateFile had.
- [x] H5.6.3 Implement bounded transient-sharing retry (EPERM/EACCES/EBUSY, win32-only, 12 attempts) on the workflows atomic writer, artifact-store atomic writer, and scale `writeJsonAtomic`; loud failure preserved after bound.
- [x] H5.6.4 Preserve unique temp ownership (`wx`/pid+uuid), live-writer safety, loud failure, bounded cleanup, and fsync + parent-directory durability.
- [x] H5.6.5 Existing StateFile/artifact-store hardening + soak suites cover retry exhaustion, concurrent readers/writers, crash windows, cleanup races.
- [x] H5.6.6 Re-ran StateFile/FileLock/fleet concurrency + artifact-store soak suites: green, no regression.

## H5.7 — Measured runtime efficiency

- [x] H5.7.1 Record reproducible baseline via `scripts/perf-bench.ts` (StateFile no-op vs changing save cost).
- [x] H5.7.2 No bulk speculative patch applied; each candidate evaluated independently.
- [x] H5.7.3 Prepared-statement caching: N/A for JSON durable state (StateFile); store-sqlite already uses prepared statements — rejected as no-op.
- [x] H5.7.4 Fingerprint co-computation: IMPLEMENTED — `StateFile.save` now set-fingerprint-skips identical re-saves (no fsync/rename). Temp-sweep throttling: already bounded (`MAX_ORPHANS_PER_SWEEP`, age 60s) — rejected as already satisfied.
- [x] H5.7.5 Checkpoint cost: unchanged; no change without crash/resume equivalence proof.
- [x] H5.7.6 CI caching: not pursued (hermetic-clean-runner ownership already proven; no measurable win).
- [x] H5.7.7 Synchronous FileLock waiting: not pursued; SQLite remains production default.
- [x] H5.7.8 Kept only the measured set-fingerprint skip; all other hypotheses recorded as rejected with rationale.

## H5.8 — Negative-space, soak, and installed-artifact sweep

- [ ] H5.8.1 Run all-family adversarial matrix including unknown-family refusal.
- [ ] H5.8.2 Exercise cancellation/lease loss at lifecycle, observe, action, checkpoint, evidence, replay, and settlement boundaries.
- [ ] H5.8.3 Exercise executable/display/ADB/UIA disappearance and adapter crash during real work.
- [ ] H5.8.4 Run concurrent fleet/settlement/restart tests across available real families and SQLite/JSON shared contracts.
- [ ] H5.8.5 Prove installed package resolves changed Electron/Windows adapter binaries and behaves like source workspace.
- [ ] H5.8.6 Classify flakes with bounded evidence; no timeout inflation or assertion deletion as a substitute for root cause.

## H5.9 — Truth reconciliation and certification

- [ ] H5.9.1 Reconcile current docs/state/AGENTS/OpenSpec claims, especially stale Electron-host-unavailable debt, without erasing historical reports.
- [ ] H5.9.2 Keep M13 COMPLETE, M8 DEFERRED_ENVIRONMENT, no invented M14, and no release authorization.
- [ ] H5.9.3 Run frozen install, lint, typecheck, full unit, browser provisioning, full integration, release smoke, plus new targeted H5 suites on exact final tree.
- [ ] H5.9.4 Push final implementation/state commit(s) to `main` without force and query Actions by exact pushed SHA.
- [ ] H5.9.5 Require Linux quality/full integration, Windows path/native, installed-artifact smoke, and Electron real-runtime/campaign proof to execute as intended and pass; record any justified environment-only skip explicitly.
- [ ] H5.9.6 Record final tracked-file audit counts, defect table, performance before/after table, local gate counts, hosted run/job IDs, remaining debt, and no-release statement in durable checkpoint + detailed final commit message.
- [ ] H5.9.7 Mark HARDENING_5 COMPLETE only after all Critical/High defects are CLOSED and OpenSpec/durable truth matches the certified SHA.
