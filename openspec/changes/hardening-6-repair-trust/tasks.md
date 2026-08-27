# HARDENING_6 Tasks — rebased 12-hour autonomous execution envelope

Execution baseline: `main@8e6bdb0e7951505972fd59bce550d3ad330d0c22` at planner handoff. If `main` advanced, rebase the audit first and treat every changed blob as unreviewed.

All implementation boxes remain unchecked. Red-test confirmed behavioral defects before fixes. Continue automatically through the next unblocked task; the 12-hour envelope is capacity, not a time-filling requirement.

## H6.0 — Rehydrate current truth and repair audit certification (00:00–01:00)
- [ ] Fetch/prune; require clean `main`; record HEAD/origin/main and ahead/behind.
- [ ] Query Actions for the exact starting SHA. Historical planner evidence: run `33092343085` SUCCESS on `8e6bdb0`; never reuse it for a changed implementation tree.
- [ ] Read campaign/checkpoints/AGENTS/hardening protocol/H1-H5 history/M14-M23 specs/H6 OpenSpec and latest 30 meaningful commits.
- [ ] Re-run exact `git ls-files` census and classify authored source/config/docs/specs separately from generated/evidence logs.
- [ ] Red-test `scripts/gen_audit_census.py`: pathname/category/hash alone must never emit semantic REVIEWED.
- [ ] Extend `.inspector/state/HARDENING_6-AUDIT.md` with exact blob inventory + semantic-review evidence schema.
- [ ] Append H6 ledger section without rewriting historical hardening records.

## H6.1 — Repair positive-evidence semantics (01:00–03:00)
- [ ] Red-test post-patch adapter-crash/cancelled/deadline-exceeded/unknown/driver-throw/zero-outcome; none may pass.
- [ ] Red-test masking probe with the same operational outcomes; none may “survive”.
- [ ] Red-test mixed required-action execution where any required step is indeterminate.
- [ ] Implement typed replay evidence disposition (or equivalent) distinguishing reproduced / clean-executed / operational-failure / cancelled / incompatible / not-executed.
- [ ] Require valid pre-patch reproduction, valid post-patch clean execution, valid masking probe, and valid regression before acceptance.
- [ ] Add property matrix for status/error/empty combinations and audit every repair call site where absence/false/exception can become clean.

## H6.2 — Durable repair + atomic application + attempt isolation (03:00–05:15)
- [ ] Inject regression-copy/record-write/fsync/rename failures; `RESOLVED` must not survive missing required evidence.
- [ ] Prove crash boundaries from verification through evidence commit, state transition, and workspace disposal.
- [ ] Red-test accepted-patch application to wrong revision, dirty checkout, non-Git target, changed preimage, and symlink/junction path.
- [ ] Red-test multi-file second-write failure; target must roll back completely.
- [ ] Implement exact-revision/clean-target/preimage preflight and all-or-nothing application audit.
- [ ] Red-test rejected patch creating an ignored file that poisons the next attempt.
- [ ] Guarantee per-attempt exact-base isolation including ignored artifacts; never destructively clean the operator checkout.
- [ ] Remove hard-coded web regression provenance; add non-web provider tests.

## H6.3 — Core correlation and artifact integrity (05:15–06:45)
- [ ] Red-test wrong outcome actionId/runId/environmentId; no successful durable step may persist.
- [ ] Enforce exact outcome correlation before commit/accounting/return.
- [ ] Red-test wrong observation runId/environmentId/sequence/step identity and close or dismiss H6-D8 with executable evidence.
- [ ] Enforce controller-owned observation attribution where the adapter is not authoritative.
- [ ] Red-test invalid/absent/cross-run/corrupt artifact refs.
- [ ] Fail closed on required missing evidence and preserve accurate artifact budgets.
- [ ] Re-run duplicate/idempotent recovery tests.

## H6.4 — Adapter protocol boundary (06:45–07:45)
- [ ] Inventory validator coverage for every AdapterServer method and JSON-RPC envelope field.
- [ ] Red-test malformed `jsonrpc`, id, initialize/lifecycle/health/cancel params, malformed notifications, and unknown methods.
- [ ] Add schemas/validators and enforce before handler invocation.
- [ ] Preserve correct JSON-RPC error, notification, framing, and crash semantics.

## H6.5 — Durable corruption negative space (07:45–08:30)
- [ ] Prove/dismiss H6-D11 with raw malformed action rows.
- [ ] Audit JSON parse fallbacks in core/store/finding/workflows/repair/model-runtime for evidence weakening.
- [ ] Fault repair workflow/finding/regression/application rows at bounded crash points.
- [ ] Fix reproduced corruption only; document lower-layer guards for non-reproducible suspicions.

## H6.6 — Whole-repository semantic review (08:30–10:00)
- [ ] Review EVERY final tracked authored blob and record exact blob SHA + real semantic review basis; enumeration/hashing alone is insufficient.
- [ ] Trace protocol -> SDK -> core -> store -> artifact boundaries.
- [ ] Trace fake/web/CLI/Android/Windows/Electron/iOS-deferred adapter boundaries.
- [ ] Trace explore -> oracle -> finding -> reproduce -> minimize -> repair -> verify -> regress.
- [ ] Trace scheduler -> admit/budget -> lease/cancel -> settlement/restart.
- [ ] Trace model runtime/provider/redaction/budget/telemetry/repair proposal.
- [ ] Trace CLI/workspace/output/exit semantics and source-vs-installed artifact.
- [ ] Trace build/package/CI/repo-contract/dogfood/docs/spec/state/OpenSpec truth.
- [ ] Re-review every M14-M23 production blob added after original H6 activation.
- [ ] Mechanical gate: no final authored blob may lack current exact-blob semantic review evidence.

## H6.7 — Mutation, property, fault, and soak proof (10:00–11:00)
- [ ] Mutate operational repair result -> clean; tests must fail.
- [ ] Mutate persistence failure -> `RESOLVED`; tests must fail.
- [ ] Remove revision/atomic-rollback guard; tests must fail.
- [ ] Restore ignored-file-preserving rollback; contamination test must fail.
- [ ] Remove outcome/observation identity checks; tests must fail.
- [ ] Restore missing-artifact filtering; tests must fail.
- [ ] Restore path-only audit auto-review; repo-contract must fail.
- [ ] Run bounded repair loops, cancellation/crash/restart/concurrency soak; assert no leaked worktrees/processes or false resolution.

## H6.8 — Reconcile and certify (11:00–12:00)
- [ ] Reconcile OpenSpec/tasks/campaign/checkpoints/ledger/AGENTS/STATUS/README/audit/docs.
- [ ] Preserve M14-M23 COMPLETE, M8 `DEFERRED_ENVIRONMENT`, and no M24/release/tag/publication.
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter @inspector/adapter-web provision:browser`
- [ ] `pnpm test:integration`
- [ ] `pnpm release:smoke`
- [ ] Run H6 targeted mutation/property/fault tests and available real-platform/source-vs-installed proofs.
- [ ] Commit verified slices, reconcile origin, push `main` without force.
- [ ] Query Actions by exact final implementation SHA and inspect required Linux/Windows/Electron/installed-artifact jobs.
- [ ] Mark COMPLETE only when every release-blocking defect is closed, every final authored blob is semantically reviewed, and exact-SHA hosted gates pass.

## Stop rule
Continue automatically through the next unblocked task. Environment-blocked real-platform work is recorded as `DEFERRED_ENVIRONMENT` with exact prerequisite; it is never converted to success. If all material H6 work is genuinely complete, stop rather than inventing M24 or low-value churn.
