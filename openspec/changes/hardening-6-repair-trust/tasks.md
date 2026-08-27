# HARDENING_6 Tasks — 12-hour autonomous execution envelope

All boxes start unchecked. Red-test behavioral defects before fixes.

## H6.0 — Rehydrate and repair audit truth (00:00–01:00)
- [ ] Fetch/prune, verify clean `main`, HEAD/origin/main, ahead/behind, and current exact-SHA Actions.
- [ ] Read state/checkpoints/AGENTS/hardening protocol/H5 history/H6 OpenSpec and latest 30 meaningful commits.
- [ ] Reproduce H6-D0: exact `git ls-files` vs H5 audit rows.
- [ ] Red-test audit generator so pathname + hashing cannot emit semantic REVIEWED.
- [ ] Create `.inspector/state/HARDENING_6-AUDIT.md` with inventory separated from semantic-review evidence.
- [ ] Append H6 ledger section without rewriting H1-H5 history.

## H6.1 — Repair positive-evidence semantics (01:00–03:00)
- [ ] Red-test post-patch adapter-crash/cancelled/deadline-exceeded/unknown/driver-throw/zero-outcome; none may pass.
- [ ] Red-test masking probe with the same operational outcomes; none may “survive”.
- [ ] Red-test mixed required-action execution where any step is indeterminate.
- [ ] Implement typed replay evidence disposition or equivalent non-boolean contract.
- [ ] Require valid pre-patch reproduction, valid post-patch clean execution, valid masking probe, and valid regression before acceptance.
- [ ] Add property matrix for status/error/empty combinations.
- [ ] Audit every repair call site where absence/false/exception can become clean.

## H6.2 — Durable repair + atomic application (03:00–05:15)
- [ ] Inject regression-copy/record-write/fsync/rename failures; RESOLVED must not survive missing required evidence.
- [ ] Prove crash boundaries from verification through evidence commit, state transition, and disposal.
- [ ] Red-test accepted-patch application to wrong revision, dirty checkout, non-Git target, changed preimage, and symlink/junction path.
- [ ] Red-test multi-file second-write failure; target must roll back completely.
- [ ] Implement exact-revision/clean-target preflight and all-or-nothing application audit.
- [ ] Red-test rejected patch creating an ignored file that poisons next attempt.
- [ ] Guarantee per-attempt exact-base isolation including ignored artifacts.
- [ ] Remove hard-coded web regression provenance; add non-web provider tests.

## H6.3 — Core correlation and artifact integrity (05:15–06:45)
- [ ] Red-test wrong outcome actionId/runId/environmentId; no success step may persist.
- [ ] Enforce exact outcome correlation before commit/accounting/return.
- [ ] Red-test wrong observation runId/environmentId/sequence/step identity and close H6-D8 based on evidence.
- [ ] Enforce controller-owned observation attribution.
- [ ] Red-test invalid/absent/cross-run/corrupt artifact refs.
- [ ] Fail closed on required missing evidence and preserve accurate artifact budgets.
- [ ] Re-run duplicate/idempotent recovery tests.

## H6.4 — Adapter protocol boundary (06:45–07:45)
- [ ] Inventory validator coverage for every AdapterServer method.
- [ ] Red-test malformed JSON-RPC version/id and initialize/lifecycle/health/cancel params.
- [ ] Add schemas/validators and enforce before handler invocation.
- [ ] Preserve correct error/notification/framing behavior.

## H6.5 — Durable corruption negative space (07:45–08:30)
- [ ] Prove/dismiss H6-D11 with raw malformed action rows.
- [ ] Audit JSON parse fallbacks in core/store/finding/workflows/repair/model runtime for evidence weakening.
- [ ] Fault repair workflow/finding/regression/application rows at bounded crash points.
- [ ] Fix only reproduced corruption; document lower-layer guards for non-reproducible suspicions.

## H6.6 — Whole-repository semantic review (08:30–10:00)
- [ ] Review EVERY final tracked authored blob and record exact blob SHA + real semantic review basis.
- [ ] Trace protocol -> SDK -> core -> store -> artifact boundaries.
- [ ] Trace fake/web/CLI/Android/Windows/Electron/iOS/deferred adapter boundaries.
- [ ] Trace explore -> oracle -> finding -> reproduce -> minimize -> repair -> verify -> regress.
- [ ] Trace scheduler -> admit/budget -> lease/cancel -> settlement/restart.
- [ ] Trace model runtime/provider/redaction/budget/telemetry/repair proposal.
- [ ] Trace CLI/workspace/output/exit semantics and source-vs-installed artifact.
- [ ] Trace build/package/CI/repo-contract/dogfood/docs/spec/state truth.
- [ ] Mechanical gate: no final authored blob may lack current exact-blob semantic review evidence.

## H6.7 — Mutation, property, fault, soak (10:00–11:00)
- [ ] Mutate operational repair result -> clean; tests must fail.
- [ ] Mutate persistence failure -> RESOLVED; tests must fail.
- [ ] Remove revision/atomic-rollback guard; tests must fail.
- [ ] Restore `git clean -fd`; ignored contamination test must fail.
- [ ] Remove outcome/observation identity checks; tests must fail.
- [ ] Restore missing-artifact filtering; tests must fail.
- [ ] Restore path-only audit auto-review; repo-contract must fail.
- [ ] Run bounded repair loops, cancellation/crash/restart/concurrency soak; assert no leaked worktrees/processes or false resolution.

## H6.8 — Reconcile and certify (11:00–12:00)
- [ ] Reconcile OpenSpec/tasks/campaign/checkpoints/ledger/AGENTS/STATUS/audit/docs.
- [ ] Keep M13 COMPLETE, M8 DEFERRED_ENVIRONMENT, no M14, no release/tag/publication.
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter @inspector/adapter-web provision:browser`
- [ ] `pnpm test:integration`
- [ ] `pnpm release:smoke`
- [ ] Run H6 targeted mutation/property/fault and available real-platform/source-vs-installed proofs.
- [ ] Commit verified slices, reconcile origin, push `main` without force.
- [ ] Query Actions by exact implementation SHA and inspect required Linux/Windows/Electron/installed-artifact jobs.
- [ ] Mark COMPLETE only when every Critical/High defect is closed, every final authored blob is semantically reviewed, and exact-SHA hosted gates pass.

## Stop rule
Continue automatically through the next unblocked task. Environment-blocked real-platform work is recorded as DEFERRED_ENVIRONMENT with exact prerequisite; it is never converted to success. The 12-hour envelope is a workload target, not permission to pad work after all gates are genuinely complete.
