# Inspector Execution Prompt — HARDENING_5 Deep-Audit Completion

**Status:** COMPLETE (2026-08-27) — HARDENING_5 Fleet Execution Truth certified on `e1e0864` (run 33034546691 SUCCESS); final state-sync `89bd974` records completion  
**Campaign:** HARDENING_5 — Fleet Execution Truth, now extended through verification-truth and provenance-integrity closure (COMPLETE)  
**Mode:** HARDENING  
**Target branch:** `main` only  
**Audit/planning baseline:** `04d8d841d7d1db322800fa0b8439878639d2c81d`  
**OpenSpec change:** `openspec/changes/hardening-5-fleet-truth/`  
**Executor envelope:** target roughly **12 hours of productive autonomous execution**. Do not stop after the first green patch or first closed defect. If correctness work finishes early, spend the remaining useful campaign budget on the specified mutation/property/fault-injection/real-backend/installed-artifact proof. Do not manufacture refactors merely to consume time.

## 0. Why this remains HARDENING_5 instead of opening HARDENING_6

Do **not** create HARDENING_6 yet. H5 remains canonically ACTIVE and its existing OpenSpec still has unfinished H5.4.5, H5.8, and H5.9 requirements. The deep audit found correctness defects that fall directly inside those unfinished replay/error-classification/adversarial/certification gates. Starting a new campaign would hide incomplete H5 truth.

Preserve all landed H5 work. Resume the first genuinely incomplete requirement after reconciling live `main`; do not redo already-evidenced H5.0-H5.7 work except where a new regression disproves an earlier claim.

## 1. Planning-baseline facts — recheck, never blindly trust

At planner audit time:

- `main` = `04d8d841d7d1db322800fa0b8439878639d2c81d`.
- The existing H5 tracked-file census reported 530/530 reviewed, zero exclusions. New planner files change that count; regenerate the census on the executor's live tree.
- `openspec/changes/hardening-5-fleet-truth/tasks.md` still left H5.2.6, H5.4.5, H5.8.1-H5.8.6, and H5.9.1-H5.9.7 unchecked.
- `.inspector/state/campaign.yaml` nevertheless says H5.8 DONE and H5.9 PENDING: this is durable-state/task truth drift.
- `AGENTS.md` and `docs/STATUS.md` still describe H4/no-active-campaign current state while `campaign.yaml` says H5 ACTIVE.
- GitHub Actions run 32985028766 for planner baseline HEAD was queued when audited. A queued run is not certification.

The executor MUST fetch/prune, compare HEAD/origin/main, inspect Actions for the **current** exact SHA, and preserve any legitimate newer concurrent work before editing.

## 2. New deep-audit findings — stable H5 IDs

Treat these IDs as durable ledger keys. Static source evidence is enough to call the contradictory code path CONFIRMED, but establish a deterministic red regression before modifying production behavior and set final severity from demonstrated blast radius.

### H5-D6 — durable hardening ledger history deletion — CONFIRMED

Current `04d8d841` replaced `.inspector/state/HARDENING-CHECKPOINT.md` with the H5.9 fragment and removed roughly 698 historical lines that existed at parent `05254ffcdc89ada6e1555e448096b56483946f06`. This violates `docs/HARDENING-CAMPAIGN.md` (hardening must never erase durable implementation state) and the H5 activation contract to preserve prior campaign history.

**First blocker:** restore the historical ledger from the last intact parent and append the legitimate H5.9 material without rewriting history. Add a mechanical repo-contract guard so a future state-sync commit cannot delete campaign/defect history referenced by `campaign.yaml`.

### H5-D7 — campaign verify can resolve a confirmed defect after environment failure — CONFIRMED

In `packages/workflows/src/campaign-executor.ts`, verify computes `environment-failure` when replay attempts error, but then transitions a `CONFIRMED` finding to `RESOLVED` for every classification except `reproduced`. Therefore “could not verify because the environment/adapter failed” can become “fixed”.

Required invariant: **absence of valid reproduction is not evidence of a fix**. A confirmed finding may move to `RESOLVED` only after the configured verification policy receives sufficient **successful, environment-valid, clean** replay evidence. Environment/provenance/adapter/cancellation failures leave the finding unresolved and return a typed indeterminate/environment result.

### H5-D8 — campaign regress can count replay errors as clean — CONFIRMED

`runRegressItem` catches replay exceptions and records `reproduced:false`; summary then counts those entries as `clean`. Replay-driver/provenance failures can also be skipped, allowing zero genuinely executed scenarios to return an OK result.

Required invariant: a regression scenario is `clean` only after a replay actually executes in a valid environment and its oracle evaluation is clean. Environment/adapter/provenance/cancellation errors are neither reproduced nor clean. Zero valid scenarios is not success.

### H5-D9 — reproduction engine can reject a finding when every replay errored — CONFIRMED

`packages/finding/src/finding-engine.ts` increments `errors` for replay-driver failures, then maps `successes === 0` to `REJECTED` regardless of whether any clean replay completed. `packages/finding/src/finding.test.ts` currently pins this behavior: a timeout-only `HungDriver` test expects `REJECTED`.

This contradicts the repository's own M2 contract to distinguish environment nondeterminism from target non-reproduction. Correct the semantic contract intentionally; do not preserve the wrong test just because it is green.

Required invariant: `REJECTED` requires positive evidence from valid completed replays that the candidate does **not** reproduce. If all attempts error/timeout/cancel, preserve a non-terminal/indeterminate finding state allowed by the lifecycle (normally CANDIDATE/FLAKY according to the final design) and persist the error evidence.

### H5-D10 — verify/regress bypass the scheduler's admit-before-consume contract — CONFIRMED

`ExecutionContext` requires `ctx.admit(...)` before a budgeted unit and `ctx.charge(...)` after actual consumption. Campaign verify/regress currently call `ctx.charge(...)` before replay and do not use `admit` for those replay units.

Required invariant: authorization precedes replay/action consumption; accounting reflects actual consumption; cancellation/environment failure cannot create fabricated successful work or silently reset budget truth.

### H5-D11 — durable adapter family can survive while backend identity silently changes — REPRO REQUIRED

Electron durable replay accepts missing/unrecognized `INSPECTOR_ELECTRON_BACKEND` and falls back to `ElectronReplayDriver` auto mode; auto may select `real` or `injectable` based on the **current host**. The Electron hunt reproduction factory also constructs a replay driver without explicitly pinning the backend that produced the run. Audit equivalent real/mock seams for Windows/UIA, CLI/PTTY, and Android.

Required invariant: durable replay identity is at least `{adapter family, durable adapter id, backend mode, target identity, revision/environment provenance}` where those dimensions affect behavior. A real finding must never be reclassified using a mock/injectable backend merely because the current machine differs. Missing/malformed backend provenance must be migrated only when logically unambiguous; otherwise fail closed with a typed compatibility/environment outcome.

### H5-D12 — certification can be green without exercising new campaign-level platform paths — CONFIRMED

Audit findings:

- `packages/workflows/src/campaign-executor.integration.test.ts` contains a tautological `webFindings.length >= 0` assertion.
- Its real Android campaign test returns early when `INSPECTOR_M12_ANDROID_E2E` is absent; the default run can report the test green without executing the real-device proof.
- the Windows hosted job does not currently execute the new H5 `windows-campaign.integration.test.ts` campaign-level path;
- the Electron/Xvfb job proves the adapter runtime but not the H5 fleet/campaign orchestration path.

Required invariant: a certification claim names what actually executed. Environment-gated proofs are explicit skipped/deferred evidence, never pass-by-return. Hosted Windows/Electron jobs must exercise the changed campaign-level path when their environment can support it. Installed-artifact proof must cover the changed workflow, not only source checkout behavior.

### H5-D13 — malformed durable finding/provenance data may degrade silently — SUSPICION

`FindingEngine.rehydrate` currently converts malformed JSON fields to empty arrays/null; replay bundle paths are constructed from durable IDs. Determine whether these are protected by lower-layer validation. Add adversarial persisted-state tests before changing behavior. If corruption can reach these paths, fail closed/quarantine instead of silently weakening evidence or escaping contained storage. Do not overstate this defect unless reproduced.

## 3. OpenSpec execution contract

Read in this order before implementation:

1. `openspec/changes/hardening-5-fleet-truth/proposal.md`
2. `openspec/changes/hardening-5-fleet-truth/design.md`
3. every existing delta under `openspec/changes/hardening-5-fleet-truth/specs/`
4. **new** `specs/verification-outcome-truth/spec.md`
5. **new** `specs/replay-backend-provenance/spec.md`
6. **new** `specs/durable-history-integrity/spec.md`
7. `openspec/changes/hardening-5-fleet-truth/AUDIT-ADDENDUM.md`
8. `openspec/changes/hardening-5-fleet-truth/tasks.md`

Before product edits, extend `tasks.md` with an H5.10 deep-audit correction section representing H5-D6..D13 and this prompt's gates. Do not pre-check tasks. Existing unchecked H5.4.5/H5.8/H5.9 tasks remain required; H5.10 is additive and must finish before H5 can be COMPLETE.

If OpenSpec CLI/tooling is available, validate/show the change before implementation and run its normal apply workflow. If not, the Markdown contract remains authoritative.

## 4. Mandatory rehydration and audit mechanics

Before any implementation edit:

1. fetch/prune origin, verify `main`, worktree cleanliness, HEAD/origin/main, ahead/behind, open PR/issues, and current Actions;
2. read `.agent/PLANNER_HANDOFF.md`, this prompt, `AGENTS.md`, `docs/HARDENING-CAMPAIGN.md`, `docs/STATUS.md`, `docs/ROADMAP.md`, `.inspector/state/campaign.yaml`, `.inspector/state/CHECKPOINT.md`, and the hardening ledger;
3. inspect at least the latest 30 meaningful commits/diffs, with special attention to H4/H5 state-sync commits and H5 workflow/electron/windows changes;
4. restore H5-D6 history first and create the guard before broad code changes;
5. regenerate `.inspector/state/HARDENING_5-AUDIT.md` from exact `git ls-files`; every newly added planner/spec/test/source file must be accounted for;
6. create/update the H5 defect ledger with SUSPICION -> EVIDENCE -> SEVERITY -> RED TEST -> FIX -> TRANSITIVE GATE -> CLOSED lifecycle.

Do not implement from this prose alone. Re-read the live source and tests after pull.

## 5. Required system maps

Trace each map through happy path plus invalid input, timeout, cancellation, environment loss, crash/restart, corruption, and installed-artifact execution:

```text
candidate -> reproduce -> replay attempt disposition -> oracle -> finding lifecycle -> evidence
```

```text
campaign verify -> source workspace -> load replay provenance -> driver -> replay -> oracle -> classification -> finding transition -> result
```

```text
campaign regress -> durable finding(s) -> driver -> replay -> scenario outcome -> aggregate summary -> campaign settlement
```

```text
manifest -> scheduler -> ctx.admit -> replay/action -> ctx.charge -> cancellation/lease loss -> settlement/restart
```

```text
adapter family -> durable adapter id -> backend mode -> target/create options -> spawn env -> finding/evidence -> replay/verify/regress/resume
```

```text
campaign.yaml/OpenSpec/tasks -> hardening ledger -> AGENTS/STATUS -> exact SHA -> hosted jobs -> certification claim
```

## 6. Twelve-hour execution envelope

The times below are sequencing targets, not excuses to stop useful work early or to pad work. Rebalance when a defect takes longer, but preserve order: correctness before optimization/cosmetic cleanup.

### Wave 0 — 00:00–00:45 — baseline, H5-D6 restoration, audit refresh

- reconcile live Git/Actions/OpenSpec state;
- restore the full hardening ledger history from the last intact commit and append current H5 entries;
- add a repo-contract history-preservation test/guard;
- regenerate the every-file census and create the H5.10 task ledger.

### Wave 1 — 00:45–02:30 — red tests for verification truth

Create deterministic failing regressions before fixes for:

- all replay attempts error/timeout -> finding MUST NOT become REJECTED;
- verify all attempts environment-fail -> CONFIRMED finding MUST NOT become RESOLVED;
- verify valid clean replay -> may resolve only when policy is satisfied;
- regress replay error -> not counted clean;
- regress zero valid scenarios -> typed failure/indeterminate, not OK-clean;
- mixed reproduced/clean/error attempts -> exact deterministic classification;
- cancellation at each replay boundary -> no false clean/fixed state;
- budget denial before replay -> zero replay invocation.

### Wave 2 — 02:30–04:15 — implement typed replay/verification semantics

Prefer an explicit multi-valued result over boolean collapse. A narrow union/helper is sufficient if it preserves architecture; do not build a framework for its own sake. The semantic vocabulary must distinguish at least:

- reproduced target defect;
- valid clean replay;
- environment/adapter failure;
- incompatible/invalid provenance;
- cancellation/budget refusal.

Only **valid clean replay evidence** can support `fixed`, `clean`, or `REJECTED`. Driver failure is never clean evidence.

Audit every call site that currently turns exception/absence into `false`, `clean`, `fixed`, `rejected`, `success`, or zero-count OK.

### Wave 3 — 04:15–05:30 — budget, cancellation, and lifecycle atomicity

- enforce admit-before-consume on verify/regress replay work;
- charge actual usage after execution according to existing scheduler semantics;
- inject cancellation/lease loss before replay, during replay, between oracle evaluation and finding mutation, and before settlement;
- prove restart cannot repeat a committed state transition or turn indeterminate work into success.

### Wave 4 — 05:30–07:00 — exact backend provenance

- reproduce H5-D11 on Electron first;
- pin discovery/reproduction/minimization/verify/regress/resume to durable backend mode;
- audit Windows real/mock, CLI real/mock, Android real/mock/injected seams for the same class;
- prove current-host capability changes cannot silently change historical replay meaning;
- add migration/refusal behavior for older records missing backend provenance; never infer a different backend merely because it is available now.

### Wave 5 — 07:00–08:00 — durable corruption and containment negative space

- malformed finding JSON, evidence JSON, create options, spawn env, IDs, sourceItemId, bundle paths;
- missing bundles, stale revision, adapter/backend disagreement;
- symlink/junction/path traversal where a durable field participates in a filesystem path;
- SQLite corrupt/partial rows and crash windows around relevant writes.

Close H5-D13 only if reproduced. Otherwise document the exact guard/lower-layer invariant that makes it unreachable.

### Wave 6 — 08:00–09:15 — certification-path repair

- remove/replace tautological assertions;
- make environment-gated real proofs explicitly report skipped/deferred rather than pass by returning;
- extend Windows hosted coverage to the H5 campaign-level UIA path where runner UIA constraints permit;
- extend Electron Xvfb coverage through the **workflow/fleet campaign path**, not only adapter conformance;
- exercise source and built/installed artifact parity for changed verify/regress/backend paths;
- preserve hermetic clean-runner behavior.

### Wave 7 — 09:15–10:15 — mutation/property/state-machine campaign

Manually or with existing repository tools, introduce bounded mutants and prove the new tests catch them. At minimum mutate:

- `environment-failure` -> `fixed`;
- replay exception -> `clean`;
- all-error reproduction -> `REJECTED`;
- omit `ctx.admit` or move charge before replay;
- remove Electron/backend pinning;
- delete a historical hardening-ledger section;
- skip a campaign-level hosted proof.

Also run seeded/property matrices for attempt outcome combinations and family/backend pairs. Record mutation evidence; do not leave mutants in Git.

### Wave 8 — 10:15–11:00 — soak and resource/lifecycle proof

Use remaining useful time for bounded high-value soak, not generic refactors:

- repeated verify/regress with injected target crash vs adapter crash vs environment loss;
- cancellation/lease loss at boundary matrices;
- concurrent source-referenced items and restart;
- Electron real/injectable provenance repetition; Windows real/mock when available;
- installed artifact repeated executions;
- assert no orphan subprocess/temp/evidence corruption attributable to Inspector.

### Wave 9 — 11:00–11:30 — truth reconciliation

Reconcile OpenSpec/tasks, `.inspector/state/campaign.yaml`, hardening ledger, `AGENTS.md`, `docs/STATUS.md`, audit census, and any current-debt prose. Preserve historical reports verbatim unless they are factually corrupt files; current-state prose may be corrected.

Keep M13 COMPLETE, M8 `DEFERRED_ENVIRONMENT`, and no M14. No release/tag/publication.

### Wave 10 — 11:30–12:00 — exact-tree gates, push, hosted proof

Run on the exact final tree:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @inspector/adapter-web provision:browser
pnpm test:integration
pnpm release:smoke
```

Plus all targeted H5.10 tests and any real-platform jobs runnable locally.

Commit coherent verified slices, pull/reconcile if origin moved, and push to `main` without force. Query Actions by the **exact pushed implementation SHA** and inspect job/step conclusions. If hosted CI is still queued/running when the execution window ends, keep H5 ACTIVE/PENDING and record that honestly; never self-certify a SHA whose required hosted lanes have not completed.

## 7. Acceptance gate — H5 cannot COMPLETE until every item is true

1. H5-D6 historical hardening ledger is restored and mechanically protected from destructive state-sync truncation.
2. No all-error/timeout/cancel reproduction path can produce `REJECTED` as though a clean replay occurred.
3. No verify environment/adapter/provenance failure can produce `RESOLVED`/`fixed`.
4. No regress environment/adapter/provenance failure can be counted as `clean`; zero valid scenarios is not an OK-clean result.
5. Replay outcome semantics are explicit and mutation-sensitive across finding/workflow callers.
6. Verify/regress obey admit-before-consume and actual-use accounting; cancellation/lease-loss cannot fabricate completion.
7. Backend provenance is exact across replay-capable families; real/mock/injectable substitutions are explicit test fixtures only, never silent durable replay behavior.
8. H5.4.5 and H5.8 adversarial requirements are actually exercised or honestly environment-deferred with evidence.
9. Changed Windows/Electron workflow/fleet paths execute in their suitable hosted environments; installed artifact matches source behavior.
10. Tests contain no tautological assertions or pass-by-return constructs used as evidence for required real-runtime certification.
11. Every tracked authored file on the final tree is in the regenerated H5 census and `reviewed + justified exclusions == tracked`.
12. All Critical/High defects discovered in H5 are CLOSED with deterministic regression coverage; lower-severity debt is explicit.
13. OpenSpec/tasks, campaign state, hardening ledger, AGENTS/STATUS, and implementation agree.
14. Local full gates pass on the exact final tree.
15. Required hosted lanes pass on the exact pushed implementation SHA and are verified to have actually executed intended steps.
16. No release, tag, deployment, force-push, destructive external action, or hidden assertion weakening occurred.

## 8. Git and final reporting

- Persistent branch is `main`; disposable local worktrees are fine but leave no persistent campaign branch.
- Never force-push or discard concurrent work.
- Keep implementation + regression + state update together when practical.
- The final implementation commit message must be a detailed session report containing: baseline SHA/CI; every-file counts; H5-D6..D13 final classifications; root causes; exact fixes/tests; mutation/soak evidence; budget/provenance semantics; local gate counts; hosted run/job IDs for the certified SHA; environment deferrals; remaining debt; and explicit no-release/no-tag statement.
- Push every durable checkpoint needed for another machine to resume from Git alone.

If this prompt, an older H5 prompt statement, and the OpenSpec deltas differ, the stricter safety/correctness invariant wins. Update OpenSpec/tasks/state together before claiming completion.

---

## Planner re-audit delta — 2026-08-27 (AUTHORITATIVE latest evidence)

This section is the latest planner evidence and is additive to the campaign above. Where an older baseline/status statement conflicts with this section, **this section wins**. Do not open H6; these defects are unfinished H5 truth/certification work.

### Current repository/CI anchor

- Current planner HEAD: `6df14d5945e057761afdde8be7d07d6b7b2ace54`.
- Exact-HEAD Actions run: `32988428201` — **FAILURE**.
- Linux quality job `98239998815`: install/lint/typecheck/unit/browser provisioning PASS; full integration FAIL.
- Unit: 64 files / 676 tests PASS.
- Integration: 50 files total, 47 passed / 2 skipped / 1 failed; 211 tests total, 205 passed / 5 skipped / 1 failed.
- Failure: `packages/workflows/src/windows-campaign.integration.test.ts`; expected producer + verify + regress completed, received `completed=[]` while `failed=[]`.
- Windows path/native hosted job PASS.
- Electron Xvfb and Linux installed-artifact jobs SKIPPED downstream of Linux failure; they are not current-SHA certification.

The failure is explained by source: the deterministic test explicitly sets `INSPECTOR_WINDOWS_BACKEND=mock`, while `InspectorWorkflowExecutor.capabilities()` advertises Windows only when `probeUia()` succeeds. On Linux, `probeUia()` returns unavailable before configured mock executability is considered. The scheduler therefore records routing refusals and removes all three items from the queue.

### Additional stable defect IDs

#### H5-D14 — every-file audit certificate is self-attesting — CONFIRMED

`scripts/gen_audit_census.py` does not inspect file contents. Its path classifier unconditionally returns `R` for every tracked file category, so the reported `530 reviewed / 530 tracked` was arithmetic inventory coverage, not proof that every file was reviewed. It also says lockfile/dependency output is untracked even though `pnpm-lock.yaml` is tracked.

Required correction:

- keep mechanical inventory, but default authored blobs to UNREVIEWED;
- bind every review record to the exact blob/content hash;
- require a content-aware review basis and relevant system-map/finding notes before status becomes REVIEWED;
- invalidate review evidence whenever the blob changes;
- explicitly review tracked lockfiles/manifests as dependency/configuration surfaces;
- regenerate against the final tracked tree after all implementation/state/spec changes.

A balanced count generated from filename categories is **not** an acceptance gate.

#### H5-D15 — configured backend and advertised capability disagree — CONFIRMED

The explicit Windows mock backend is a real deterministic executable path on the Linux test host, but worker capability discovery models only real UIA host availability. This makes valid configured work disappear into `refusals` before execution and caused exact-HEAD CI run `32988428201` to fail.

Required correction:

- capability discovery/preflight must describe what the **configured executor/backend** can execute, not only what the strongest real backend can execute;
- mock/injectable/test capability must be explicitly distinguishable from real field capability and must never be presented as real proof;
- deterministic mock campaign tests must execute cross-platform when explicitly configured;
- real Windows/UIA certification still requires a real Windows runner/target;
- all-refused/no-work outcomes must remain operator-visible and cannot be treated as semantic success simply because `failed=[]`.

Do not "fix" this by deleting the Linux test, changing it to pass-by-return, or pretending mock execution is real UIA certification.

### Strengthened status of earlier findings

- **H5-D11 is now source-CONFIRMED at the fallback boundary.** Electron missing backend provenance falls to `auto`; CLI missing/non-real mode falls to mock; Android missing/non-mock mode falls to real; Windows missing/non-mock mode constructs the default replay driver. Red tests still determine exact severity and migration policy.
- **H5-D13 is partially CONFIRMED.** `FindingEngine.rehydrate` converts malformed string-array JSON to `[]` and malformed structured JSON to `null`, silently discarding durable evidence fields. Continue adversarial testing for ID/path containment and downstream semantic impact before claiming those subcases.

### Mandatory H5.10 OpenSpec execution

`openspec/changes/hardening-5-fleet-truth/tasks.md` now contains **H5.10** and is authoritative. Complete H5.10.1-H5.10.15 in addition to still-open H5.2.6, H5.4.5, H5.8.*, and H5.9.*. Do not merely copy checkmarks from older state.

The execution order is now:

1. **Restore truth first:** H5-D6 ledger history, H5.10 task/state alignment, exact current CI record.
2. **Red tests:** H5-D7/D8/D9/D10, backend provenance, H5-D15 Linux configured-mock capability, malformed-state negative cases.
3. **Correct semantic outcomes:** explicit replay dispositions, positive-evidence-only fixed/clean/rejected conclusions, admit-before-consume.
4. **Correct provenance/capabilities:** exact durable backend identity across families; configured backend drives executable capability truth; real-vs-mock evidence strength is explicit.
5. **Replace vacuous census:** content-aware exact-blob review evidence for the final tracked tree; every authored file genuinely reviewed.
6. **Certification-path proof:** Windows real campaign, Electron Xvfb campaign, Android honest deferral/proof, installed artifact, all-family negative space.
7. **Mutation/property/fault/soak:** specifically mutate each trust boundary and prove tests fail.
8. **Truth reconciliation + exact-tree local gates.**
9. **Push implementation SHA and inspect exact-SHA hosted jobs.** H5 stays ACTIVE if any required lane is red, skipped without accepted environment rationale, queued, or unexecuted.

### Twelve-hour autonomous execution contract

Treat this as a **roughly 12-hour productive engineering campaign**, not a one-bug patch. Continue after the first green test and after the first repaired defect. Use the full useful envelope for the ordered correctness, provenance, mutation, fault-injection, content-aware every-file review, soak, installed-artifact, and hosted-certification work above.

Do not pad the clock with cosmetic refactors. If the execution harness imposes a hard runtime/session limit before the useful 12-hour envelope is exhausted, persist an exact durable checkpoint (current task, defects, tests, SHA, remaining work) and make the next invocation resume H5.10 rather than claiming completion. A harness timeout is not H5 completion.

### Updated completion blockers

HARDENING_5 cannot be COMPLETE unless all earlier acceptance gates **plus** the following are true:

1. H5-D14 is closed: final every-file certification is content-aware, exact-blob-bound, non-self-attesting, and covers the actual final tracked tree.
2. H5-D15 is closed: configured backend executability and advertised capability agree; deterministic mock/injectable and real field capability are explicitly distinguished.
3. Exact current-red Windows campaign regression is fixed without weakening/removing its evidence requirement.
4. An all-refused/no-work campaign cannot masquerade as clean semantic execution.
5. H5-D11 has explicit fail-closed backend provenance semantics across Electron, Windows, CLI, and Android.
6. Malformed durable-state behavior is either closed with fail-closed coverage or precisely proven unreachable/contained.
7. Required hosted Windows campaign, Electron Xvfb campaign, Linux full integration, and installed-artifact lanes actually execute and pass on the exact pushed implementation SHA.

