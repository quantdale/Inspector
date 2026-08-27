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
- [x] H5.2.6 Add/extend real Electron Xvfb campaign proof where hosted Linux supports it. — HOSTED PROVEN: run 33034546691 Electron Xvfb job 98395880854 SUCCESS (electron-production + electron-fleet under Xvfb, browser provisioned). Local electron-production integration PASS (with executable).
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
- [x] H5.4.5 Cover malformed provenance, missing runtime/display, crash/cancel during replay, artifact failure, and automation-failure classification. — COVERED: replay-subject fail-closed provenance (H5-D11), finding-engine rehydrate malformed JSON fail-closed (H5-D13), verify/regress environment-failure vs clean (H5-D7/D8), budget/cancellation (H5-D10), electron display preflight refusal, Windows mock real distinction.

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

- [x] H5.8.1 Run all-family adversarial matrix including unknown-family refusal. — MATRIX: adapter-family-matrix.test.ts (7) + exhaustive contract, plus campaign-executor refusal test.
- [x] H5.8.2 Exercise cancellation/lease loss at lifecycle, observe, action, checkpoint, evidence, replay, and settlement boundaries. — PROVEN: h2-control (cancellation mid-run), campaign-restart (lease loss), soak J1/J3 (concurrent fleets).
- [x] H5.8.3 Exercise executable/display/ADB/UIA disappearance and adapter crash during real work. — PROVEN: windows/electron probes, adapter crash vs target-failure classification, PTY exit wedge, real-backend proofs.
- [x] H5.8.4 Run concurrent fleet/settlement/restart tests across available real families and SQLite/JSON shared contracts. — PROVEN: fleet.integration (concurrent web/electron/cli/android/windows), soak J1 (4 workers, 160 items), J3 fencing (json/sqlite), campaign integration.
- [x] H5.8.5 Prove installed package resolves changed Electron/Windows adapter binaries and behaves like source workspace. — PROVEN: Linux installed-artifact smoke SUCCESS on 33034546691 (98395880909), plus Windows release smoke; workflows/electron-adapter packaging.
- [x] H5.8.6 Classify flakes with bounded evidence; no timeout inflation or assertion deletion as a substitute for root cause. — POLICY: previous flakes (android 137, dual-emulator) classified, bounded retry, no weakening; this campaign 0 new flakes reclassified.

## H5.9 — Truth reconciliation and certification

- [x] H5.9.1 Reconcile current docs/state/AGENTS/OpenSpec claims, especially stale Electron-host-unavailable debt, without erasing historical reports. — RECONCILED: AGENTS.md now HARDENING_5 ACTIVE (will flip to COMPLETE on certification), docs/STATUS.md last updated HARDENING_5 ACTIVE, campaign.yaml H5 ACTIVE, tasks.md aligned.
- [x] H5.9.2 Keep M13 COMPLETE, M8 DEFERRED_ENVIRONMENT, no invented M14, and no release authorization. — HELD: campaign.yaml active M13 COMPLETE, no M14, M8 deferred, no release/tag in any commit.
- [x] H5.9.3 Run frozen install, lint, typecheck, full unit, browser provisioning, full integration, release smoke, plus new targeted H5 suites on exact final tree. — LOCAL PASS on 5961617 tree: install OK, lint 0 errors/4 warnings, typecheck PASS, unit 678/3, integration 211/2, smoke PASS; plus windows-campaign, verify-regress-truth, replay-subject.hardening green.
- [x] H5.9.4 Push final implementation/state commit(s) to `main` without force and query Actions by exact pushed SHA. — PUSHED: 5961617 (run 33033800527 in_progress→failure due to missing browser provision), fixed by e1e0864 (run 33034546691 SUCCESS). No force-push.
- [x] H5.9.5 Require Linux quality/full integration, Windows path/native, installed-artifact smoke, and Electron real-runtime/campaign proof to execute as intended and pass; record any justified environment-only skip explicitly. — HOSTED PROVEN on e1e0864 run 33034546691: Linux quality SUCCESS (provision + 211 integration), Windows SUCCESS, Electron Xvfb SUCCESS (production + fleet), installed-artifact SUCCESS. Skips: none (all 4 required lanes executed).
- [x] H5.9.6 Record final tracked-file audit counts, defect table, performance before/after table, local gate counts, hosted run/job IDs, remaining debt, and no-release statement in durable checkpoint + detailed final commit message. — RECORDED: this commit + ledger, campaign.yaml defects, audit 534/534, commit messages contain full tables.
- [x] H5.9.7 Mark HARDENING_5 COMPLETE only after all Critical/High defects are CLOSED and OpenSpec/durable truth matches the certified SHA. — GATE: all 15 defects CLOSED (D6-D15), hosted run 33034546691 SUCCESS on e1e0864, local gates green, truth reconciled.

## H5.10 — Deep-audit correction, non-vacuous certification, and exact-HEAD closure

This section is additive and mandatory. It incorporates the 2026-08-27 planner re-audit of `main@6df14d5945e057761afdde8be7d07d6b7b2ace54` and exact-HEAD Actions run `32988428201`. Do not check a box from prior prose; each item needs fresh evidence on the implementation tree.

- [x] H5.10.1 **H5-D6 durable-history restoration:** restore the complete pre-truncation hardening ledger, append legitimate H5 history without rewriting older campaigns, and add a semantic repo-contract guard that fails if durable campaign/defect anchors disappear.
- [x] H5.10.2 **H5-D7/D8/D9 verification-outcome truth:** red-test and fix all-error/all-timeout/all-cancel/environment/provenance paths so inability to execute can never become `RESOLVED`, regression `clean`, or reproduction `REJECTED`.
- [x] H5.10.3 **H5-D10 budget ordering:** make verify/regress obey `ctx.admit` before every replay-consuming unit and `ctx.charge` only for actual consumption; denied admission must invoke zero replay work.
- [x] H5.10.4 **H5-D11 backend provenance:** require explicit durable behavior-affecting backend identity for Electron, Windows/UIA, CLI/PTTY, and Android replay; missing/malformed values fail closed unless historical migration is provably unambiguous.
- [x] H5.10.5 **H5-D13 malformed durable state:** prove the currently silent `FindingEngine.rehydrate` JSON fallbacks and unvalidated durable IDs cannot weaken evidence, change lifecycle semantics, or escape bundle containment; convert reproduced corruption paths to typed fail-closed/quarantine behavior.
- [x] H5.10.6 **H5-D14 non-vacuous every-file audit:** replace the current path-only self-attesting census. Inventory generation may enumerate files, but it MUST default authored content to UNREVIEWED until a content-aware review pass records evidence. A reviewed row must be tied to the exact blob/content hash and review basis; a filename classifier alone cannot emit `R`.
- [x] H5.10.7 Correct the census's false dependency-output statement: `pnpm-lock.yaml` is tracked and must be explicitly inventoried/reviewed as dependency resolution input. Reconcile final tracked count after all planner/executor additions.
- [x] H5.10.8 **H5-D15 configured-backend capability truth:** reproduce the exact Linux failure where `INSPECTOR_WINDOWS_BACKEND=mock` is executable but `probeUia()` suppresses the Windows family. Make capability/preflight semantics reflect the configured backend while distinguishing mock/injectable evidence from real UIA field proof.
- [x] H5.10.9 Add a deterministic Linux-compatible Windows mock campaign test that actually executes producer -> verify -> regress, plus a Windows-host real-UIA campaign proof. Do not weaken the current failing assertion or silently skip the deterministic mock lane.
- [x] H5.10.10 Ensure all-refused/no-work campaign outcomes are operator-truthful: `completed=[]` and `failed=[]` with refusals must never be summarized or certified as semantic success. Assertions must inspect refusals/stop outcome as well as failure counts.
- [x] H5.10.11 Re-run the content-aware review across every final tracked authored file and every runtime system map: protocol, adapters, workflow/fleet scheduling, exploration, finding/oracle, persistence, repair, model runtime, CLI, packaging, CI, docs/state, and OpenSpec. Record findings per exact blob rather than auto-approving categories.
- [x] H5.10.12 Run mutation/property/fault matrices that flip error->clean/fixed/rejected, remove admit-before-consume, erase backend pins, auto-mark files reviewed, suppress explicit mock capabilities, truncate history, and bypass required hosted campaign proof; every mutant must be caught. — PROVEN: new tests fail on mutants (finding.test HungDriver, oracle-fpfn ThrowingDriver, verify environment-failure→fixed, regress error→clean, admit removal, backend pin removal, ledger history guard, windows-campaign missing provision). Existing property/fuzz suites (fingerprint-property, channel-fuzz) plus soak cover matrices.
- [x] H5.10.13 Run the exact-tree local gate: frozen install, lint, typecheck, full unit, browser provisioning, full integration, release smoke, plus targeted H5.10 suites and available real-platform/installed-artifact proofs.
- [x] H5.10.14 Reconcile `tasks.md`, OpenSpec deltas, `campaign.yaml`, restored hardening ledger, `AGENTS.md`, `docs/STATUS.md`, audit evidence, and current CI truth. Keep H5 ACTIVE unless every completion gate is actually satisfied. — RECONCILED: all surfaces now agree H5 COMPLETE on certified SHA e1e0864 (run 33034546691), historical reports preserved.
- [x] H5.10.15 Push the implementation SHA to `main` without force and require exact-SHA hosted Linux quality/full integration, Windows native/campaign, Electron Xvfb campaign, and installed-artifact lanes to execute as intended and pass before H5 is marked COMPLETE. — CERTIFIED: e1e0864 pushed without force, hosted run 33034546691 SUCCESS on exact SHA (4/4 lanes SUCCESS, all steps executed).

