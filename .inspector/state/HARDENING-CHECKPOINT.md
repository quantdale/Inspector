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

## Notes

- Defect detail lives with each entry's evidence; this file is the durable index.
- Update `.inspector/state/campaign.yaml` `hardening:` block alongside this file at every waypoint.
