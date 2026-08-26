# Inspector hardening campaign ledger
# Campaign #2 and #3 records below are historical (COMPLETE per campaign.yaml;
# their original "ACTIVE" headers were reconciled 2026-08-25 without touching
# their evidence content).

# HARDENING CAMPAIGN #4 — Certification Integrity, Durable-State Atomicity,
# and Cross-Process Ownership Fencing

- Campaign: HARDENING_4
- Status: **COMPLETE (2026-08-26; hosted certification on exact pushed SHA
  f687ef1, run 32936068493 SUCCESS — all four required lanes green)**
- Opened: 2026-08-25
- Base commit: `e030696` (planner activation; planned-from `270b375` =
  HARDENING_3 final). Local main == origin/main after fast-forward pull.
- Source of scope: `.agent/EXECUTION_PROMPT.md`
- Branch policy: main only; no force-push; no release/tag/publication.
- HARDENING_3/2/1 records below remain untouched except status-header
  reconciliation noted above.

## H4.0 Baseline truth (recorded 2026-08-25)

- Hosted CI run `32840538303` (SHA 270b375) inspected through the PUBLIC
  GitHub REST API (no auth needed for this public repo): conclusion FAILURE.
  - Linux quality gate job 97778814888: install/lint/typecheck/unit GREEN
    (59 files / 643 tests); FAILED step 9 `pnpm exec playwright install
    --with-deps chromium` → ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command
    "playwright" not found; `pnpm test:integration` skipped.
  - Electron real-runtime proof (Xvfb) and Linux installed-artifact smoke:
    SKIPPED (needs: quality).
  - Windows path/native gate: SUCCESS end-to-end incl. release:smoke.
  - Classification: clean-runner workspace-executable resolution defect
    (CI/build defect), NOT a product regression; the H3 claim that hosted
    clean-runner CI was closed is therefore not yet certified.
- Truth drift confirmed by direct reads: campaign.yaml carried TWO
  `completed_task_groups:` keys under `progress`; AGENTS.md named M13 with
  M12's campaign name; HARDENING-CHECKPOINT.md #2/#3 section headers still
  said ACTIVE; STATUS.md verified-gates table still says hosted results are
  uninspectable (obsolete — public API works).
- Negative-space review targets from the planner (lock.ts age-only takeover,
  state-file.ts unlocked shared-tmp sweep) confirmed present by source read;
  deterministic proof + fix under H4.3/H4.4.

## Defect matrix (HARDENING_4)

Lifecycle: SUSPICION → EVIDENCE → SEVERITY → REGRESSION TEST → FIX → CLOSED.

### H4-D1 HIGH — root-level Playwright provisioning cannot resolve the executable on a clean runner — CLOSED

- Evidence: run 32840538303 job 97778814888 step 9 failure (above);
  root package.json has no playwright dep; @inspector/adapter-web owns it.
- Fix: `packages/adapter-web` now declares a `provision:browser` script
  (`playwright install --with-deps chromium`) and the Linux quality job runs
  `pnpm --filter @inspector/adapter-web provision:browser`, guaranteeing the
  downloaded revision matches the locked playwright version the tests import.
  All other CI/script executable invocations audited (vitest/tsc/eslint/tsx
  are root-owned; release/build scripts use only system git/npm/tar/zip and
  process.execPath).
- Regression proof: `packages/repo-contract/src/ci-workflow.test.ts` — the
  exact historical failing step is flagged; every `pnpm exec` step must be
  root-resolvable or --filter-scoped; provisioning must precede
  test:integration in the quality job. Guard bites on synthetic regressions.

### H4-D2 HIGH — duplicate `completed_task_groups:` mapping key could erase task-group history depending on YAML loader semantics — CLOSED

- Evidence: direct read of campaign.yaml progress block (two identical keys,
  lines 56 and 139 pre-fix).
- Fix: lists merged into one key; second occurrence removed; no identity
  lost. Regression guard: `packages/repo-contract/src/campaign-state.test.ts`
  rejects duplicate sibling mapping keys across ALL .inspector/state/*.yaml,
  duplicated identities inside durable progress lists, and cross-checks
  EXECUTION_PROMPT/campaign.yaml active-campaign agreement plus M13 naming.

### H4-D3 LOW — AGENTS.md described M13 with M12's campaign name — CLOSED

- Evidence: direct read ("M13 — REAL_TARGET_FLEET_CAMPAIGNS").
- Fix: corrected to INTELLIGENCE_GUIDED_AUTONOMOUS_QA, HARDENING_4 activation
  recorded; regression guard asserts AGENTS/state M13 naming agreement
  (campaign-state.test.ts) and that the drift pairing cannot return.

### H4-D4 HIGH — FileLock had no ownership fencing: a stale predecessor could delete a successor's live lock — CLOSED

- Evidence (proof by source read + deterministic repro): `release()` did an
  unconditional recursive rm of the lock dir; takeover was age-only. A holder
  outliving staleMs whose lock was taken over would delete the successor's
  lock on release, allowing a third contender in — two simultaneous owners.
- Root cause: ownership was inferred from directory age only; release was
  not ownership-checked.
- Fix (packages/scale/src/lock.ts): explicit per-acquisition random token
  persisted into `owner` (write is MANDATORY — failure removes own dir and
  retries); staleness = provably dead owner pid (immediate bounded recovery
  via signal-0 liveness) OR anonymous directory older than staleMs (crash
  between mkdir and owner write); a live owner is NEVER age-stolen (that was
  the double-ownership hole). Takeover steals via single atomic rename;
  release is rename-first, verifies the recorded token, deletes only its own
  directory, and restores anything else untouched.
- Regression proof: packages/scale/src/lock.hardening.test.ts (8 cases):
  predecessor-release-vs-live-successor fencing incl. contender refusal;
  dead-pid immediate recovery (<2.5s, not 30s); anonymous-aged recovery;
  fresh-anonymous grace window; exactly-one-winner contested steal;
  no-op foreign release; real cross-process protocol death recovery;
  bounded takeover debris.
- Residual documented caveat: advisory lock serializes IO but business
  ownership authority remains lease generation fencing (H2/H3 contract);
  single-host usage assumption for pid liveness is explicit in the docs.

### H4-D5 HIGH — StateFile.load() swept a FIXED shared tmp path without the lock and could delete a live writer's temp file — CLOSED

- Evidence (source read + Windows runtime proof): writers used exactly
  `<state>.tmp`; any concurrent reader's load() unlinked it mid-write. The
  new reader/writer race suite additionally PROVED the reverse direction:
  on Windows, an unlocked reader holding the destination open makes the
  writer's rename fail EPERM (reads lack FILE_SHARE_DELETE).
- Fix (packages/scale/src/state-file.ts): unique per-save temps
  (`<state>.<pid>.<uuid>.tmp`); sweep removes only the LEGACY fixed name
  always and unique-named temps older than tmpStaleMs (60s default) — crash
  debris, never live writes (live temps exist milliseconds); save() retries
  rename over a held destination with a bounded Windows sharing-violation
  backoff (genuine failures still throw after the bound); POSIX best-effort
  directory fsync after rename (skipped on win32, NTFS journals metadata);
  failed renames unlink their unique temp. update()'s mutation-only persist
  contract is now explicitly documented (a pure-function updater loses its
  work by design — pinned by test so it cannot silently change).
- Regression proof: packages/scale/src/state-file.hardening.test.ts (5
  cases) including a REAL concurrent external writer (worker thread, same
  on-disk protocol) vs hammering unlocked readers: zero torn reads, zero
  writer errors, writer throughput preserved under contention.
- Transitive regression (H4.5): full scale unit lane 97/97 green (incl. all
  H2/H3 fleet liveness/fencing/settlement suites) and scale integration
  13/13 green first-run (SOAK-J1 160 items/33 restarts exactly-once, J3
  fencing storms json+sqlite, J5 quarantine, fleet multi-lane chaos with
  duplicates=0).

## H4.9 Exact-tree local certification (2026-08-25) — PASS

- pnpm install --frozen-lockfile: PASS (21 workspace projects; lockfile
  gained only the repo-contract importer).
- lint: PASS — 0 errors / 4 pre-existing adapter-web `any` warnings.
- typecheck: PASS.
- Unit: **666 passed / 3 skipped across 63 files**, first run. New: 8 FileLock
  fencing, 5 StateFile atomicity (incl. real concurrent external-writer
  race), 11 repo-contract guards, +3 model-runtime stats semantics.
- Integration: 47 files; **202 passed / 1 skipped first-run**. The single
  failure was the DOCUMENTED environmental class (android real-backend
  `uiautomator dump` exit 137 under stale dual-emulator contention — same
  signature recorded in M13 and HARDENING_2); green in isolation
  immediately after with assertions untouched; no deterministic failure
  reclassified as flake. Real lanes re-proven post-change: web/Playwright,
  CLI/PTY (incl. VT viewport), Android AVD, Windows real UIA, Electron
  production runtime, full fleet chaos (duplicates=0), SOAK-J1..J7.
- release:smoke: PASS from a clean installed prefix — --version, doctor,
  fake hunt/explore, findings/runs/campaign list, manifest validate+run
  (2 workers), models summary, fixture provider hunt, invalid-provider
  refusal exit 4.

## H4.10 Hosted certification (2026-08-25/26) — DONE

- Final commit(s) pushed to origin/main without force-push; the exact pushed
  SHA's Actions run is inspected through the PUBLIC GitHub REST API.
- Certification chain: push 1b8435c → run 32934944139 FAILURE exposed H4-D8
  (first-ever Linux integration execution; node-pty POSIX spawn divergence);
  fix pushed as f687ef1 → run 32936068493 (attempt 1) **SUCCESS on the exact
  final SHA f687ef113ade73e5d2e033c4d4b1b084d0a9adef**, jobs:
  - Linux quality gate 98077403447 SUCCESS — step-level proof that browser
    provisioning (`pnpm --filter @inspector/adapter-web provision:browser`)
    ran and full `pnpm test:integration` executed to success (~7m11s), after
    lint/typecheck/unit green;
  - Linux installed-artifact smoke 98078986668 SUCCESS;
  - Electron real-runtime proof (Xvfb) 98078986620 SUCCESS — first hosted
    real-Electron lane completion in repository history;
  - Windows path/native gate 98077403508 SUCCESS.
- Per the anti-circular-truth rule, no documentation-only "green" commit is
  created between f687ef1 and this record's certification claim; future
  sessions query Actions for the current HEAD SHA. This state-synchronization
  commit itself carries a NEW uncertified SHA by construction.

### Session reconciliation note (2026-08-26)

An interrupted session left an UNLEDGERED working-tree batch (17 files):
speculative performance optimization (CI caches, prepared-statement caches,
single-pass ledger aggregation, fingerprint co-computation, sweep throttling,
an explore-loop checkpoint() removal). It was not measured, not gated, not
part of any H4 acceptance criterion, and partially contract-risky. Disposed
per policy WITHOUT discarding or landing it: preserved verbatim as
`.inspector/tmp/h4-stray-perf-batch-2026-08-26.patch` plus `git stash`
("stray unledgered perf-optimization WIP..."); tree restored to exactly the
certified SHA before state synchronization.

### H4-D8 MEDIUM — NodePtyBackend.spawn resolved a doomed session on POSIX for nonexistent programs (platform-semantics parity) — CLOSED

- Evidence: hosted run 32934944139, job 98074279721 — the FIRST Linux
  integration execution ever to run (H3's runs died at unit/provisioning)
  failed `node-pty-backend.integration.test.ts > rejects spawn of a
  nonexistent program`: promise RESOLVED {id:'pty-0'} instead of rejecting.
  Windows CreateProcess fails synchronously; POSIX fork/exec discovers
  ENOENT only inside the child. Single-OS test hid the divergence.
- Fix: resolveExecutablePath() performs the shell-equivalent PATH lookup
  before pty.spawn and fails fast with the same typed 'pty spawn failed'
  error on every platform; no session id is minted for a doomed spawn; no
  assertion weakened.
- Regression proof: test asserts rejection twice (idempotent typed failure);
  full cli-adapter integration suite 9/9 green locally incl. real PTY
  round-trip, VT viewport, conformance, exit-wedge; cli.hardening unit
  10/10; typecheck PASS.

## H4.6 Model-runtime dependent audit (2026-08-25) — DONE

Scope: every H3-changed behavior in @inspector/model-runtime plus its
transitive consumers (scale legacy router adapter, fleet-harness, workflows,
web-hunt observability passthrough).

- CONFIRMED DEFECT (fixed as H4-D7 below): aggregate stats.fallbacksUsed
counted failed ATTEMPTS, not fallbacks; per-attempt arrays were already
correct; no external consumers of the numeric counter existed.
- Audited-no-defect: health-exception containment (isHealthy catches),
deterministic candidate ordering, partial explicit estimates passing through
to gate defaults, sink.start fail-closed pre-invoke, sink.finish storeErrors
truthfulness, late-completion discard with prior conservative settlement,
denials accounting, restart reconciliation + observability parity (H3
suites re-green post-change).

## H4.7 Whole-repository negative-space sweep (2026-08-25) — DONE

Same-class audit across ALL authored packages (grep-evidenced, not sampled):

- Unique-temp atomic writers + age-gated bounded sweeps: workflows/atomic.ts,
  cli/atomic.ts, artifact-store — already correct (M11.P5 contract); scale
  StateFile was the outlier and is now aligned.
- RESIDUAL (documented, not speculatively changed): workflows/cli/artifact
  atomic renames lack the Windows sharing-violation retry added to
  StateFile.save(); a concurrent reader holding an evidence file open during
  a rewrite fails LOUD (no corruption), is unobserved in any suite, and the
  retry was proven necessary only for hot-reread state files.
- Stale-actor ownership release: FileLock was the only unfenced primitive;
  JSON lease store rides StateFile fencing, SQLite leases are transactional.
- Uncontained timer callbacks: production setInterval sites = scheduler
  heartbeat only (contained per H3-D1); fleet-harness renew is test-only.
- Package-local executables assumed global: none spawned bare in product src;
  adapter-sdk resolves bins explicitly; CI surface guarded by repo-contract.
- Durable-state schema duplication: mechanically rejected for all
  .inspector/state/*.yaml by repo-contract validators going forward.
- Late-promise mutation after deadline/cancel: runtime-owned race+discard in
  model-runtime; exploration/oracle cancellation boundaries were torture-
  tested in H2/H3 and remain green post-change (H4.5 reruns).

## H4.8 Performance/resource verification (2026-08-25) — DONE

- FileLock per-cycle cost grew by one owner-file write (+read on contested
  paths only); measured indirectly via unchanged soak walls: SOAK-J1
  160 items / 4 workers / 33 restart injections completed in 58.5s
  (in-family with prior campaigns), J3 json fencing storm 250 rounds 28.5s,
  fleet multi-lane chaos 154s with duplicates=0 and stable RSS growth
  (127->158MB, same class as H2 baselines).
- StateFile save() retry loop costs nothing off-Windows and only under
  observed Windows reader contention (bounded 12 attempts); replaces a hard
  failure, adds no healthy-path latency.
- New tests leak-checked: worker threads terminated, child processes exit,
  temp dirs removed in afterAll; no interval timers escape tests.

### H4-D7 MEDIUM — aggregate stats.fallbacksUsed misreported terminal failures as fallbacks — CLOSED

- Evidence: router.ts incremented the counter on EVERY failed attempt incl.
  the final non-retriable one (a cancelled single-provider call reported 1);
  diverged from attempt.fallbacksUsed array semantics; grep proved no
  external consumers of the numeric counter.
- Fix: counter now increments only on real transitions to the next
  candidate; exact per-field contracts pinned on ModelRuntimeStats;
  exhaustion reporting preserved byte-for-byte; ADR-0013 amended.
- Regression proof: three new model-runtime tests (transition counting,
  zero-fallback terminal case, retriable-but-last exhaustion wrapper);
  model-runtime suite 22/22 green.

### H4-D6 LOW — truth surfaces disagreed on campaign/hosted-CI state — CLOSED (final hosted certification pending as H4.10)

- Evidence: see H4.0 baseline (ledger ACTIVE headers, obsolete uninspectable
  claims, duplicate YAML keys, AGENTS name drift).
- Fix: ledger headers reconciled without touching evidence; STATUS.md
  verified-gates hosted-CI row rewritten to the public-API inspection rule
  with exact run/job facts; repo-contract guards now mechanically enforce
  prompt/state agreement so the next session cannot resume from prose that
  contradicts canonical state.

# HARDENING CAMPAIGN #3 — Whole-System Reliability, Intelligence Safety,
# Clean-CI Correctness, and Concurrency Torture

- Campaign: HARDENING_3
- Status: **COMPLETE** (2026-08-25; all H3.0-H3.10 phases DONE, all defects
  closed — header reconciled post-completion by HARDENING_4 H4.2; evidence
  below unchanged)
- Opened: 2026-08-25
- Base commit: `b13c54f8891f02326df782a1f608658bb7f07740` (planner activation;
  planned-from `9d65d334` = M13 final). Local main == origin/main.
- Source of scope: `.agent/EXECUTION_PROMPT.md`
- Branch policy: main only; no force-push; no release/tag/publication.
- HARDENING_2's and HARDENING_1's records below remain untouched.

## H3.0 Baseline (recorded 2026-08-25 at b13c54f)

- Reproduced locally on Windows (unit lane): h2-fleet two-controller scenario
  FAIL (`bExecutions` > 0) + vitest Uncaught Exception
  `LockAcquireError ... leases.json.lock within 5000ms` from
  `LeaseManager.renew <- StateFile.update <- FileLock.acquire <-
  Timeout._onTimeout campaign.ts:914`. Matches hosted Linux CI run
  32817613858 signature (stopReason=null + same unhandled error) — NOT a
  Linux-only flake: real product defect class, environment-independent.
- web.target-url / electron.hardening failures did NOT reproduce locally
  (host has Chromium): clean-runner browser-dependency defect, not product.
- docs/STATUS.md drift confirmed by direct read (M13 IN PROGRESS/ACTIVE vs
  campaign.yaml COMPLETE).

## Defect matrix (HARDENING_3)

Lifecycle: SUSPICION → EVIDENCE → SEVERITY → REGRESSION TEST → FIX → CLOSED.

### H3-D1 CRITICAL — unhandled LockAcquireError escapes scheduler heartbeat timer — CLOSED

- Evidence: local baseline-unit.log uncaught exception stack (above); hosted
  run 32817613858 quality gate red with identical signature; §3.2 of the
  execution prompt.
- Root cause: `executeWithExecutor`'s `setInterval` heartbeat invoked
  `this.leases.renew(...)` synchronously with no containment;
  `FileLock.acquire` throws after its bounded wait under contention, and an
  exception thrown inside a timer callback becomes a process-level uncaught
  error (kills controllers/vitest workers; on CI it terminated controller A's
  liveness mid-campaign producing stopReason=null).
- Fix: renewal attempts are contained in the heartbeat; ownership truth is
  generation fencing only — definitive `false` aborts the stale execution
  immediately (unchanged), while contention/transient IO leaves ownership
  UNKNOWN: retried on later ticks, never crashed, never silently treated as
  success.
- Regression proof:
  `H3 fleet liveness > a thrown renewal never escapes the timer...` (asserts
  first renew attempt THREW, execution still completed, ≥2 attempts) and
  `sustained renewal failure never crashes the controller nor yields false
  success` (all attempts throw; no completion; item stays queued truthfully).
  Fleet file green 3 consecutive full runs (20/20 each).

### H3-D2 HIGH — failed renewals consumed the heartbeat cadence slot (duplicate-execution window) — CLOSED

- Evidence: baseline failure `expect(bExecutions).toBe(0)` violated: with
  renewals crashing/stopping, A's lease expired while keepAlive raced the
  shared clock; B legally reclaimed and EXECUTED the contested item —
  duplicate work with A still live; hosted variant showed stopReason=null.
- Root cause: `lastRenewMs = t` was set BEFORE the renew call every cadence
  tick regardless of outcome; any thrown attempt therefore consumed that
  half-TTL slot as if renewed, silently ending liveness extensions.
- Fix (same change as H3-D1): only successful renewals maintain liveness;
  failures are non-consuming. An interim TTL-blindness self-abort design was
  explicitly REJECTED during development because fast/slow simulated clocks
  aborted legitimately-owned executions (proved by transient test failures);
  generation fencing is the sole authority for lost ownership — matching the
  documented HARDENING_2 contract and §3.2's 'lock contention cannot
  masquerade as no live owner'.
- Regression proof: existing `lost fencing generation aborts...` (still
  green), new containment tests above, and the stabilized two-controller
  scenario (blocked-external-holds, zero duplicate executions, exactly one
  durable completion) now passing repeatedly incl. under full-suite load.

### H3-D4 HIGH — CI hermeticity: browser-backed suites misclassified as unit — CLOSED

- Evidence: hosted run 32817613858: 3 failed files / 8 failed tests in Linux
  quality `pnpm test`: web.target-url.test.ts (6) and
  electron.hardening.test.ts (1) failing solely on missing Playwright
  Chromium; Windows gate green; downstream jobs skipped.
- Classification decision (explicit per §3.1):
  - web.target-url suite spawns REAL Chromium through the adapter subprocess
    with 30-120s budgets ⇒ INTEGRATION-class proof. Renamed to
    `web.target-url.integration.test.ts`; runs in the integration lane
    (verified 6/6 there).
  - electron.hardening attribution threading is PURE WIRING:
    WebAdapterHandler.applyAttribution runs BEFORE any browser launch
    (web-adapter.ts:195), so the assertion is now made while tolerating
    create-failure on browser-less hosts (+ shutdown cleanup) — hermetic unit
    coverage retained (5/5 locally).
  - Linux quality job now runs `pnpm exec playwright install --with-deps
    chromium` explicitly before `pnpm test:integration`, making the lane's
    runtime prerequisite reproducible rather than dependent on machine cache.
  - No skips added anywhere; no assertions weakened.

### H3-D3 MEDIUM — project truth surfaces disagree on M13 state — OPEN (H3.9)

- Evidence: docs/STATUS.md header 'Last updated: M13 IN PROGRESS', Campaign
  bullet 'M13 ... ACTIVE', milestone table row 'ACTIVE (SPEC-013)' vs
  .inspector/state/campaign.yaml active.status=COMPLETE + M13 block COMPLETE.
- Plan: reconcile STATUS.md (and audit README/ROADMAP annotations) in H3.9
  without rewriting any historical evidence.

## Open workstream ledger (updated as phases complete)

- H3.2 residual watch: FileLock remains synchronous Atomics.wait-based; a
  contended renewal can block its thread up to timeoutMs (documented debt,
  SQLite lease backend is the production default). Fixture clock races were
  gentled to 2.5x with explicit 45s bound; semantics unchanged.


- Campaign: HARDENING_2
- Status: **COMPLETE** (2026-08-24; header reconciled post-completion by
  HARDENING_4 H4.2; evidence below unchanged)
- Opened: 2026-08-24
- Base commit: `702b33a4b5897cbcdec8b4b0170ca16e8043f79e` (M12 final, post-push)
- Branch policy: main only; no force-push; no release/tag/publication.
- Scope: M12 fleet/campaign runtime — budgets, cancellation, leases,
  settlement durability, wall clocks, external holds, state truth, terminal
  semantics, verify/regress provenance, torture coverage, real-runtime proof.
- HARDENING_1's historical record follows below, untouched.

## H2.0 Baseline (recorded 2026-08-24 at 702b33a)

- Git: clean tree on `main`, synced with `origin/main` (push f7fba41..f5d27f1
  recorded in durable state). Planned-from SHA equals current HEAD.
- Gates: pnpm install --frozen-lockfile OK; lint PASS (0 errors / 4
  pre-existing warnings); typecheck PASS; unit **549 passed / 3 skipped (50
  files)** — matches the M12 final-gate record exactly.
- Real backends available this host (per prior proofs): Playwright/Chromium,
  ConPTY (@lydell/node-pty), Windows UIA bridge, ADB+AVD (health varies),
  Electron 43.4.1 executable. Hosted CI was triggered by the authorized M12
  push; results not inspectable from this host (gh unauthenticated) — owner
  checks Actions tab; any red lane triaged per SPEC-012 §15.
- Integration/release-smoke baselines: recorded below when runs complete.

## Defect matrix (H2.0 truth table — evidence-first)

Lifecycle: SUSPICION → EVIDENCE (repro/impossible-transition) → SEVERITY →
REGRESSION TEST → FIX → CLOSED. IDs D1..D14; nothing is marked CLOSED without
a deterministic reproducer demonstrating the defect or an impossible state
transition read directly from code plus a failing-before/passing-after test.

| ID | Sev | Invariant violated | Evidence (pre-fix behavior) | Correction | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | CRIT | Charge before consuming budgeted resources | `runExplorationItem` ran the whole exploration first, then charged once and IGNORED the charge result; FakeItemExecutor acted before charging each step. | `ExecutionContext.admit` permission hook + `ExplorationControl` threaded into fake/web/native loops (explore/src/control.ts); fake executor admits before acting. Tests: h2-control.integration (deny-upfront: zero overspend), h2-fleet-hardening D14. | CLOSED |
| D2 | HIGH | budget-exhausted structured/durable; consumption accounted | Rejected post-hoc charge lost usage entirely and still returned success. | Pre-consumption admission + incremental commits keep exact ledger totals; exhaustion maps to failedResult(budget-exhausted) preserving findings/evidence/runIds. Tests: h2-control "tiny budget" (bounded spend, durable failure class). | CLOSED |
| D3 | HIGH | Cancellation reaches real work | Signal checked once before runExploration only. | stopRequested/admit at every safe loop boundary in all three engines incl. waits/reset paths; cancelled exits skip reproduction; committed evidence stays; owned claims requeue. Tests: h2-control cancel-mid (mid-loop exit ≤20 actions) + evidence-survival/resume. | CLOSED |
| D4 | HIGH | Long executions keep leases or are fenced | Workflow executor never renewed; default TTL < real explorations → mid-run reclaim exposure. | Scheduler heartbeat (half-TTL, exact generation, epoch-guarded for crash simulation) aborts stale executions via signal; settle reconciles lease truth. Tests: h2-fleet-hardening heartbeat ≥2 renewals; fence-abort (stale aborted, 0 executions, staleCompletions=1). | CLOSED |
| D5 | CRIT | Crash-safe settlement | `leases.complete()` then `recordExecution()` non-atomically; death between them requeued a done-lease item forever. | PendingSettlementJournal written BEFORE either store mutates; constructor replays entries idempotently under fencing; settlement faults fail LOUDLY as controller crashes instead of being swallowed as item failures. Tests: crash-after-complete → recovered exactly once (1 execution across lives); crash-before-complete → journalled replay without re-execution; repeated lives exactly-once. | CLOSED |
| D6 | HIGH | Wall budget survives process lives | CLI granted a fresh setTimeout(maxWallMs) per process life. | Remaining wall derived from persisted startedAtMs; exhausted campaigns stop immediately/durably (`max-wall`, wall.exhausted in views). Test: CLI D6 restart-with-spent-allowance stops with zero additional spend. Pauses count toward the wall (documented). | CLOSED |
| D7 | HIGH | Externally-held liveness | 200×10ms spin then silent exit; status stayed running, ok true, exit 0. | Bounded wait to earliest reclaim (+grace), then truthful blocked outcome (reason/heldItems/earliestReclaimAtMs/waitMs) and stopReason `blocked-external-holds`; claim-marker ordering fixed so local claims are never misread as external holds; progress resets the one-wait budget. Tests: expiry→reclaim completes once; live renewal→blocked truth with queue intact; two-live-controller no-duplicate. | CLOSED |
| D8 | HIGH | Corrupt durable state fails closed | normalizeInPlace coerced wrong shapes silently; JSON lease store unvalidated. | StateFile validate hooks + state-validation.ts for campaign/ledger/lease JSON and SQLite lease reads: quarantine + StateCorruptionError on wrong types/impossible values/duplicate identities/invalid generations/negative counters; documented legacy-field migration only. Tests: corruption matrix + migration case. | CLOSED |
| D9 | MED | Refused ≠ completed | All-refused campaigns reported complete/ok/exit 0. | `classifyCampaignStatus` (single classifier for run exit + show/list): refusal-only campaigns report `refused`, ok:false, exit 2; mixed completion stays complete with refusedCount surfaced. Tests: CLI e2e refused campaign + classifier contract cases. | CLOSED |
| D10 | HIGH | verify/regress reach source findings | Attempt workspaces were fresh/empty; cross-item verification structurally impossible. | `targetConfig.sourceItemId` + optional findingId (auto-select single CONFIRMED): preflight validation (existence/producer/retention/cycles/self), dependency-gated claiming (source-durable before downstream; failed source ⇒ downstream target-incompatible refusal), contained resolution inside artifacts root, provenance notes. Tests: hunt→verify e2e reproduces source finding; preflight rejections; downstream-of-failed-source. ADR-0012. | CLOSED |
| D11 | MED | Repair contract coherence | Preflight REQUIRED repairAuthorized then runtime always refused. | Reconciled operator-only: repair items rejected at preflight (`repair-unsupported`) regardless of authorization; runtime policy-refusal kept as defense in depth; docs/state aligned. Tests: work-item validation both branches; CLI manifest-invalid path. ADR-0012. | CLOSED |
| D12 | MED | Truthful lifecycle after controller exit | deriveStatus returned running for any non-empty queue even after intentional exit. | Blocked classification from persisted blocked outcome; one classifier everywhere (run exit + inspectManifest); running appears only while work is queued without a terminal reason. Tests: classifier contract + scheduler blocked e2e. | CLOSED |
| D13 | LOW | Workspace teardown scope | finally-block rmSync deleted items/<id> shared by ALL attempts/lives. | Per-execution attempt-dir removal + empty-root sweep only; concurrent lives' workspaces untouched (found and fixed an intermediate instance-scoped regression via EBUSY on Windows before it landed). Covered by all multi-worker/restart suites green on Windows. | CLOSED |
| D14 | LOW | Per-item budgets honored | Only maxActions/maxWallMs consumed; maxResets/tokens/model/cost accepted but ignored. | Item ceilings enforced atomically inside ResourceLedger.charge/wouldAdmit via itemBudget projection (maxResets added to projection); wall stays engine-side. Tests: maxActions bounded exhaustion; maxResets rejection at ceiling; concurrent workers cannot oversubscribe one item's budget (exactly 10/40 admitted). | CLOSED |

Accepted existing semantics (documented, NOT defects): failed items are
requeued and retried by a fresh controller construction (SOAK-J1 depends on
retry-to-success across lives; SOAK-J2 proves zero additional spend for
budget-exhausted tails). This is the documented resume behavior.

## Phases

| Phase | Focus | State |
| --- | --- | --- |
| H2.0 | Baseline gates + defect matrix | DONE (baseline green at 702b33a: lint 0e/4w, typecheck PASS, unit 549/3skip, integration 165/1skip/40 files, release:smoke PASS) |
| H2.1 | Budgets pre-consumption (D1/D2/D14) | DONE — admit/commit control hook in all three engines; per-item ceilings atomic in ledger; regression coverage h2-control + h2-fleet-hardening |
| H2.2 | Cancellation reaches work (D3) | DONE — mid-loop cancel proven deterministically; evidence/resume preserved |
| H2.3 | Lease liveness (D4) | DONE — scheduler heartbeat + fenced abort; low-TTL tests |
| H2.4 | Settlement crash windows (D5) | DONE — journal + replay; both boundary crashes + repeated lives tested; settlement faults fail loud |
| H2.5 | Durable wall budget (D6) | DONE — persisted-start derivation + exhausted-stop e2e |
| H2.6 | External-hold semantics (D7) | DONE — bounded reclaim wait then truthful blocked; claim-window race fixed |
| H2.7 | Semantic state validation (D8) | DONE — validators across campaign/ledger/lease (JSON+SQLite) with quarantine; legacy migration |
| H2.8 | Truthful status contracts (D9/D12) | DONE — single classifier; refused/blocked statuses + exit codes |
| H2.9 | Workflow claims audit (D10/D11) | DONE — source references implemented + repair contract reconciled (ADR-0012); F8/TASKS/SPEC drift corrected |
| H2.10 | Stress/fault injection | DONE — 18-test hardening suite incl. two-live-controllers, fence abort, corruption matrix, concurrent budget race |
| H2.11 | Real-runtime validation | DONE — fake ✓, real web ✓, real CLI/PTY ✓, real android campaign item ✓ (isolated, live AVD); Windows/UIA+Electron campaign lanes remain unwritten/deferred (honest) |
| H2.12 | Repo truth reconciliation | DONE — AGENTS/README/STATUS/ROADMAP/SPEC-012/TASKS/CHECKPOINT/campaign.yaml synchronized |
| EXIT | Final gate on exact final tree | see final gate record below |

## HARDENING CAMPAIGN #2 RESULT

- Final commit/push: `7278eed` pushed to `origin/main`
  (702b33a..7278eed); local HEAD and origin verified identical; tree clean.
- Defects: **14 confirmed and CLOSED (D1–D14): 2 CRITICAL, 8 HIGH, 4 MEDIUM/**
  **LOW** — every fix carries deterministic regression coverage named above.
- Contract changes recorded in ADR-0012 (operator-only campaign repair;
  verify/regress source references) and additive ExecutionContext/
  CampaignReport/CLI-JSON fields documented in docs/STATUS.md.
- Environment deferrals: Electron executable absent (campaign lane deferred);
  no automated Windows/UIA campaign lane exists (bridge itself healthy and
  proven via native paths); hosted CI results not inspectable from this host.
- Remaining debt (MEDIUM/LOW): web exploration replay cost (~4–6 min E2E,
  product-acceptable); executor-hang force-kill is impossible by design for
  in-process cooperative executors (documented; real engines honor stop);
  paused wall time counts toward the allowance (documented choice).

---

# HARDENING CAMPAIGN #1 — Checkpoint

- Campaign: HARDENING_1
- Status: **COMPLETE** (historical; preserved verbatim below)
- Opened: 2026-08-21
- Base commit: `bff389034b0610f05237b0eff75f8fc2fc4fbf30` (M7 checkpoint, implementation campaign COMPLETE)
- Branch policy: main only; no force-push.
- Implementation campaign state is intentionally untouched (`campaign.mode: IMPLEMENTATION`, `campaign.status: COMPLETE`).

## Phases

| Phase | Focus | State |
| --- | --- | --- |
| 0 | Baseline gates | DONE (green at bff3890) |
| A | Crash / restart / durability torture | DONE (H-32..H-43, H-48; soak restart cycles) |
| B | SQLite / state corruption / transactions | DONE (H-33, H-35..H-36, H-40..H-41, H-43, H-45..H-47, H-66; corruption quarantine soak) |
| C | Exploration engine torture | DONE (H-48..H-56; browserless torture fixtures) |
| D | Oracle false-positive / false-negative | DONE (H-10..H-17; FP/FN fixture suite) |
| E | Reproduction / minimization torture | DONE (H-11..H-12, H-15; minimization property suite) |
| F | Autonomous repair adversarial | DONE (H-18..H-23, H-65; adversarial patch suites) |
| G | Adapter torture (web/android/cli/electron/windows) | DONE (H-57..H-64; per-adapter torture suites) |
| H | Scale / lease / scheduler concurrency | DONE (H-24..H-31; fencing storm + 37-restart soak) |
| I | Security hardening | DONE (H-05, H-18..H-19, H-42, H-44, H-61, H-63; redaction + containment + validation) |
| J | Long-run soak | DONE (7 soak tests; no leaks/corruption; numbers recorded) |
| K | Property / fuzz / mutation | DONE (36+ property cases; 7 mutants, 5 killed pre-existing, 2 survivors closed) |
| Final | Dogfood proof + exit gate | Dogfood DONE (6/6); exit gate IN PROGRESS |

## Baseline

Recorded 2026-08-21 at `bff3890`: lint PASS (0 errors, 5 warnings), typecheck PASS, unit 63/63 PASS (7 files), integration 47/47 PASS (12 files, ~366s). No flaky retries observed.

## Defect ledger

Lifecycle: SUSPICION → EVIDENCE → CLEAN REPRO → MINIMIZED REPRO → SEVERITY → REGRESSION TEST → FIX → REPLAY → BROADER REGRESSION → CLOSED.

### Wave 1 (transport, oracle/finding, repair, scale) — all evidence-first, all fixed

| ID | Sev | Subsystem | Summary | Regression tests | Status |
| --- | --- | --- | --- | --- | --- |
| H-01 | CRIT | adapter-sdk | Primitive JSON line (`5\n`) → unhandled rejection kills adapter process | jsonrpc.hardening.test.ts | CLOSED |
| H-02 | CRIT | adapter-sdk | Spawn ENOENT unhandled `'error'` crashes Inspector host | transport.hardening.test.ts | CLOSED |
| H-03 | HIGH | adapter-sdk | Early-exit child misclassified `deadline-exceeded`; post-close requests hang full deadline | transport.hardening.test.ts | CLOSED |
| H-04 | HIGH | adapter-sdk | Per-request `close` listener leak (MaxListeners after ~11 reqs) | listener-count stability test | CLOSED |
| H-05 | HIGH | protocol/core boundary | AJV validators had zero production callers; initialize/act/observe now validated (-32602 / typed errors) | protocol.test.ts + transport tests | CLOSED |
| H-06 | MED | adapter-sdk | Unbounded line buffer; EOF partial-line loss; decoder flush; silent send failures | jsonrpc.hardening.test.ts | CLOSED |
| H-07 | LOW | adapter-sdk | Method-not-found returned -32603 instead of -32601 | server dispatch test | CLOSED |
| H-08 | MED | adapter-sdk | close() never awaited exit; no SIGKILL escalation (zombie adapters) | stubborn-child test | CLOSED |
| H-09 | MED | adapter-sdk | Deadline expiry sent no cancel notification | cancel-on-deadline test | CLOSED |
| H-10 | HIGH | finding | TargetFailureOracle counted ACTION_FAILED automation misses as reproduction (false-positive factory; was recorded known debt) | oracle-fpfn.hardening.test.ts (23 tests) | CLOSED |
| H-11 | HIGH | finding | Minimization accepted any-oracle reduction → signature drift onto different defect | signature-preservation tests + stats | CLOSED |
| H-12 | MED/HIGH | finding | `{attempts:0,minSuccesses:0}` ⇒ CONFIRMED with NaN confidence | policy validation matrix | CLOSED |
| H-13 | MED | finding | Evidence bundles hollow (oracleEvidence/artifactRefs always []) and mutable post-export | bundle immutability tests | CLOSED |
| H-14 | MED | oracle | Soft-only suite verdicts set reproduced=true → weak signals could flip repair gates | suite weakSuspicion tests | CLOSED |
| H-15 | MED | finding | Driver throw stranded finding in REPRODUCING; hung driver hung forever | containment tests | CLOSED |
| H-16 | LOW | finding | FLAKY/NHO→CONFIRMED transitions lacked approver/reason metadata | transition audit test | CLOSED |
| H-17 | LOW | finding | exportRegression hardcoded `adapter-fake` | regression metadata test | CLOSED |
| H-18 | CRIT | repair | Worktree escape: patch-agent paths (`../`, absolute, UNC, `.git`) wrote outside isolation | worktree.hardening.test.ts + hostile-agent integration | CLOSED |
| H-19 | HIGH | repair | Failed `git status` mapped to "clean" (fail-open provenance guard) | fail-closed refusal test | CLOSED |
| H-20 | HIGH | repair | Mid-pipeline throw stranded finding in PATCHING/VERIFYING and lost the audit record | 3 containment regression tests | CLOSED |
| H-21 | HIGH | repair | Accepted patch evaporated on dispose; dangling regressionArtifact; wrong workspacePath | durability + applyAcceptedPatch tests | CLOSED |
| H-22 | MED | repair | Temp-dir leak per repair; Windows rmSync masking primary errors | dispose-leak test | CLOSED |
| H-23 | MED | repair | No test-tamper defense; probe blamed patches when probe itself invalid; NO_PATCH dead; expectOracle hardcoded | tamper/probe/NO_PATCH tests | CLOSED |
| H-24 | CRIT | scale | Cross-instance double execution: lock-free JSON state, blind overwrites | scale.hardening.test.ts (18 tests) | CLOSED |
| H-25 | HIGH | scale | Stale worker result overwrote newer state (no fencing token) | fencing/reclaim tests | CLOSED |
| H-26 | HIGH | scale | Corrupt state file silently reset progress → mass re-execution | quarantine + StateCorruptionError tests | CLOSED |
| H-27 | HIGH | scale | Facade campaign.stop permanently poisoned durable ledger (no resume path) | stop→resume lifecycle test | CLOSED |
| H-28 | MED | scale | executeItem throw aborted run(), lost item, leaked temp dirs, stranded findings | failure-durability tests | CLOSED |
| H-29 | MED | scale | Lease TTL never renewed mid-execution | renewal test | CLOSED |
| H-30 | LOW | scale | Ledger accepted negative/non-finite; clusterer mutated input; discovery surfaced conformance-fail adapters; dead Store param; facade deps throws unhandled | hygiene tests | CLOSED |
| H-31 | MED | scale | `CampaignOptions.stateDir` silently ignored (restart test never shared state) | restart-mid-queue test | CLOSED |

Wave-1 deferred debt: patchRationale/errorText redaction awaits a shared secrets-redaction util (wave 2); `relevantOracleIds` coarse fallback; FileLock advisory-takeover race documented (SQLite binding is production fix); minimization baseline costs one extra replay.

## Post-wave-1 verification

tsc --noEmit exit 0; eslint 0 errors (5 pre-existing warnings); unit 188/188 PASS (12 files). Integration re-run pending at next milestone gate.

### Wave 2 (core/store-sqlite, artifact-store, explore, platform adapters) — all evidence-first, all fixed

| ID | Sev | Subsystem | Summary | Status |
| --- | --- | --- | --- | --- |
| H-32 | HIGH | core | Observations committed with stepId:null — evidence attribution broken for every production step | CLOSED |
| H-33 | HIGH | store-sqlite | Same-id retry after adapter error → raw SQLITE_CONSTRAINT; idempotency column unread; duplicate-effect risk | CLOSED (idempotent insert + partial unique idx + explicit `duplicate` kind) |
| H-34 | MED | core | Budgets in-memory only; restart evades max_actions forever; artifact bytes unwired | CLOSED (durable seedActionCount + accountArtifactBytes) |
| H-35 | MED | store-sqlite | schema_version grew one row per open (+ latent same-tx DDL upsert bug found during fix) | CLOSED |
| H-36 | MED | store-sqlite | Same-ms checkpoint tie restored stale stepSeq → UNIQUE(run_id,sequence) mid-run crash | CLOSED (rowid DESC) |
| H-37 | HIGH | core | startRun/resumeRun orphaned subprocess + env counter on spawn/init failure; hardcoded adapter identity | CLOSED |
| H-38 | MED | core | close() recorded healthy `closed` after failed teardown; no honest statuses | CLOSED (crashed/failed statuses; CLI verified) |
| H-39 | MED | core | Hostile adapter-supplied obs.id aborted whole step tx | CLOSED (deterministic regeneration) |
| H-40 | LOW | store-sqlite | commitStep INSERT OR REPLACE mutated requested_at evidence timestamps | CLOSED |
| H-41 | MED | store-sqlite | No busy_timeout pragma; repeated resume re-observed lost actions (recovery multiplication) | CLOSED (suspicion on busy_timeout partially wrong — better-sqlite3 default 5s; pragma set explicitly anyway) |
| H-42 | HIGH | core | No runtime payload validation at persistence boundary (blind casts persisted garbage) | CLOSED (protocol-schema parsing before persistence) |
| H-43 | HIGH | finding/store | Wave-1 Finding fields (signature/minimization/lastTransition/adapter) not durable | CLOSED (migration + round-trip tests) |
| H-44 | HIGH | artifact-store | Path traversal via runId/sha256/name escapes baseDir | CLOSED (patterns + resolve-prefix containment + PathPolicyError) |
| H-45 | HIGH | artifact-store | Truncated write becomes canonical via dedup skip; meta.size lied; read() unverified | CLOSED (atomic writes, integrity-checked dedup, verifying read) |
| H-46 | MED | artifact-store | Symlink/junction following on write path | CLOSED (lstat/wx/realpath; junction variants tested for real on Windows) |
| H-47 | LOW | artifact-store | clear() could target cwd/filesystem root | CLOSED |
| H-48 | HIGH | explore | One replay failure destroyed entire campaign result; injected store never wired | CLOSED (per-anomaly isolation + incremental persistence) |
| H-49 | HIGH | explore | Unconditional MINIMIZED→CONFIRMED; bundles carried no oracle evidence/adapter identity; no regression scenarios exported | CLOSED (verifiedReproduction gate + signals/artifactRefs/adapter wiring) |
| H-50 | HIGH | explore | Policy-rejected actions entered reproducer path and inflated actionsExecuted | CLOSED |
| H-51 | MED | explore | Impossible-state detector: hardcoded #count, transition-blind → FP factory on healthy apps | CLOSED (transition-gated numeric-context heuristic) |
| H-52 | MED | explore | Fingerprint collisions: screen role-collapse, storage keys-only, FNV-32 fill dedup (proven collision pair) | CLOSED (sha256-based strongHash) |
| H-53 | MED | explore | Press candidates emitted valueless → guaranteed ACTION_FAILED budget burn | CLOSED (concrete key candidates) |
| H-54 | MED | explore | All-toxic fallback deliberately re-picked environment killers | CLOSED (dead-end path; sequence-family blacklist) |
| H-55 | MED | explore | Silent-catch degradation: reset errors swallowed, observer failures made actions permanently novel | CLOSED (observer-degraded stop + warnings) |
| H-56 | LOW | explore | Hygiene: wall-budget overshoot, dead modelBudget, selector escaping, dup actionKeys, double-counted novelty, Edge overwrite, Rng.pick, duplicated constants | CLOSED |
| H-57 | CRIT | adapters (android/windows/cli) | Repeated identical crash classified as success (string-set diff) → false-negative factory under reproduction replays | CLOSED (count-based multiset freshness) |
| H-58 | HIGH | adapter-web | Failed create leaked browser/seed server; SIGTERM skipped shutdown; trace zips littered tmpdir; reset lied about storage clear | CLOSED |
| H-59 | MED-HIGH | adapter-web | Late pageerror (>50ms) misclassified success; timeout floor exceeded wire deadline | CLOSED (clamped actionTimeout, error-window classification; residual race documented) |
| H-60 | MED | all five adapters | mkdtempSync misuse: discarded unique dirs, electron shared fixed artifact tree | CLOSED |
| H-61 | MED | android | Device-shell injection surface: raw `input text ${value}` interpolation; unvalidated keyevents | CLOSED (POSIX quoting + integer validation, round-trip tested) |
| H-62 | MED | android | Failed/partial uiautomator dumps shipped as valid empty trees; hidden hardcoded false | CLOSED (structured observeError; windows hidden documented debt) |
| H-63 | MED | cross-adapter | Secrets persisted unredacted: password fields, storage tokens, credentialed URLs | CLOSED (shared redaction module wired into web/windows/android/cli paths; freeform-text values = debt) |
| H-64 | LOW | adapters batch | Seeded server bound all interfaces; electron fault poisoned subsequent acts; windows dead-backend honesty; cli classification flip-flop; unimplemented `timeout` fault advertised; hardcoded runId/env attribution | CLOSED |

Wave-2 deferred debt (explicit, not silently dropped): post-hoc artifact-byte accounting; wall-clock/model-request/repair budgets still in-memory; web 50ms settle residual race (configurable); freeform logcat/screen text keeps query-string values; windows `hidden` always false (no UIA geometry); lexical (non-realpath) worktree containment vs hostile repo authorship; FileLock advisory takeover race; `.tmp-*` litter after hard crash until clear(); shared Finding→FindingRecord mapper duplication; RunController.reset() double-observe quirk.

### Wave 3 (soak, property/fuzz/mutation, dogfood proof)

| ID | Sev | Subsystem | Summary | Status |
| --- | --- | --- | --- | --- |
| H-65 | HIGH | repair | Masking-by-removal patches ACCEPTED: deleting the crashing element leaves the oracle silent, so a button-hider patch verified as RESOLVED. Found by the dogfood proof. | CLOSED — regression.ts retains pre-patch replay; engine.ts requires every unpatched-TARGET_FAILURE action to succeed post-patch else REJECTED ("masking suspected"); regression test in dogfood.integration.test.ts |
| H-66 | MED | protocol (+4 callers) | `newId("act"/"find"/"ckpt")` emitted `undefined_`-prefixed ids (PREFIXES keyed by long forms; `keyof` collapse hid it from tsc). Corrupted persisted evidence ids across explore/finding/scale/core checkpoints. | CLOSED — alias entries for every call-site kind, narrowed `IdKind`, runtime guard throws on unknown kinds, protocol id-kind tests |

Phase K mutation probes: 5/7 critical-logic mutants killed by existing suites; 2 survivors root-caused and closed with new tests — (a) worktree containment inner-collapse forms (`a/../b`) masked by the second defense layer → path-policy property suite; (b) web pageerror landing INSIDE a failing action's window had no coverage → web.window-classification.integration.test.ts (K1/K2).

Phase J soak results (clock-injected, 32s wall / 51.7s aggregate): 160-item × 4-worker campaign through **37 durable restart injections** — exactly-once execution, zero lost work, 26 stale completions fenced, ledger consistent; budget exhaustion tail durable; 500 duplicate claims rejected; 3000 router fallback iterations; 24 corruption quarantines; 5000 artifact writes (dedup 2.93×, zero .tmp litter); 3200 steps over 40 SQLite reopen cycles (~906 bytes/step). RSS +10–16MB per suite (ceilings respected), handle counts flat, temp dirs restored to baseline. No product defects surfaced by soak.

## Post-wave-3 verification

Dogfood proof 6/6 green (~4.1 min): autonomous exploration discovered #boom itself → evidence bundle integrity → masking patch REJECTED with audit → valid patch ACCEPTED (regression-first + probe) → applyAcceptedPatch + original-reproducer replay clean → FindingRecord RESOLVED persisted; two additional pipelines ran concurrently without cross-contamination.

---

# HARDENING CAMPAIGN #1 COMPLETE

- Completed: 2026-08-21. Final commit: the HARDENING_1 final state commit on `main` (pushed; no force-push).
- Exit gate: **PASS** — `pnpm install --frozen-lockfile` OK; lint 0 errors (5 pre-existing warnings); typecheck exit 0; unit **387 passed / 3 skipped** (28 files); integration **101 passed** (19 files, ~262s wall): dogfood 6/6, soak 7/7, web hardening+torture 16/16, repair e2e 3/3, repair hardening 12/12, worktree hardening 8/8, explore E2E 2/2, explore hardening 36/36 (unit), all adapter conformance suites green.
- Defect summary: **66 closed — 5 CRITICAL (H-01, H-02, H-18, H-24, H-57), 23 HIGH, 38 MEDIUM/LOW.** All Critical/High fixes have deterministic regression tests. Mutation probes: 5/7 critical-logic mutants killed by existing suites; both survivors closed with new tests.
- Soak: no material leak or corruption (37 restart injections with exactly-once execution; RSS +10–16MB per suite against 200MB ceiling; handle counts flat; temp dirs restored; SQLite ~906 bytes/step; artifact dedup 2.93× with zero `.tmp` litter).
- Environment limitations: M8 iOS remains DEFERRED_ENVIRONMENT (no macOS/Xcode); production bindings for PTY/UIA/ADB CLI/emulator remain mock-proven only.
- Remaining debt: see `hardening.deferred_debt` in `.inspector/state/campaign.yaml`.
- Next recommended campaign: **HARDENING_2** — production adapter bindings (real PTY/UIA/ADB/emulator), SQLite-backed leases replacing advisory file locks, oracle-evaluation persistence per docs/ORACLE-SYSTEM.md, resumable exploration graphs (spec 003 E7 gap), and semantic/value-level redaction.

## Post-wave-2 verification

tsc --noEmit exit 0; eslint 0 errors (5 pre-existing warnings; .mjs fixture globals added to flat config); unit **348 passed / 3 skipped / 0 failed** (22 files); adapter conformance 21/21 + 16 new web hardening integration green sequentially. Full integration re-run at campaign exit gate.

## Notes

- Defect detail lives with each entry's evidence; this file is the durable index.
- Update `.inspector/state/campaign.yaml` `hardening:` block alongside this file at every waypoint.

## H3.1-H3.10 phase outcomes (2026-08-25, final tree before commit)

- **H3.2 fleet concurrency** — CLOSED via campaign.ts heartbeat redesign:
  containment + non-consuming failed attempts + generation-fencing-only
  ownership. Regression tests: `H3 fleet liveness` ×2; existing D4 fence test
  unchanged-green. Fleet file green in 3 consecutive full runs and again
  inside the full-suite sweep. Fixture note: shared simulated clock gentled
  from 5x to 2.5x with explicit 45s bound — semantics assertions untouched.
  A TTL-blindness self-abort design was tried and REJECTED with evidence
  (fast/slow simulated clocks aborted legitimately-owned executions);
  recorded here so the decision is not silently re-litigated.
- **H3.3 ModelRuntime containment** — CLOSED: gate.admit / sink.start /
  sink.finish contained; new `budget-gate-error` + `model-store-error`
  terminal classes; `storeErrors` stat; settleGate containment pinned by
  test. Four regression tests in model-runtime.test.ts (provider never
  invoked on admission/store faults; conservative conversion on start fault;
  outcome survives finish fault).
- **H3.4 hostile numerics** — CLOSED: saneTokens/saneCost boundary,
  projection finite/safe guards, actualUsage per-field sanitization,
  validator reservation-cost finite check. Seven regression tests including
  persisted-NaN quarantine and restart reconciliation at sanitized bounds.
- **H3.5 taint/authority audit** — NO DEFECT: digest is bounded (1200/8×200)
  at creation, re-bounded (400) as a DATA BLOCK field at consumption,
  instruction preamble stays Inspector-controlled; planner suggestions face
  exact-inventory containment; suspicion capped 0.5 → NEEDS_HUMAN_ORACLE;
  repair path policy realpath-contained (M11 P5). Recorded as audited with
  references (session-memory.ts, model-context.ts:128/291-299).
- **H3.6 crash/restart** — added restart-reconciliation proof for hostile
  holds; existing coverage re-verified green: store started-row crash window,
  settlement journals/replay (D5 suite), checkpoint checksums (M10 matrix).
- **H3.7 cross-package sweep** — full unit 640/3skip (59 files) + integration
  203/1skip (47 files, FIRST-RUN green, ~9.6 min incl. real web/PTY/AVD/UIA/
  Electron lanes) + release:smoke PASS (installed prefix, M13 steps).
- **H3.8 measurement/flake** — web replay cost measured this sweep: M3
  exploration E2E 291s + determinism 98s (documented debt stands; no
  optimization attempted per scope discipline). Scale suite flake-hunted 3×
  consecutive greens post-fix.
- **H3.9 truth reconciliation** — STATUS.md header/campaign/table now agree
  with machine state (M13 COMPLETE, HARDENING_3 recorded); AGENTS.md campaign
  note extended to HARDENING_3; ADR-0013 amended (taxonomy + untrusted-number
  boundary); README audited — no drift found.
- **H3.10 certification** — gates above run on the exact tree that is
  committed; push follows; hosted CI inspection recorded in CHECKPOINT.md
  (unauthenticated gh — owner triages per SPEC-012 §15).

### H3-D3 CLOSED

docs/STATUS.md reconciled (header, Campaign bullet, milestone table row).
No historical completion evidence rewritten anywhere.

### H3-D5 CLOSED (severity raised HIGH during analysis)

Uncontained `gate.admit`, `sink.start`, `sink.finish` escapes violated the
documented Never-throws contract AND risked unobservable/unaccounted spend.
Fix + classification additions are contract changes → ADR-0013 amendment
recorded in the same change set.

### H3-D6 CLOSED (severity HIGH)

NaN cost estimate previously admitted (comparison fail-open) and poisoned
durable state into StateCorruptionError quarantine (persistent DoS); negative
usage fabricated refunds. Full fix + proofs as listed under H3.4.

---

# HARDENING CAMPAIGN #5 — ACTIVE (activated 2026-08-26)

- Campaign: **HARDENING_5 — Fleet Execution Truth, Platform Parity,
  Cross-Platform Durability, and Measured Runtime Efficiency**.
- Activated from `.agent/EXECUTION_PROMPT.md` (planner commit `7214ae4`,
  planned-from `217165c` = HARDENING_4 COMPLETE state-synchronization HEAD).
  Local `main` fast-forwarded `217165c..7214ae4`; working tree clean.
- Execution contract: OpenSpec change
  `openspec/changes/hardening-5-fleet-truth/` (proposal, design, tasks, four
  capability deltas: fleet-execution-truth, cross-platform-atomic-writes,
  runtime-efficiency-proof, audit-certification).
- Baseline CI truth (public Actions API): run 32955622320 on planning baseline
  `217165c` = SUCCESS; planner commit `7214ae4` run 32961595668 was
  IN_PROGRESS at activation time.
- Canonical state: `.inspector/state/campaign.yaml` `hardening5:` block;
  prompt status set ACTIVE in the same activation checkpoint.
- Phase ledger H5.0–H5.9 tracked in campaign.yaml; defect lifecycle below.

## Defect ledger

| ID | Sev | Status | Summary |
| --- | --- | --- | --- |
| H5-D0 | HIGH | CLOSED (2026-08-26) | Electron family accepted by scale/manifest/capability probe executed as FAKE through the workflow layer (`familyAdapter`, `adapterSpawn`, exploration dispatch, `replayDriverFor` all defaulted to fake). Reproduced deterministically: accepted electron hunt item produced a SUCCESSFUL run with durable adapter/environment/notes `adapter-fake`. Closed: single `FAMILY_CONTRACT` in @inspector/workflows (compile-time exhaustive over scale's AdapterFamily), fail-closed resolution at every layer (typed refusal before workspace/run side effects), real Electron fleet lane preserving durable `electron-chromium` identity end to end, platform-faithful `ElectronReplayDriver` for reproduce/verify/regress, seeded-fixture-only target contract with preflight rejection of external-target forms, and an adapter-family matrix contract suite (unit, hermetic) that fails CI when any layer omits a declared family. Evidence: packages/workflows/src/electron-fleet.integration.test.ts (red→green), packages/workflows/src/adapter-family-matrix.test.ts. Gates on this slice: typecheck PASS; lint 0 errors / 4 pre-existing warnings; unit 673 passed / 3 skipped (64 files); workflows+electron+cli integration green first-run (24 + 40 tests). |
| H5-D1 | MEDIUM | CLOSED (2026-08-26) | WindowsUiaReplayDriver reproduced through the real UIA bridge even when the run was mock-backed — mock findings can never confirm (rejected). Closed by parity with the handler's `freshError(before, after)` before/after `errors()` logic. Regression: packages/workflows/src/windows-campaign.integration.test.ts leg 1 (mock → confirm + verify/regress). |
| H5-D2 | MEDIUM | CLOSED (2026-08-26) | Durable run/environment identity stuck on the provisional runner executable (`node.exe`) when lifecycle `create` fails. The adapter's self-reported identity was recorded AFTER create, so a missing-target failure left the wrong family. Closed by reordering `recordAdapterIdentity` immediately after `initialize` (H4-D4 comment updated). Regression: windows-campaign leg 2 now asserts `windows-uia` on the failed lifecycle. |
| H5-D3 | HIGH | CLOSED (2026-08-26) | `native-hunt` always created a REAL UIA replay driver for Windows reproduction, even when the run was mock-backed — same class as D1 but on the exploration confirmation path. Closed: single-source `resolveWindowsBackendKind()` over `INSPECTOR_WINDOWS_BACKEND` and `probeRealUia`, shared by exploration provenance and native-hunt reproduction. |
| H5-D4 | HIGH | CLOSED (2026-08-26) | Native-session candidate ranking sorted by static priority BEFORE usage/freshness, so priority-8 boundary fills (A*80) permanently starved every click (observed: 40/40 fills, zero clicks on SeedBank). Structurally prevented windows exploration from ever reaching a defect beyond a text box. Closed by ranking `useCount asc → priority desc` within the fresh/usable pools. Verified by the 8-seed H5.3 debug census → now anomalies reproduces. |
| H5-D5 | LOW* | CLOSED (2026-08-26) | Windows mock `SeedBank` had no autonomously-reachable seeded defect: the only defects sat behind `Log in` (denied as `external-side-effect` by the W2 safety boundary) and increment overflow (undiscoverable without reaching the dashboard). Added login-screen Edit `notes` where boundary input (≥32 chars) crashes validation single-action, TRIAGED to the same class as the web seeded defects; topology unchanged. | |


# HARDENING CAMPAIGN #5 � Fleet Execution Truth, Platform Parity,
# Cross-Platform Durability, and Measured Runtime Efficiency

- Campaign: HARDENING_5
- Status: IN-PROGRESS (phases H5.0-H5.7 CLOSED; H5.8 soak/flake sweep ACTIVE; H5.9 truth reconciliation + certification pending push)
- Opened: 2026-08-26
- Base commit: `7214ae4` (planner activation; H4 final f687ef1 -> fast-forward).
- Source of scope: `.agent/EXECUTION_PROMPT.md` + openspec/changes/hardening-5-fleet-truth/.
- Branch policy: main only; no force-push; push only when hosted certification is reachable.

## H5 every-file audit (H5.0.4-5) � DONE

- `.inspector/state/HARDENING_5-AUDIT.md` generated mechanically from `git ls-files`.
- tracked=527 == reviewed=527 + excluded=0. Every tracked file enumerated individually or via a clearly enumerated homogeneous group with member paths listed. Exclusions rule (generated/vendor/cache) yields 0 matches (lockfile/dependency output are gitignored, not tracked). Machine-checkable invariant `reviewed+excluded==tracked` holds.

## H5.6 Cross-platform atomic-write durability � DONE (2026-08-26)

- Inventory (H5.6.1): production atomic writers = workflows/atomic.ts `writeJsonAtomic`, artifact-store `atomicWrite`, scale `StateFile.save` (reference, H4-D5), scale `lock.ts` (mkdir-race + rename takeover), scale `writeJsonAtomic` (new), fleet-harness bundle writes (now atomic).
- Gap closed: `writeJsonAtomic` (workflows) and `ArtifactStore.atomicWrite` lacked the Windows sharing-violation retry + fsync that StateFile had (the exact H4.7 documented RESIDUAL). Added bounded win32-only retry (EPERM/EACCES/EBUSY, 12 attempts, backoff 5*attempt ms) + fd fsync, preserving unique-temp ownership (`wx`/pid+uuid) and loud failure after the bound. `fleet-harness` bundle writes converted to the new scale `writeJsonAtomic`.
- Regression: scale `state-file.hardening.test.ts` (5, incl. real concurrent external-writer race), artifact-store `artifact-store.test.ts` (6) + `hardening.test.ts` (53) + `soak.integration.test.ts` (zero tmp litter, dedup 2.93x), windows-campaign integration (2) all green.

## H5.7 Measured runtime efficiency � DONE (2026-08-26)

- Hypothesis evaluation (each independent):
  - prepared-statement caching: N/A for JSON durable state; store-sqlite already uses prepared statements -> REJECTED (no-op).
  - fingerprint co-computation: IMPLEMENTED � `StateFile.save` set-fingerprint-skips identical re-saves (no fsync/rename). `scripts/perf-bench.ts` captures the baseline (no-op save far cheaper than changing save).
  - temp-sweep throttling: already bounded (`MAX_ORPHANS_PER_SWEEP`, age 60s) -> REJECTED (already satisfied).
  - checkpoint cost / CI caching / synchronous FileLock waiting: not pursued (no measured win; SQLite remains default) -> REJECTED with rationale.
- Only the measured set-fingerprint skip was kept; all other hypotheses recorded as rejected.

## H5.1-H5.5 (Fleet truth) � DONE (see defect matrix H5-D0..D5)
