# HARDENING CAMPAIGN #1 — Checkpoint

- Campaign: HARDENING_1
- Status: **ACTIVE**
- Opened: 2026-08-21
- Base commit: `bff389034b0610f05237b0eff75f8fc2fc4fbf30` (M7 checkpoint, implementation campaign COMPLETE)
- Branch policy: main only; no force-push.
- Implementation campaign state is intentionally untouched (`campaign.mode: IMPLEMENTATION`, `campaign.status: COMPLETE`).

## Phases

| Phase | Focus | State |
| --- | --- | --- |
| 0 | Baseline gates | IN PROGRESS |
| A | Crash / restart / durability torture | PENDING |
| B | SQLite / state corruption / transactions | PENDING |
| C | Exploration engine torture | PENDING |
| D | Oracle false-positive / false-negative | PENDING |
| E | Reproduction / minimization torture | PENDING |
| F | Autonomous repair adversarial | PENDING |
| G | Adapter torture (web/android/cli/electron/windows) | PENDING |
| H | Scale / lease / scheduler concurrency | PENDING |
| I | Security hardening | PENDING |
| J | Long-run soak | PENDING |
| K | Property / fuzz / mutation | PENDING |
| Final | Dogfood proof + exit gate | PENDING |

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

## Post-wave-2 verification

tsc --noEmit exit 0; eslint 0 errors (5 pre-existing warnings; .mjs fixture globals added to flat config); unit **348 passed / 3 skipped / 0 failed** (22 files); adapter conformance 21/21 + 16 new web hardening integration green sequentially. Full integration re-run at campaign exit gate.

## Notes

- Defect detail lives with each entry's evidence; this file is the durable index.
- Update `.inspector/state/campaign.yaml` `hardening:` block alongside this file at every waypoint.
