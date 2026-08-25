# Inspector Execution Prompt — HARDENING_3

**Status:** ACTIVE  
**Campaign:** HARDENING_3 — Whole-System Reliability, Intelligence Safety, Clean-CI Correctness, and Concurrency Torture  
**Mode:** HARDENING  
**Target branch:** `main`  
**Planned from:** `9d65d3345d4b8d3bee16b59d1e1171a16eab79f7` (`M13.F27: documentation + durable state synchronization; M13 COMPLETE`)  
**Planner date:** 2026-08-25  
**Intended scale:** one substantial autonomous engineering campaign, roughly 8–12 hours of meaningful work when the justified defect surface supports it. Do not inflate scope artificially, but do not stop after repairing the first visible failure.

## 1. Why this is the next campaign

The repository's machine-readable state marks **M13 — Intelligence-guided autonomous QA** `COMPLETE`. No further roadmap implementation milestone is activated. M8 remains `DEFERRED_ENVIRONMENT` unless a real macOS/Xcode/simulator environment becomes available. The roadmap explicitly keeps deep hardening separate from implementation.

Therefore do **not** invent M14. The next justified campaign is hardening.

This hardening campaign is not speculative: hosted CI for the exact M13-complete SHA is red, the final M13 change set is broad and cross-cutting, and live source inspection exposes several high-value trust-boundary and failure-containment areas that were not disproved by the local completion gate.

At planning time:

- `main` and the repository default branch point to `9d65d3345d4b8d3bee16b59d1e1171a16eab79f7`.
- There are no open GitHub issues competing for priority.
- There are no open pull requests competing for priority.
- M13 consists of nine commits after HARDENING_2 and touches CLI, exploration, model runtime, oracle, repair, scale/budgets, SQLite, workflows, tests, release smoke, docs, and durable state.
- The push-triggered CI run for the exact M13 SHA, Actions run `32817613858`, concluded **failure**.
- The Windows path/native gate passed.
- The Linux quality gate failed at `pnpm test`.
- Linux integration, Electron Xvfb proof, and Linux installed-artifact smoke were then skipped because the quality gate was red.

Treat the repository, durable state, actual source, actual test behavior, and hosted CI as authoritative. Do not trust a prior `PASS`, `COMPLETE`, or “flake” label when current evidence contradicts it.

## 2. Mandatory rehydration and activation

Before editing code:

1. Read `.agent/PLANNER_HANDOFF.md` and this file.
2. Read `.inspector/state/campaign.yaml`.
3. Read `.inspector/state/CHECKPOINT.md`.
4. Read `AGENTS.md`.
5. Read `docs/HARDENING-CAMPAIGN.md`.
6. Read `docs/ROADMAP.md` and `docs/STATUS.md`.
7. Read `specs/013-intelligence-guided-autonomy/SPEC.md` and `TASKS.md` as the immediately preceding implementation contract.
8. Read ADR-0012 and ADR-0013 plus the architecture, security, autonomy, model-routing, exploration, oracle, repair, persistence, observability, development, and product documents relevant to the work below.
9. Fetch/prune `origin`; inspect branch, local HEAD, `origin/main`, ahead/behind state, worktree cleanliness, recent commits/diffs, open issues/PRs, and current hosted CI.
10. Reconcile this prompt against actual repository state before acting. If newer legitimate work has landed, preserve it and adjust the campaign without discarding intent.
11. Activate a new hardening record in the repository's native durable state according to `docs/HARDENING-CAMPAIGN.md`. Preserve completed implementation history and the M8 environment deferral. Do not erase or rewrite M13 history.
12. Create/extend a durable HARDENING_3 defect ledger. Every confirmed defect should record severity, reproduction/evidence, root cause, blast radius, fix, and regression proof.

Do not implement from chat history. Re-read the repository.

## 3. Current concrete evidence that must be reproduced and explained

### 3.1 Hosted Linux CI is not hermetic

The exact M13 SHA's Linux `pnpm test` run ended with **3 failed files, 8 failed tests, 1 unhandled error, 628 passed tests**.

Known failures:

- `packages/adapter-web/src/web.target-url.test.ts`: six tests fail because Playwright Chromium is not installed on a clean Ubuntu runner.
- `packages/electron-adapter/src/electron.hardening.test.ts`: one attribution-threading test reaches the web adapter and fails for the same missing Chromium executable.
- The CI job performs `pnpm install --frozen-lockfile` and then `pnpm test` without provisioning the browser required by those tests.

Do not solve this by blanket skipping browser-backed coverage. Determine whether each test is genuinely a unit test, a browser-backed integration test, or a clean-runner dependency that the unit lane is expected to provision. Make the classification and CI dependency explicit and reproducible.

### 3.2 Two-controller fleet liveness is still unstable

`packages/scale/src/h2-fleet-hardening.test.ts` failed the two-controller shared-state scenario:

- expected controller B to report `blocked-external-holds`;
- received `stopReason = null`;
- the same run emitted an unhandled `LockAcquireError` from the heartbeat/renewal path while acquiring `leases.json.lock` for 5000 ms;
- the stack reaches `FileLock.acquire -> StateFile.update -> JsonLeaseStore.update -> LeaseManager.renew -> Timeout._onTimeout` in `campaign.ts`.

A test that sometimes passes locally and fails on hosted CI is not sufficient evidence that the underlying liveness contract is correct. Do not merely increase timeouts. Establish the race, ownership, heartbeat, lock-contention, fencing, and shutdown semantics deterministically.

### 3.3 Project truth is internally inconsistent

`.inspector/state/campaign.yaml` marks M13 `COMPLETE` and says no further roadmap milestone is activated, while `docs/STATUS.md` still says `M13 IN PROGRESS` / `ACTIVE` and its milestone table still marks M13 active.

The final M13 commit was explicitly a documentation/state synchronization commit, so this mismatch is itself evidence that the synchronization gate is incomplete. Audit other status surfaces for similar drift.

### 3.4 ModelRuntime failure containment needs adversarial proof

`ModelRuntime.invoke()` documents a **Never throws** contract so optional intelligence degrades instead of crashing deterministic workflows. Current source directly invokes several external or stateful boundaries during the call lifecycle, including budget admission and model-call sink persistence.

Examples to investigate, not assumptions to patch blindly:

- `opts.gate.admit(...)` executes before provider invocation and is not obviously contained by the outer API contract.
- `opts.sink?.start(...)` is invoked directly.
- `recordTo()` invokes `sink.finish(...)` directly.
- `settleGate()` catches and suppresses settlement exceptions, relying on later conservative reconciliation.

Prove what happens when each boundary throws or partially succeeds. The runtime must not claim “Never throws” if a persistence or accounting collaborator can escape the boundary, but simply swallowing an error may also violate accounting or audit truth. Establish the intended contract and make failure handling durable and observable.

### 3.5 Model-budget inputs cross an untrusted numeric boundary

`ReservationModelBudgetGate` is a safety/accounting boundary. Provider/request estimates and provider-reported actual usage must be treated as untrusted input.

Audit at minimum:

- `NaN`;
- positive/negative `Infinity`;
- negative values;
- fractional token counts;
- unsafe integers;
- extremely large values;
- omitted/partial usage;
- contradictory total vs input/output token fields;
- negative or non-finite costs;
- malformed estimates;
- actual usage larger than reservations;
- repeated admit/settle;
- unknown settle;
- stale reservation conversion;
- corrupted persisted state.

Current source deserves specific scrutiny because reservation validation checks finite safe integer request/token fields but the reservation `costUsd` validation does not use the same finite check, `admit()` performs arithmetic on supplied estimates, and `actualUsage()` derives charge values without visibly normalizing non-finite/negative/unsafe provider usage first.

No malformed numeric value may fail open, reduce prior consumption, create budget headroom, corrupt JSON state, or allow a later caller to oversubscribe a ceiling.

### 3.6 Model-derived session memory is a taint boundary

`SessionSummarizer` serializes anomalies, rejected suggestions, failed hypotheses, and recent actions into a model prompt, then stores model-generated digest text for later planning context and checkpoint continuity.

The digest is documented as advisory, but model-generated text can still become a laundering path for hostile target-controlled content if later components treat it differently from raw target data.

Trace the full data flow from target/model-derived strings into:

- prompts;
- session digests;
- planner packets;
- oracle packets;
- repair packets;
- logs;
- SQLite;
- checkpoints;
- evidence;
- CLI output;
- model-call metadata.

Prove that hostile text cannot cross an authority boundary by being summarized, persisted, restored, or re-injected.

## 4. Whole-repository blast-radius requirement

Do **not** review only the M13 files or only the tests currently failing.

The planner compared the HARDENING_2 baseline (`385d3c62...`) with M13 final (`9d65d334...`). M13 is nine commits wide and materially changes or adds behavior across:

- `.inspector/state/*`;
- README and multiple architecture/security/product docs;
- `packages/cli`;
- `packages/explore`;
- new `packages/model-runtime`;
- `packages/oracle`;
- `packages/repair`;
- `packages/scale`;
- `packages/store-sqlite`;
- `packages/workflows`;
- release smoke;
- SPEC-013/TASKS;
- TypeScript/Vitest configuration.

Trace recent changes forward and backward through the rest of the repository. Inspect callers and consumers that were not modified by M13. Look for assumptions whose meaning changed even if the file itself did not.

At minimum build and use these end-to-end maps:

```text
CLI -> workflows -> exploration -> finding/oracle -> evidence/store -> operator output
```

```text
campaign -> scheduler -> worker routing -> workflow executor -> adapter -> run/finding/evidence -> settlement/accounting
```

```text
model config -> provider loading -> ModelRuntime -> budget reservation -> provider invocation -> validation -> model_calls persistence -> accounting
```

```text
observation -> bounded context -> model planner/oracle -> deterministic authority gate -> action/finding
```

```text
finding -> source intelligence -> repair context -> PatchAgent -> isolated worktree -> verification -> resolution
```

```text
process death -> persisted state/checkpoint -> reconciliation -> resume -> continued execution
```

For each map, test not only the happy path but failure, cancellation, corruption, restart, concurrency, and environment-loss paths.

## 5. Ordered workstreams

### H3.0 — Establish hardening truth and durable ledger

- Reproduce the current hosted failures locally or in equivalent clean environments where possible.
- Record a truth table of local vs hosted vs environment-dependent claims.
- Classify every discovered issue as target/product defect, test/CI defect, environment dependency, documented deferral, or non-defect.
- Create stable defect IDs and severities.
- Do not mark a defect closed without a regression proof.

### H3.1 — CI hermeticity and test taxonomy

Audit `.github/workflows/ci.yml`, Vitest configs, package scripts, browser/electron dependencies, and installed-artifact lanes.

Required outcomes:

- clean Linux unit/quality gates do not accidentally depend on developer-machine browser caches;
- tests that genuinely require Playwright/Electron are either provisioned in their lane or intentionally classified into the correct integration/runtime lane;
- no blanket skip hides real coverage;
- Playwright/browser versions remain lockfile-consistent and reproducible;
- downstream Electron and installed-artifact jobs are allowed to run when prerequisites are satisfied;
- Windows behavior remains green;
- CI failure output clearly identifies environment absence vs product regression.

### H3.2 — Fleet lock/lease/concurrency root-cause campaign

Deep-audit:

- `FileLock`;
- `StateFile`;
- lease stores;
- `LeaseManager`;
- heartbeat timer lifecycle;
- fencing generations;
- settlement journals;
- campaign scheduler/controller shutdown;
- cancellation and stop reporting;
- external-hold reporting;
- concurrent controllers sharing a state directory.

Construct deterministic race windows around:

1. controller A acquiring an item;
2. work starting;
3. heartbeat scheduling;
4. controller B starting against the same state directory;
5. state-file lock contention;
6. heartbeat renewal colliding with another state mutation;
7. generation loss or lease expiry;
8. completion racing ownership change;
9. settlement racing another controller;
10. process death/shutdown at each boundary.

Required invariants:

- no duplicate execution;
- no stale completion;
- no false success;
- externally held work reports truthful blocked state;
- lock contention cannot masquerade as no live owner;
- timer callbacks cannot produce unhandled process-level exceptions;
- stale fencing ownership aborts execution safely;
- restart recovery is deterministic;
- cleanup does not leave heartbeats or locks alive after the owning execution is done.

Do not fix races by making the test slower or simply increasing lock timeouts.

### H3.3 — ModelRuntime failure-containment and audit-truth hardening

Exercise the complete provider-neutral runtime under:

- provider `healthy()` throw;
- estimator throw;
- admission throw;
- admission denial;
- sink `start` failure;
- provider synchronous throw;
- provider asynchronous rejection;
- provider ignoring `AbortSignal`;
- deadline before/after provider work begins;
- external cancellation at each boundary;
- malformed response;
- schema-invalid response;
- oversized response;
- sink `finish` failure;
- settlement failure;
- all-provider exhaustion;
- fallback success after prior failure;
- late provider resolution after timeout/cancel.

Reconcile these properties simultaneously:

- deterministic workflows do not crash because optional intelligence failed;
- accounting cannot silently refund possibly consumed calls;
- persisted model-call state is truthful about started/completed/failed/unknown attempts;
- failures are observable rather than invisibly swallowed;
- fallback does not double-spend outside configured bounds;
- cancellation/deadline semantics are stable;
- the public API contract and implementation agree.

If a contract needs to change, update ADR-0013 and all callers/tests together rather than hiding inconsistency.

### H3.4 — Model budget/accounting adversarial hardening

Treat all estimates and actual usage as hostile external data.

Add targeted and property/state-machine tests covering malformed numerics, concurrency, overage, repeated settle/admit, crash windows, stale holds, wall-clock anomalies, corrupted JSON, and simultaneous scopes.

Prove:

- global/worker/item ceilings cannot be collectively oversubscribed;
- NaN/Infinity/negative/unsafe values fail closed;
- unknown usage is conservatively charged;
- actual overage becomes durable truth without corrupting future projection;
- repeated or unknown settlement is idempotent and cannot erase consumption;
- restart reconciliation never creates fresh budget;
- serialization/deserialization preserves valid monetary precision without accepting impossible values;
- observability reports the same truth the gate enforces.

### H3.5 — Prompt injection, taint, privacy, and authority boundaries

Audit every target-controlled and model-generated string through planner, summarizer, semantic oracle, source intelligence, repair context, logging, persistence, checkpoints, artifacts, and CLI output.

Attack with:

- explicit prompt instructions;
- credential/API-key-shaped values;
- shell commands;
- malicious HTML;
- terminal escapes;
- malformed/recursive JSON-like text;
- Unicode confusables;
- huge strings;
- fabricated evidence references;
- text requesting policy/budget bypass;
- text requesting arbitrary source edits;
- model-generated summaries that repeat or transform hostile instructions.

Required authority proofs:

A malicious model response must not be able to:

- invent executable actions outside adapter inventory;
- raise permitted risk;
- bypass capability or policy enforcement;
- take over host mouse/keyboard;
- confirm a defect on opinion alone;
- fabricate accepted evidence;
- authorize repair;
- change policy;
- bypass model/resource budgets;
- escape a repair worktree;
- modify arbitrary files through path/symlink/junction tricks;
- alter tests to manufacture verification;
- publish/tag/release;
- convert a weak semantic suspicion into a confirmed finding without deterministic evidence/reproduction policy.

The rule remains: **models propose; Inspector validates and decides through deterministic policy/evidence gates.**

### H3.6 — Crash/restart and persistence torture

Introduce controlled interruption around:

- exploration step commit;
- planner invocation;
- session digest refresh;
- semantic suspicion;
- model-call `started` persistence;
- budget reservation;
- provider completion;
- model-call final persistence;
- budget settlement;
- evidence write;
- finding confirmation;
- repair proposal;
- source mutation inside isolated worktree;
- verification;
- campaign item execution;
- lease heartbeat;
- campaign settlement.

For each boundary define what is committed, not committed, unknown, safely retryable, and never retryable.

Audit SQLite migrations, JSON state files, campaign state, lease files, settlement journals, checkpoints, findings, artifacts, repair attempts, model calls, model budget state, and schema/version handling.

Fail closed where continuation could violate ownership, accounting, security, or evidence truth.

### H3.7 — Cross-package and adapter regression sweep

Re-prove the whole system, not only M13 helpers:

- Web / Playwright;
- CLI / PTY;
- Android / ADB;
- Windows / UIA;
- Electron;
- fake adapter;
- shared adapter protocol/SDK;
- finding/oracle/replay;
- repair worktree/verification;
- workflow facade;
- fleet campaign execution;
- installed CLI.

Check M13 impact on lifecycle, attribution, cancellation, reset, replay, evidence provenance, subprocess cleanup, timestamps, action identity, capability routing, target-failure vs automation-failure classification, and retained workspace references.

Use real available runtimes where practical. Never substitute a mock for a claimed real-runtime proof. Keep M8 `DEFERRED_ENVIRONMENT` unless a real macOS/Xcode environment is actually available.

### H3.8 — Property/fuzz/flake/performance/resource hardening

Expand high-value generated testing around:

- model parsing and provider routing;
- context packet bounds/redaction;
- session digest taint;
- budget reservation/settlement;
- lease/fencing state machine;
- campaign lifecycle;
- checkpoint recovery;
- finding lifecycle;
- migration/state validation;
- repair containment;
- replay determinism.

Use mutation testing selectively where it can prove safety-critical assertions are meaningful.

Run repeated/parallel flake hunts for concurrency-sensitive suites. A flaky safety test remains a defect until the cause is understood.

Measure the existing open debt that web exploration replay costs roughly 4–6 minutes in the full gate. Profile before optimizing. Also inspect browser/process lifecycle, SQLite handles, timers, temp directories, worktrees, artifacts, checkpoints, model-call rows, reservation records, and child processes for leaks or unbounded growth.

Preserve clean-state and replay determinism while optimizing.

### H3.9 — Architecture/dead-code cleanup and truth reconciliation

Only after correctness work is established, remove meaningful structural debt exposed by the audit:

- obsolete compatibility paths;
- duplicated validation/routing logic;
- dead M12/M13 glue;
- stale feature flags;
- misleading comments;
- unused APIs;
- duplicated state concepts.

Do not perform broad aesthetic refactors without evidence-backed value.

Synchronize all relevant truth surfaces, including at minimum:

- `.inspector/state/campaign.yaml`;
- `.inspector/state/CHECKPOINT.md`;
- HARDENING_3 ledger/checkpoint;
- `README.md`;
- `docs/STATUS.md`;
- `docs/ROADMAP.md` if status annotations require correction;
- `docs/HARDENING-CAMPAIGN.md` only if the protocol itself changes;
- ADR-0012/0013 or a new ADR when contracts materially change;
- SPEC/TASKS only when required to keep historical contract/evidence truthful.

Do not rewrite historical completion evidence merely to make the current state look clean.

### H3.10 — Exact-tree final certification and hosted CI

On the exact final tree, run the strongest practical gate:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm release:smoke
```

Additionally run the new hardening-specific concurrency, property/state-machine, crash/restart, taint/authority, and clean-browser/runtime gates created by this campaign.

Exercise available real adapters and installed-artifact behavior as required by repository contracts.

Then:

1. review the complete final diff;
2. confirm no generated runtime artifacts/secrets/temp files are staged;
3. fetch/prune `origin`;
4. reconcile safely with latest `origin/main` without overwriting another agent's work;
5. never force-push;
6. commit all intended HARDENING_3 code/tests/docs/state to `main`;
7. use a **detailed full-session commit message** summarizing the engineering work, defects, fixes, validation, and remaining debt;
8. push the completed campaign to `origin/main` when authorized by the active environment;
9. verify local `HEAD == origin/main`;
10. inspect hosted CI for that exact pushed SHA;
11. if actionable CI failures appear, continue the same campaign, fix them, revalidate, recommit, repush, and inspect again.

Do not declare COMPLETE solely because a developer-machine gate is green.

## 6. Constraints and non-goals

- Do not invent M14.
- Do not publish a release or create/push a tag without explicit release authority.
- Do not force-push.
- Do not weaken safety boundaries to make tests pass.
- Do not delete or blanket-skip failing tests merely to obtain green CI.
- Do not treat provider modules as sandboxed if the documented contract declares explicitly configured local provider modules trusted operator code; harden the declared boundary instead of silently changing the product model.
- Do not convert M8's environment deferral into a fake/mock completion.
- Do not assume any specific agent harness, model vendor, model family, terminal UI, or orchestration product.
- Do not require routine human approval for ordinary engineering choices inside existing contracts.
- If a genuine blocker requires unavailable credentials, destructive external authority, release authority, a material unresolved product decision, or unavailable mandatory hardware, record the blocker durably and continue independent unblocked work.
- Never hide a red gate behind a “known flake” label without reproducing and explaining the underlying cause.

## 7. Completion criteria

HARDENING_3 is COMPLETE only when all of the following are true:

1. Every confirmed Critical/High defect discovered in the campaign is fixed or there is a repository-authorized, evidence-backed blocker that makes completion impossible.
2. The current hosted CI failure is resolved correctly rather than hidden.
3. Clean Linux CI has explicit, reproducible browser/runtime prerequisites and passes the required quality/integration/artifact lanes.
4. Required Windows CI remains green.
5. The two-controller fleet scenario is deterministic under stress; no duplicate execution, false success, stale completion, or uncaught heartbeat/lock exception remains.
6. ModelRuntime's actual failure behavior matches its documented public contract.
7. Model budget/accounting cannot be bypassed or corrupted by malformed provider estimates/usage, concurrency, restart, or stale reservation state.
8. Model/target-controlled text cannot cross deterministic policy/evidence/repair authority boundaries through prompts, summaries, checkpoints, persistence, or logs.
9. Crash/restart invariants are proven across model calls, budgets, exploration, findings, campaigns, and repair.
10. Available real adapter families and installed-artifact workflows are re-proven where the hardening changes can affect them.
11. Resource/performance debt is measured; meaningful regressions/leaks found by the campaign are fixed; remaining non-blocking debt is explicit.
12. Documentation and durable machine-readable state agree on M13 completion, HARDENING_3 status/outcome, current blockers, environment deferrals, and remaining debt.
13. The exact final pushed SHA passes the required hosted gates. Do not mark COMPLETE while the exact final SHA is red or uninspected when CI inspection is available.
14. The repository working tree is clean after the final commit.
15. All intended changes are on `main`, pushed to `origin/main`, with local and remote `main` identical when push authority is available.

## 8. Execution behavior

This is an implementation handoff, not a request for another planning document.

Proceed autonomously through:

**audit -> reproduce -> defect ledger -> implementation -> targeted tests -> blast-radius re-audit -> full validation -> docs/state reconciliation -> detailed commit -> push -> exact-SHA hosted-CI inspection**.

Do not stop after writing an audit report. Fix confirmed defects in the same campaign.

Do not output another copy-paste implementation prompt in place of doing the work. This file is the active campaign source for continuation. When invoked through the repository's continuation mechanism, resume the first genuinely incomplete requirement above, preserve already-landed work, and keep going until the completion criteria are satisfied or a genuine blocker leaves no safe unblocked work.
