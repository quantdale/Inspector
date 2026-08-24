# HARDENING CAMPAIGN #2 — Fleet Runtime Integrity, Recovery, and State Truth

- Campaign: HARDENING_2
- Status: **ACTIVE**
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
