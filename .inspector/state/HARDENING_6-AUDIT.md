# HARDENING_6 Current-Tree Audit — 2026-08-28

## Executive decision

**Next phase: CODEBASE HARDENING, not a new implementation milestone.**

Inspector already has the intended multi-platform product surface through M23, and current `main` is build/test green. However, the repair/evidence trust boundary still contains confirmed correctness defects capable of producing a false `RESOLVED` conclusion or applying a certified patch unsafely. Those defects are release blockers because repair truth is a core product invariant. Do not start M24 or publish/tag/release until HARDENING_6 is closed.

M8 iOS remains `DEFERRED_ENVIRONMENT` because real iOS execution requires macOS/Xcode. It is documented environment debt, not a reason to invent mock success or block independent hardening work.

## Current repository baseline

- Repository: `quantdale/Inspector`
- Branch: `main`
- Audit baseline commit: `8e6bdb0e7951505972fd59bce550d3ad330d0c22`
- Recursive Git tree: complete (`truncated=false`)
- Tracked blobs: **584**
- Tracked directories: **125**
- Tracked bytes: **3,934,657**
- `packages/`: **337 files across 20 workspaces**
- TypeScript: **304 files**
- Markdown: **116 files**
- Tracked log/evidence files: **64**
- OpenSpec files: **21**
- Historical milestone specs: **47 files** under `specs/`

### Exact-HEAD hosted validation

GitHub Actions run **33092343085** completed **SUCCESS** on exact baseline SHA `8e6bdb0e...`:

| Lane | Job | Result |
| --- | ---: | --- |
| Linux quality gate | 98588294381 | SUCCESS |
| Windows path/native gate | 98588294187 | SUCCESS |
| Linux installed-artifact smoke | 98591344186 | SUCCESS |
| Electron real-runtime proof (Xvfb) | 98591344212 | SUCCESS |

The Linux quality lane executed frozen install, lint, typecheck, unit tests, browser provisioning, and the full integration command. This is strong evidence that the current tree builds and its existing suites pass. It is **not** evidence that missing negative-space tests are unnecessary.

## Audit methodology and evidence discipline

This pass used the complete recursive Git tree as the inventory source, compared the pre-H6 baseline `0385501` with current `8e6bdb0`, inspected package manifests, CI/build/test configuration, milestone/OpenSpec/state truth surfaces, and directly reviewed the highest-risk implementation paths in repair, core run control, artifact handling, protocol/SDK dispatch, and worktree application. Exact-HEAD CI was verified at job/step level.

The audit intentionally separates **inventory coverage** from **semantic review coverage**. A file being enumerated or hashed is not semantic review. This planning pass does not claim that all 584 blobs were semantically reviewed. HARDENING_6 retains a final exact-blob semantic-review gate for every authored blob before certification.

## Architecture and implementation state

| Subsystem | Current state | Audit classification |
| --- | --- | --- |
| Protocol + adapter SDK | Typed/versioned internal protocol; act/observe have validators | Implemented; protocol boundary incompletely validated |
| Web / Playwright | Real adapter and CI browser provisioning | Verified working by current CI |
| CLI / PTY | Native PTY paths and integration suites | Implemented and validated on supported lanes |
| Android / ADB | Adapter plus retry/fidelity work; real field evidence exists historically | Implemented; real-device/AVD proof must remain provenance-honest |
| Windows / UIA | Real bridge plus hosted Windows campaign coverage | Verified working on current hosted lane |
| Electron | Production binding plus Xvfb real-runtime/fleet proof | Verified working on current hosted lane |
| iOS | Injectable interfaces only | `DEFERRED_ENVIRONMENT`; real runtime not certified |
| Exploration / oracle / finding | Mature autonomous pipeline with deterministic/properties/hardening tests | Implemented; preserve while repair truth is hardened |
| Repair | Isolated worktree, regression-first flow, masking probe, optional application | **Implemented but unsafe/incompletely validated at critical trust boundaries** |
| Persistence / artifact store | SQLite + artifact metadata/evidence model | Implemented; missing-artifact handling weakens evidence truth |
| Scale / fleet / leases | Scheduler, budget, lease backend parity, soak/property suites | Implemented and broadly tested |
| Model runtime | Provider-neutral optional assistance with budget/redaction policy | Implemented; not required for deterministic offline behavior |
| Release / CI | Clean install, package smoke, Linux/Windows/Electron lanes | Verified current-tree green; release remains intentionally unpublished |
| Docs / durable state | Extensive milestone + hardening history | **Internally stale before this rebase; must remain synchronized** |

## Verified defect/remediation matrix

| Priority | ID(s) | Affected files | Verified problem | Impact | Required remediation / proof |
| --- | --- | --- | --- | --- | --- |
| **P0 release blocker** | H6-D1, D2, D3 | `packages/repair/src/engine.ts`, `packages/repair/src/regression.ts` | Post-patch replay/regression uses absence of a hard-oracle match as success; masking probe only rejects target-failure/signals; finding transitions to `RESOLVED` before required evidence persistence, while persistence failures are swallowed as best-effort. | Inspector can report a broken or indeterminate repair as fixed and later lose the proof authorizing that state. | Introduce positive execution disposition; require executed-success for reproducer/probe/regression; durably commit required evidence before `RESOLVED`; fault-inject copy/write/fsync/rename failures and prove no false resolution. |
| **P0 release blocker** | H6-D4 | `packages/repair/src/engine.ts`, `packages/repair/src/worktree.ts` | `applyAcceptedPatch()` writes target files sequentially with no exact-revision/clean-target/preimage gate and no transaction/rollback. | Explicit application can modify the wrong checkout or leave a partially applied patch after a mid-write failure. | Preflight authorized Git target, exact HEAD and clean/preimage policy; validate all paths first; apply atomically/all-or-nothing; prove rollback on every injected write failure. |
| **P1 high** | H6-D5 | `packages/repair/src/worktree.ts` | Rejected-attempt rollback uses `git clean -fd`; ignored files survive. | One failed attempt can contaminate the next attempt and falsify verification. | Fresh worktree per attempt or equivalent `-x` cleanup limited to disposable worktree; regression test with ignored poison artifact. |
| **P1 high** | H6-D7 | `packages/core/src/run-manager.ts` | Parsed action outcomes are accepted without explicit `actionId` / `runId` / `environmentId` correlation to the submitted request/controller. | A buggy or compromised adapter can misattribute an outcome and create a durable successful step for the wrong identity. | Fail closed on any correlation mismatch before persistence/accounting; property tests for each mismatched identity. |
| **P1 high / reproduce first** | H6-D8 | `packages/core/src/run-manager.ts` | Controller attribution for returned observations lacks an explicit identity-correlation proof in the reviewed path. | Potential cross-run/environment evidence attribution. | Reproduce with wrong IDs/sequence; enforce controller-owned attribution if reachable; otherwise document lower-layer invariant with regression proof. |
| **P1 high** | H6-D9 | `packages/core/src/run-manager.ts`, artifact store | Missing declared artifact metadata is silently filtered and charged as zero bytes. | Evidence can disappear while the step still appears valid and budget accounting understates use. | Validate ownership/existence/integrity of required refs before commit; fail evidence acceptance on missing/cross-run/corrupt refs; preserve accurate byte accounting. |
| **P1 high** | H6-D0 | `scripts/gen_audit_census.py`, audit/state truth surfaces | Historical H5 audit was incomplete and its generator could self-promote files to REVIEWED from pathname/category. Current tree has grown to 584 blobs. | Completion certification can overstate review coverage. | Separate inventory from semantic evidence; exact blob SHA + reviewer basis; stale hash invalidates review; repo-contract gate rejects missing/stale authored blobs. |
| **P2 medium** | H6-D10 | `packages/adapter-sdk/src/server.ts`, protocol schemas | Server validates act/observe payloads but not full JSON-RPC envelope or initialize/lifecycle/health/cancel parameter contracts. Cancel notification can reach handler via fabricated/default params. | Malformed input reaches handlers inconsistently and weakens protocol guarantees. | Add envelope and per-method validators; preserve JSON-RPC error/notification semantics; fuzz malformed version/id/params. |
| **P2 medium** | H6-D6 | `packages/repair/src/regression.ts` | Generated regression scenario hard-codes `adapter-web`. | Non-web repairs receive false provenance. | Derive adapter/backend/target identity from finding/provider and add non-web repair tests. |
| **P2 medium / reproduce first** | H6-D11 | durable store reconstruction paths | Malformed durable action error payload may be silently omitted by reconstruction. | Corrupt state could be normalized into weaker evidence if reachable. | Inject malformed raw row, prove reachability or lower-layer exclusion, then fail closed or document invariant. |
| **P2 truth-surface** | PLAN-DRIFT | `campaign.yaml`, H6 OpenSpec/prompt/handoff, M23 spec/status | H6 still said “No M14” after M14-M23 were implemented; M23 status text still said full integration pending despite current exact-HEAD integration success. | Autonomous executor can operate against obsolete milestone assumptions. | This planning commit rebases H6 on current post-M23 main and preserves M14-M23 as completed history. |

## Why M14-M23 do not close HARDENING_6

Comparison from H6 activation baseline `0385501` to current `8e6bdb0` shows 17 commits adding M14-M23 work (performance, release provenance, OTel, dashboard, redaction/security, platform fidelity, visual oracle, distributed leases, property tests, GA recertification). The critical H6 implementation files — repair engine/regression/worktree, core run-manager trust checks, AdapterServer validation, and protocol schema boundary — were not changed by that series. Therefore the green M23/HEAD gates and the H6 trust defects can both be true at the same time.

## Existing plans: retain, correct, or supersede

- **Retain** HARDENING_6's repair-trust design and D0-D11 ledger: direct current-code inspection still supports the confirmed items.
- **Rebase** HARDENING_6 from `0385501` to current `8e6bdb0` for execution. The old baseline remains historical evidence.
- **Preserve** M14-M23 as COMPLETE implementation history. Do not rewrite them away and do not invent M24.
- **Preserve** M8 as `DEFERRED_ENVIRONMENT`; never convert injectable/mock iOS behavior into real-runtime proof.
- **Correct** stale status text and planner handoff so the autonomous agent starts from the current tree.
- **Do not** mark H6 complete merely because current CI is green; the existing suite does not exercise the confirmed negative-space failures.

## Dependency-aware execution order

1. **H6.0 — Rebase + audit truth.** Reconfirm clean current main/origin, current exact-SHA CI, build an honest inventory/semantic-review ledger, and red-test the audit generator.
2. **H6.1 — Positive repair evidence.** Add failing tests for adapter crash/cancel/deadline/unknown/zero-work and implement typed execution disposition.
3. **H6.2 — Durable resolution + atomic application + attempt isolation.** Close D3-D6 before any release-readiness work.
4. **H6.3 — Core identity + artifact integrity.** Close D7/D9 and prove/disposition D8.
5. **H6.4 — Protocol boundary.** Validate JSON-RPC envelope and every AdapterServer method contract.
6. **H6.5 — Durable corruption negative space.** Reproduce/disposition D11 and audit parse fallbacks that can weaken evidence.
7. **H6.6 — Whole-repository semantic review.** Review every final authored blob at exact SHA and trace all end-to-end system maps.
8. **H6.7 — Mutation/property/fault/soak.** Prove the new guards are necessary and survive crash/restart/concurrency conditions.
9. **H6.8 — Reconcile + certify.** Full exact-tree local gate, real-platform/source-vs-installed proofs, push, then exact-SHA hosted certification.

## Validation matrix

| Gate | Required evidence | Blocks completion when |
| --- | --- | --- |
| Clean install | `pnpm install --frozen-lockfile` | install/lock drift/failure |
| Static quality | `pnpm lint`, `pnpm typecheck` | any error; warnings must be reviewed |
| Unit | `pnpm test` | failure, new unexplained skip, or missing H6 regression |
| Integration | browser provision + `pnpm test:integration` | failure or required real path silently substituted |
| Repair truth | targeted H6 negative-space/property/fault suite | any operational failure can still become clean/resolved |
| Atomic apply | wrong-revision/dirty/preimage/symlink/mid-write matrix | target can be partially/wrongly modified |
| Core correlation | wrong action/run/env/observation/artifact matrix | mismatch can persist as success |
| Protocol | malformed envelope/method-param matrix | malformed request reaches handler incorrectly |
| Soak/recovery | bounded repair/cancel/crash/restart/concurrency | leaks, false resolution, corrupted durable state |
| Packaging | `pnpm release:smoke` from generated/installed artifact | source-only success masks packaged failure |
| Hosted | Linux quality, Windows native, Electron Xvfb, installed artifact on exact pushed SHA | any required job not SUCCESS |
| Audit | 100% current authored blobs have exact-sha semantic-review evidence | missing/stale/self-attested row |
| Truth surfaces | OpenSpec/tasks/campaign/checkpoints/STATUS/README agree | contradictory active/completed/release claim |

## Release and project-completion gate

HARDENING_6 may be marked COMPLETE only when all confirmed Critical/High-equivalent repair/core defects are closed with deterministic regression evidence; D8/D11 are reproduced/fixed or explicitly dismissed with lower-layer proof; every final authored blob has current semantic-review evidence; exact-tree local gates pass; required real/source-vs-installed proofs remain provenance-honest; and the exact pushed implementation SHA passes Linux, Windows, Electron Xvfb, and installed-artifact hosted lanes.

After H6 closes, do **not** automatically create more work. If no material defects remain, the project is complete for the currently supported environments. If a macOS/Xcode runtime becomes available and full iOS support remains an intended product requirement, resume M8 as the next implementation campaign. Otherwise retain M8 as explicit non-blocking environment debt.

## Planner limitations / handoff rule

This audit used repository/API and exact-HEAD hosted execution evidence; it did not independently execute a second local clone. The executor must re-run the local commands on its checkout and must complete H6.6 semantic review before asserting whole-repository certification. Any changed blob after review invalidates that blob's review evidence.
