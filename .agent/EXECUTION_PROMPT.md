# Inspector Execution Prompt — HARDENING_4

**Status:** ACTIVE  
**Campaign:** HARDENING_4 — Certification Integrity, Durable-State Atomicity, and Cross-Process Ownership Fencing  
**Mode:** HARDENING  
**Target branch:** `main`  
**Planned from:** `270b375e00babe7bdcd04bdb80fd5a96a1a9b9c6` (`HARDENING_3: whole-system reliability, intelligence safety, clean-CI correctness, concurrency torture — COMPLETE`)  
**Planner date:** 2026-08-25  
**Intended scale:** one substantial autonomous engineering campaign, roughly 8–12 hours when the evidence supports it. Do not inflate scope, but do not stop after repairing the first visible failure. The purpose is to make Inspector's durability and certification claims mechanically true under clean-host, restart, and multi-process conditions.

## 1. Why this is the next campaign

The implementation roadmap currently ends at M13. M13 is `COMPLETE`; M8 remains `DEFERRED_ENVIRONMENT`; no M14 exists and no new implementation milestone is activated. HARDENING_3 is also recorded `COMPLETE` in canonical state. Do **not** invent M14, infer a release, or publish/tag anything.

A new hardening campaign is nevertheless justified by current repository evidence, not speculative cleanup:

1. The exact HARDENING_3 completion SHA (`270b375e00babe7bdcd04bdb80fd5a96a1a9b9c6`) has a completed **failing** GitHub Actions run: `32840538303`.
2. The Linux quality job (`97778814888`) successfully completed install, lint, typecheck, and the entire Linux unit lane (**59 files / 643 tests passed**) and then failed before integration at:
   `pnpm exec playwright install --with-deps chromium`
   with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found`.
3. The root `package.json` does not own a Playwright binary. `@inspector/adapter-web` owns the `playwright` dependency. HARDENING_3 added a root-scoped provisioning command without proving executable resolution in the clean hosted workspace.
4. That failure skipped the Linux integration lane, Linux installed-artifact smoke, and Electron Xvfb real-runtime proof. Therefore the final H3 commit's claim that the hosted clean-runner problem was closed is not yet certified.
5. Repository truth surfaces drift again after the H3 completion:
   - `.agent/EXECUTION_PROMPT.md` still describes HARDENING_3 as `ACTIVE` even though canonical state marks it complete (this H4 planner activation replaces that stale prompt).
   - `AGENTS.md` calls M13 `REAL_TARGET_FLEET_CAMPAIGNS`; that is the M12 name, not M13's Intelligence-Guided Autonomous QA milestone.
   - `.inspector/state/campaign.yaml` textually contains two `completed_task_groups:` mapping keys under `progress`; verify actual parser behavior, but duplicate YAML keys are inherently ambiguous and can erase or hide historical task-group truth depending on loader semantics.
   - verification/hosted-CI prose still describes H3 results as unavailable/pending even though the public Actions API exposes the final failed run.
   - the hardening ledger still contains historical status text that must be reconciled without rewriting evidence.
6. Negative-space review of unchanged durability primitives exposed high-value concurrency risks that HARDENING_3 did not close:
   - `packages/scale/src/lock.ts` uses age-only stale takeover with no ownership token/fencing. A holder older than `staleMs` can be removed by another process; `release()` then unconditionally removes the lock directory, potentially deleting a successor's lock. Prove or disprove this with deterministic multi-process tests before changing the design.
   - `packages/scale/src/state-file.ts` calls `sweepLeftoverTmp()` from public `load()` without the file lock, while writers use one fixed `<state>.tmp` path. A concurrent reader may remove a writer's live temporary file. Prove the exact Windows/POSIX behavior and close any real race without weakening atomicity.
   - strict crash durability of tmp-write/fsync/rename, quarantine behavior, reader/writer interaction, and stale-lock takeover is not yet proven across the JSON fallback path.
7. HARDENING_3 materially changed CI, model runtime, model budget accounting, scheduler heartbeat behavior, tests, ADRs, and state. Its direct patch is only part of the blast radius; unchanged consumers and persistence primitives must be audited too.

This campaign is therefore **HARDENING_4**, focused on certification truth, durable-state atomicity, ownership/fencing, and transitive regression safety.

## 2. Mandatory rehydration and repository-wide audit

Before editing implementation code:

1. Read `.agent/PLANNER_HANDOFF.md` and this file.
2. Read `.inspector/state/campaign.yaml`, `.inspector/state/CHECKPOINT.md`, and `.inspector/state/HARDENING-CHECKPOINT.md` completely.
3. Read `AGENTS.md`, `docs/HARDENING-CAMPAIGN.md`, `docs/ROADMAP.md`, and `docs/STATUS.md`.
4. Read SPEC-012, SPEC-013, ADR-0012, ADR-0013, and only the additional architecture/security/persistence/product documents required by the evidence below.
5. Fetch/prune `origin`; verify current branch, worktree cleanliness, `HEAD`, `origin/main`, ahead/behind state, and preserve any legitimate newer work.
6. Inspect at least the most recent **30 meaningful commits** (more if needed), including M12, HARDENING_2, M13, HARDENING_3 activation, and HARDENING_3 completion. Understand why each changed contract exists before altering it.
7. Enumerate the **entire authored repository**, not just recently modified files: packages, scripts, CI/build/release files, specifications, durable state schemas, agent adapters, fixtures, platform adapters, tests, and docs. Exclude generated/vendor/cache output only when clearly non-authored.
8. For every HARDENING_3-changed behavior, trace direct callers, transitive consumers, persisted schemas, test fixtures, command surfaces, and unchanged dependents. Review what was *not* changed but relies on the changed semantics.
9. Query current GitHub Actions through the available public API/tooling. Do not rely on a local `gh` authentication limitation when the repository/run is publicly inspectable.
10. Confirm there are no higher-priority open issues/PRs. If newer legitimate work exists, reconcile it rather than overwriting it.
11. Activate HARDENING_4 in the repository's **canonical durable state** and create/extend a durable H4 defect ledger. Do not create another one-off state shape if the existing schema can be normalized safely. Preserve all historical milestone and hardening evidence.
12. Every confirmed defect must progress through: suspicion → deterministic evidence/reproduction → severity → regression proof → fix → cross-package verification → CLOSED. Do not call a design smell a defect until evidence establishes a violated contract.

Do not implement from chat history. Re-read the live repository.

## 3. Required whole-system maps

Build and use these maps during the audit. For each, cover happy path, failure, cancellation, crash/restart, corruption, concurrency, and environment-loss behavior where applicable.

```text
GitHub Actions -> pnpm workspace -> package-local executable resolution -> browser/Electron prerequisites -> integration -> installed artifact
```

```text
planner prompt -> AGENTS/goal adapter -> campaign.yaml -> checkpoint/ledger/status -> executor activation -> final truth/reporting
```

```text
campaign -> scheduler -> StateFile/FileLock or SQLite state -> lease/fencing -> worker -> workflow executor -> settlement -> resume
```

```text
StateFile load/update/save -> temporary file -> fsync/rename -> quarantine/recovery -> concurrent reader/writer -> process death
```

```text
model config -> ModelRuntime -> estimate -> budget admission -> sink start -> provider -> validation -> sink finish -> settlement -> observability
```

```text
CLI -> workflows -> exploration -> finding/oracle -> evidence/store -> operator output -> installed package
```

```text
finding -> source intelligence -> repair context -> PatchAgent -> isolated worktree -> verification -> resolution
```

Cross-check all maps against protocol/security/ADR contracts and actual tests rather than comments alone.

## 4. Ordered workstreams

### H4.0 — Establish exact current truth and durable ledger

- Record `270b375e...` as the planning baseline unless newer legitimate work has landed.
- Fetch Actions run `32840538303` and its jobs/logs; record the exact clean-runner failure and all jobs that were skipped because of it.
- Re-run or reproduce the command-resolution failure in an equivalent clean workspace when practical.
- Classify local-vs-hosted differences honestly. The Linux unit lane is proven green at 643/643 on the H3 SHA; do not conflate that with integration certification.
- Create stable H4 defect IDs and severities.
- Record existing known debt separately from newly confirmed defects.

### H4.1 — Clean-runner dependency and CI executable-resolution correctness

Audit `.github/workflows/ci.yml`, root/workspace package manifests, lockfile, Vitest configs, adapter-web package, Electron package, scripts, release smoke, and all commands that assume package-local CLIs are visible from the root.

Required outcomes:

- Playwright browser provisioning resolves from the package that actually owns the locked Playwright version, or the workspace dependency structure is intentionally changed so the root owns it. Do not depend on accidental node_modules layout/hoisting.
- Browser version and downloaded runtime are exactly compatible with the test package using them.
- The Linux unit lane remains hermetic and browser-free.
- The Linux integration lane runs rather than being skipped.
- Linux installed-artifact smoke and Electron Xvfb proof run when quality succeeds.
- Windows native/path gate remains green.
- Audit every other `pnpm exec`, package-local executable, and optional runtime installation in CI/scripts for the same class of dependency-locality bug.
- Add a regression guard that catches workspace-executable resolution mistakes before another completion commit claims clean-CI success.
- Do not solve this by blanket skipping tests or weakening assertions.

### H4.2 — Canonical campaign/state schema and truth-surface integrity

Deep-audit `.inspector/state/*`, `.agent/*`, goal adapters, `AGENTS.md`, STATUS, ROADMAP, specs/tasks, and any parser/validator consuming campaign state.

Investigate and fix confirmed issues including:

- duplicate `completed_task_groups:` mapping keys in `campaign.yaml`;
- ambiguity between generic `hardening:` and ad hoc `hardening3:` shapes;
- stale verification/hosted-CI records;
- stale or impossible prompt/campaign combinations;
- M13's incorrect name in `AGENTS.md`;
- historical ledger sections that still read ACTIVE after completion;
- any state validator/parser that accepts duplicate keys or silently loses history;
- any next-session logic that can resume a completed prompt because prose and canonical state disagree.

Prefer one versioned, validated representation for repeated hardening campaigns. If changing the durable schema is material, add an ADR or explicit schema migration and preserve backward compatibility/history intentionally.

Add machine-checkable truth validation where justified. At minimum, a fresh checkout should be able to detect duplicate keys, impossible campaign status combinations, or state that contradicts the active handoff instead of silently choosing one source.

Do **not** rewrite historical evidence to make it look cleaner. Correct current status and append reconciliations.

### H4.3 — FileLock ownership, stale takeover, and release fencing

Treat `packages/scale/src/lock.ts` as a concurrency primitive, not a helper.

Construct deterministic multi-process or independently-instantiated tests for:

1. process A acquires a lock and remains alive beyond `staleMs`;
2. process B observes the old mtime and attempts takeover;
3. B acquires/replaces a lock while A still has code executing;
4. A subsequently releases;
5. C attempts acquisition while B believes it owns the lock;
6. process death between mkdir and owner metadata write;
7. owner death while another process is inspecting staleness;
8. concurrent stale takeovers;
9. clock jumps/backwards/forwards where relevant;
10. lock directory/owner metadata corruption or permission failure.

Required invariants:

- a previous owner can never delete a successor's lock;
- stale takeover cannot create two simultaneous critical-section owners;
- liveness recovery from a dead owner remains bounded;
- ownership is explicit (token/generation/identity or another rigorously proven mechanism), not inferred solely from directory age;
- release is ownership-checked;
- tests are deterministic enough to catch the race repeatedly without simply increasing timeouts;
- cross-platform semantics for Windows and POSIX are documented and tested where CI permits.

If the cleanest safe resolution is to stop using this JSON lock in a production-sensitive path and rely on SQLite/advisory transactional semantics, prove migration/fallback behavior and preserve intended test/development portability. Do not perform a gratuitous rewrite.

### H4.4 — StateFile atomicity, reader/writer races, and crash durability

Deep-audit `packages/scale/src/state-file.ts` and every consumer of the JSON state fallback.

Specifically prove or disprove:

- unlocked `load()` removing a writer's live shared `.tmp` path;
- concurrent read during tmp write and rename;
- multiple StateFile instances sharing one path;
- `save()` being called directly without lock ownership;
- failure between open/write/fsync/close/rename;
- process death after rename but before directory durability on POSIX;
- leftover temporary-file recovery after a genuine crash versus removal of a live writer's temp;
- quarantine rename racing another reader/writer/quarantine;
- malformed/semantically corrupt JSON under concurrent access;
- Windows rename/share semantics versus POSIX unlink semantics;
- unique temp naming and cleanup behavior if adopted.

Required invariants:

- readers cannot invalidate in-flight writes;
- two writers cannot both believe they committed the same generation;
- a completed mutation is either durably visible or recovery reports an honest typed failure; never silently reset;
- crash debris cannot be mistaken for current truth;
- quarantine preserves evidence without racing active valid state;
- direct/public API surfaces cannot bypass required serialization accidentally;
- tests explicitly exercise process/race boundaries rather than only single-process mocks.

If directory fsync is required for the repository's stated durability contract on POSIX, implement and test it where supported; otherwise narrow/document the contract truthfully.

### H4.5 — Scheduler/lease/settlement transitive regression campaign

Any FileLock/StateFile changes can alter the H2/H3 fleet invariants. Re-audit unchanged callers and repeat deterministic torture around:

- two controllers over one state directory;
- heartbeat renewal under lock contention;
- generation/fencing loss;
- stale completion;
- external holds;
- pending settlement journal replay;
- stop/SIGINT/max-wall transitions;
- crash at claim, heartbeat, completion, and settlement boundaries;
- JSON fallback and SQLite production-default parity where contracts are shared.

Required invariants remain: zero duplicate execution, zero stale completion, no false success, truthful blocked/refused states, bounded recovery, and no process-level timer exception.

Do not undo HARDENING_3's generation-fencing semantics to make tests pass.

### H4.6 — HARDENING_3 model-runtime changed-code dependent audit

Re-review the H3 changes in `packages/model-runtime`, `packages/scale` model budgets, SQLite model-call persistence, CLI/workflows, exploration/oracle/repair consumers, and unchanged observability code.

Do not assume H3's targeted tests exhausted the blast radius. Check at minimum:

- logical-request stats versus per-attempt stats (`requests`, `attempts`, `completed`, `failed`, `fallbacksUsed`, `denials`, `storeErrors`);
- whether `fallbacksUsed` means a fallback actually occurred rather than merely that an attempt failed;
- failure counters under retry, final exhaustion, cancellation, deadline, malformed response, budget denial, gate failure, and sink failure;
- partial explicit estimates (one field present, another absent) versus provider/default conservative estimates;
- provider health exceptions and deterministic candidate ordering;
- late provider completion after runtime timeout/cancellation and conservative accounting;
- sink `start`/`finish` failures and persisted truth;
- concurrent budget admissions/settlements across global/worker/item scopes;
- restart reconciliation and observability parity.

Fix only confirmed contract violations and add regression tests. If aggregate-stat semantics are ambiguous, resolve them in types/docs/ADR and consumers together rather than guessing.

### H4.7 — Whole-repository negative-space sweep

After the concrete H4 defects are understood, perform a repository-wide adjacent-defect sweep. This is mandatory and must not be limited to files touched by H3/H4.

Audit every authored package and major system surface for the **same classes** of failure:

- ownership released by a stale actor;
- temp/shared-file names without ownership;
- state writes outside their serialization boundary;
- clean-runner dependencies resolved only by local-machine layout;
- completion/status claims not backed by exact-tree evidence;
- duplicate schema keys/fields or last-writer-wins history loss;
- timer/background callbacks that can throw outside normal error containment;
- cancellation/deadline promises whose late completion mutates state;
- package-local executables assumed globally available;
- platform-specific filesystem semantics hidden by single-OS tests;
- installed-artifact behavior diverging from source-workspace behavior.

Trace effects through adapter-web, adapter-sdk, Android, CLI/PTTY, Electron, Windows/UIA, core, explore, finding, oracle, repair, artifact store, SQLite store, protocol, workflows, scale, scripts, and release/build configuration.

This is not permission for cosmetic refactors. Prefer evidence-backed fixes with explicit blast-radius tests.

### H4.8 — Performance/resource and cleanup verification

Measure the touched durability/concurrency paths under contention and repeated campaigns. Check for:

- event-loop stalls from synchronous lock waiting;
- unbounded polling/spin;
- leaked timers/handles/processes/browser instances;
- temp/lock/quarantine artifact accumulation;
- pathological filesystem latency amplification;
- repeated Playwright/browser downloads or CI cache misuse;
- regression in the already-known expensive web replay path.

Optimize only where measurements show a meaningful problem or the design blocks correctness. Do not trade correctness for benchmark wins.

### H4.9 — Exact-tree local certification

Before the completion commit, run the strongest applicable local gates on the exact tree:

- `pnpm install --frozen-lockfile`;
- lint;
- typecheck;
- complete unit suite;
- complete integration suite;
- installed-artifact/release smoke;
- targeted FileLock/StateFile multi-process/race/crash tests;
- H2/H3 fleet concurrency tests repeatedly;
- model-runtime/model-budget targeted tests and property/state-machine tests;
- platform-real proofs available on the host, with unavailable hardware/runtime classified honestly rather than faked.

No Critical/High regression may remain open. Medium/Low debt may remain only with explicit evidence, impact, and rationale.

### H4.10 — Hosted CI certification and truthful completion

After code/state/docs are ready:

1. Commit and push to `main` without force-pushing.
2. Query the Actions run for the **exact pushed SHA** through the public GitHub API/tooling.
3. Verify the Linux quality job proceeds through browser provisioning and full integration.
4. Verify Linux installed-artifact smoke runs and passes.
5. Verify Electron Xvfb real-runtime job runs and passes or produces a newly evidenced environment-class blocker.
6. Verify the Windows path/native gate remains green.
7. If a required lane is red, retrieve the logs, classify the failure, repair it, rerun local gates, push the fix, and certify the new exact SHA. Do not label the campaign COMPLETE while required hosted CI is red.
8. Avoid the circular-truth trap: repository state written *before* the final push may say hosted verification is pending for that exact commit. After the final push becomes green, do not create a documentation-only commit merely to write “green,” because that would create a new uncertified SHA. Record the green final run in the executor's completion report and make future sessions query Actions for the current SHA. A later substantive commit must earn its own certification.

Hosted CI is part of the completion gate now. “gh is unauthenticated” is not an acceptable reason to skip public Actions inspection.

## 5. Constraints and non-goals

- Stay on `main` unless the live repository policy has legitimately changed; preserve newer work.
- No force-push.
- No release, tag, package publication, deployment, or external destructive action.
- Do not invent M14.
- Do not resume M8 without an actual macOS/Xcode/simulator environment and an explicit activation decision.
- Do not weaken tests, add blanket skips, or raise timeouts as the primary race fix.
- Do not replace SQLite production state with JSON state merely to simplify tests.
- Do not erase historical hardening/milestone evidence.
- Do not treat local green tests as proof of clean-host CI.
- Do not treat comments/docs as authoritative when live source/state/CI contradict them.
- Do not broaden into unrelated feature development.

## 6. Acceptance and completion gates

HARDENING_4 is complete only when all of the following are true:

1. Exact-current-state baseline and H4 ledger are durable.
2. The clean-runner Playwright executable-resolution defect is closed with regression coverage and the final hosted Linux integration actually runs.
3. Campaign/state YAML is unambiguous and parser-validated; no duplicate-key history-loss path remains.
4. Active/completed prompt, AGENTS, STATUS, checkpoint, roadmap, and canonical state agree on current campaign/milestone truth without rewriting history.
5. FileLock stale takeover/release ownership is proven safe or redesigned so stale owners cannot delete successors; deterministic race coverage exists.
6. StateFile temp/recovery/quarantine and reader/writer atomicity are proven safe across applicable platform semantics; confirmed races are fixed.
7. H2/H3 fleet ownership, liveness, settlement, cancellation, and restart invariants remain green after durability changes.
8. H3 model-runtime/budget changes have a transitive dependent audit; any confirmed counter/accounting/fallback defects are fixed and documented.
9. Whole-repository adjacent-defect sweep is completed and evidence recorded.
10. Full local gates and installed-artifact smoke pass on the completion tree.
11. Required GitHub Actions jobs for the exact final pushed SHA complete green. Any true environment deferral is explicit, independently evidenced, and allowed by existing contracts.
12. No unresolved Critical/High defect remains.
13. H4 durable state is marked COMPLETE only after its actual gates are satisfied; M13 remains historical COMPLETE; M8 remains DEFERRED_ENVIRONMENT; no new implementation milestone/release is inferred.
14. Final commit message is a detailed session report: baseline, defects, root causes, fixes, regression proofs, gate counts, environment classifications, remaining debt, exact final SHA/run, and next native continuation state.
15. Push all authorized repository changes to `origin/main` and verify the remote branch points at the expected final SHA.

## 7. Executor continuation behavior

Proceed autonomously from this ACTIVE prompt. Do not ask for routine approval between workstreams. Update durable state at meaningful waypoints and keep the defect ledger current. If a task exposes a Critical/High regression anywhere in its transitive blast radius, fix it before moving on.

If a genuinely blocking condition requires unavailable credentials, destructive external authority, a product decision not resolved by existing contracts, or hardware/OS that cannot reasonably be emulated, record the exact blocker and continue all independent work. Mark the campaign BLOCKED only when no safe unblocked work remains.

At successful completion: reconcile state/docs, commit, push, verify `origin/main`, inspect hosted CI for the final SHA, and report the evidence. Do not publish a release or tag.