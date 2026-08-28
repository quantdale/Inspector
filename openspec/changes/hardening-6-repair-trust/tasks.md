# HARDENING_6 Tasks — rebased 12-hour autonomous execution envelope

Execution baseline: planner handoff `main@8e6bdb0e7951505972fd59bce550d3ad330d0c22`, rebased onto `main@bcd2c91` before implementation. Every changed blob remains unreviewed until the final exact-blob ledger is generated.

H6.0-H6.8 implementation and certification boxes are complete. Red-test
confirmed behavioral defects preceded each fix, every authored tracked blob is
covered by the exact-blob semantic ledger (480/480), and hosted run
33142638356 passed on implementation SHA `8b00f69697596872073d490538e8722688ab41b1`.
The 12-hour envelope was capacity, not a time-filling requirement.

## H6.0 — Rehydrate current truth and repair audit certification (00:00–01:00)
- [x] Fetch/prune; require clean `main`; record HEAD/origin/main and ahead/behind (`bcd2c91`, 0/0).
- [x] Query Actions for the exact starting SHA. Historical planner evidence: run `33092343085` SUCCESS on `8e6bdb0`; never reuse it for a changed implementation tree.
- [x] Read campaign/checkpoints/AGENTS/hardening protocol/H1-H5 history/M14-M23 specs/H6 OpenSpec and latest 30 meaningful commits.
- [x] Re-run exact `git ls-files` census and classify authored source/config/docs/specs separately from generated/evidence logs (590 tracked, 480 authored, 110 explicitly excluded).
- [x] Red-test and fix `scripts/gen_audit_census.py`: pathname/category/hash alone cannot emit semantic REVIEWED.
- [x] Extend `.inspector/state/HARDENING_6-AUDIT.md` with exact blob inventory + semantic-review evidence schema and companion machine ledger.
- [x] Append H6 ledger section without rewriting historical hardening records.

## H6.1 — Repair positive-evidence semantics (01:00–03:00)
- [x] Red-test post-patch adapter-crash/cancelled/deadline-exceeded/unknown/driver-throw/zero-outcome; none may pass.
- [x] Red-test masking probe with the same operational outcomes; none may “survive”.
- [x] Red-test mixed required-action execution where any required step is indeterminate.
- [x] Implement typed replay evidence disposition (or equivalent) distinguishing reproduced / clean-executed / operational-failure / cancelled / incompatible / not-executed.
- [x] Require valid pre-patch reproduction, valid post-patch clean execution, valid masking probe, and valid regression before acceptance.
- [x] Add property matrix for status/error/empty combinations and audit every repair call site where absence/false/exception can become clean.

## H6.2 — Durable repair + atomic application + attempt isolation (03:00–05:15)
- [x] Inject regression-copy/record-write/fsync/rename failures; `RESOLVED` must not survive missing required evidence.
- [x] Prove crash boundaries from verification through evidence commit, state transition, and workspace disposal.
- [x] Red-test accepted-patch application to wrong revision, dirty checkout, non-Git target, changed preimage, and symlink/junction path.
- [x] Red-test multi-file second-write failure; target must roll back completely.
- [x] Implement exact-revision/clean-target/preimage preflight and all-or-nothing application audit.
- [x] Red-test rejected patch creating an ignored file that poisons the next attempt.
- [x] Guarantee per-attempt exact-base isolation including ignored artifacts; never destructively clean the operator checkout.
- [x] Remove hard-coded web regression provenance; add non-web provider tests.

## H6.3 — Core correlation and artifact integrity (05:15–06:45)
- [x] Red-test wrong outcome actionId/runId/environmentId; no successful durable step may persist.
- [x] Enforce exact outcome correlation before commit/accounting/return.
- [x] Red-test wrong observation runId/environmentId/sequence/step identity and close or dismiss H6-D8 with executable evidence.
- [x] Enforce controller-owned observation attribution where the adapter is not authoritative.
- [x] Red-test invalid/absent/cross-run/corrupt artifact refs.
- [x] Fail closed on required missing evidence and preserve accurate artifact budgets.
- [x] Re-run duplicate/idempotent recovery tests.

## H6.4 — Adapter protocol boundary (06:45–07:45)
- [x] Inventory validator coverage for every AdapterServer method and JSON-RPC envelope field.
- [x] Red-test malformed `jsonrpc`, id, initialize/lifecycle/health/cancel params, malformed notifications, and unknown methods.
- [x] Add schemas/validators and enforce before handler invocation.
- [x] Preserve correct JSON-RPC error, notification, framing, and crash semantics.

## H6.5 — Durable corruption negative space (07:45–08:30)
- [x] Prove/dismiss H6-D11 with raw malformed action rows.
- [x] Audit JSON parse fallbacks in core/store/finding/workflows/repair/model-runtime for evidence weakening.
- [x] Fault repair workflow/finding/regression/application rows at bounded crash points.
- [x] Fix reproduced corruption only; document lower-layer guards for non-reproducible suspicions.

## H6.6 — Whole-repository semantic review (08:30–10:00)
- [x] Review EVERY final tracked authored blob and record exact blob SHA + real semantic review basis; enumeration/hashing alone is insufficient.
- [x] Trace protocol -> SDK -> core -> store -> artifact boundaries.
- [x] Trace fake/web/CLI/Android/Windows/Electron/iOS-deferred adapter boundaries.
- [x] Trace explore -> oracle -> finding -> reproduce -> minimize -> repair -> verify -> regress.
- [x] Trace scheduler -> admit/budget -> lease/cancel -> settlement/restart.
- [x] Trace model runtime/provider/redaction/budget/telemetry/repair proposal.
- [x] Trace CLI/workspace/output/exit semantics and source-vs-installed artifact.
- [x] Trace build/package/CI/repo-contract/dogfood/docs/spec/state/OpenSpec truth.
- [x] Re-review every M14-M23 production blob added after original H6 activation.
- [x] Mechanical gate: no final authored blob may lack current exact-blob semantic review evidence.

## H6.7 — Mutation, property, fault, and soak proof (10:00–11:00)
- [x] Mutate operational repair result -> clean; tests must fail.
- [x] Mutate persistence failure -> `RESOLVED`; tests must fail.
- [x] Remove revision/atomic-rollback guard; tests must fail.
- [x] Restore ignored-file-preserving rollback; contamination test must fail.
- [x] Remove outcome/observation identity checks; tests must fail.
- [x] Restore missing-artifact filtering; tests must fail.
- [x] Restore path-only audit auto-review; repo-contract must fail.
- [x] Run bounded repair loops, cancellation/crash/restart/concurrency soak; assert no leaked worktrees/processes or false resolution.

## H6.8 — Reconcile and certify (11:00–12:00)
- [x] Reconcile OpenSpec/tasks/campaign/checkpoints/ledger/AGENTS/STATUS/README/audit/docs; final audit is 590 tracked / 480 reviewed / 0 unreviewed.
- [x] Preserve M14-M23 COMPLETE, M8 `DEFERRED_ENVIRONMENT`, and no M24/release/tag/publication.
- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm --filter @inspector/adapter-web provision:browser`
- [x] `pnpm test:integration` (worker-capped platform gate: 51 files, 230 passed, 2 skipped)
- [x] `pnpm release:smoke`
- [x] Run H6 targeted mutation/property/fault tests and available real-platform/source-vs-installed proofs.
- [x] Commit verified slices, reconcile origin, push `main` without force; implementation SHA `8b00f69697596872073d490538e8722688ab41b1` is pushed.
- [x] Query Actions by exact final implementation SHA and inspect required Linux/Windows/Electron/installed-artifact jobs; run `33142638356` and all four required jobs are SUCCESS.
- [x] Mark COMPLETE only when every release-blocking defect is closed, every final authored blob is semantically reviewed, and exact-SHA hosted gates pass; all conditions are satisfied.

## Stop rule
Continue automatically through the next unblocked task. Environment-blocked real-platform work is recorded as `DEFERRED_ENVIRONMENT` with exact prerequisite; it is never converted to success. If all material H6 work is genuinely complete, stop rather than inventing M24 or low-value churn.
