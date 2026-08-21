# Inspector RC1 Dogfood Campaign Report

- **Campaign:** `DOGFOOD_RC1` (release-candidate dogfood; ledger `.inspector/state/DOGFOOD-RC1.yaml`)
- **Date:** 2026-08-22
- **Candidate revision:** `1125ba9aa78ace4161783dd0c8d172130f127366` (current `main` HEAD)
- **Campaign base:** started from `8df01898fd569cbc7d6b866d5330f19a7608a587`; hunt/audit evidence committed at `097b8bd`, fixes at `2d63128`/`8ef51a3`/`708ae3e`, docs+verification at `1125ba9`
- **Machine / environment:** Windows 11, Git Bash, Node v22.23.2, pnpm 9.15.9, TypeScript strict-mode workspace, SQLite control-plane state, Playwright 1.62.1 + Chromium 151.0.7922.34 (`chromium-1217`/`1234`), `@lydell/node-pty` 1.1.0 (ConPTY), PowerShell/.NET UIA bridge, adb 1.0.41 / 37.0.1-15733141 with API 36 x86_64 system images and AVD `Nitro_API_36`, git 2.55.0.windows.3, Python 3.13.15, sqlite3 3.50.6 (all empirically probed in `INVENTORY.md`; gh CLI absent; notepad absent — Calculator/Paint used instead)
- **Final gate: pending at time of writing.** The Phase 32 final gate runs after this report; nothing in this document declares it passed.

---

## 1. Executive verdict

**Core question: can a fresh user install Inspector, point it at real software, leave it unattended, and receive trustworthy actionable QA findings?**

**Yes for web targets, end to end — including arbitrary localhost applications after the R1 fix.** A clean clone reaches a documented, working install → doctor → run path in ~2 minutes (CLEAN-CLONE-AUDIT.md); the production CLI `hunt` command drove two independently developed real TodoMVC apps unscripted through the full explore → oracle → reproduce → confirm → bundle pipeline; the seeded CONTROL app yielded 3/3 CONFIRMED known defects, proving detection is real rather than lucky. The one material caveat on the happy path — the explorer silently degenerating to navigation-only actions on class/placeholder-only React DOM (R1) — was found by this campaign itself, fixed (`708ae3e`), and re-proven: post-fix recall went from **2 states / 0 interactive actions to 24 states / 151 successful interactions**, with a backbone no-regression pass at 26 states.

**Production bindings are proven real for PTY, UIA, and ADB — autonomous exploration remains web-only.** Real ConPTY drove vim end-to-end (insert + save verified on disk); the real UIA bridge drove Calculator and Store Paint for 136 combined unscripted interactions with zero hangs and honest kill detection; the real ADB backend booted a headless emulator (~42 s) and drove Android Settings across 50 interactions with zero crashes. But in all four non-web hunts, driving was done by bespoke out-of-tree loops because ExploreController supports only the web vocabulary (audit finding W6). RC1's "unattended exploration" claim therefore holds for web targets only; non-web platforms have credible production *bindings* but no product-level autonomous explorer yet.

**Honest zeros on both healthy web apps.** Both real TodoMVC targets produced exactly 0 findings over 500 combined actions — reported as zeros, not averaged away. Overall candidate quality: confirmation rate ~45.8% of audited anomaly rows, false-positive rate ~4.2%, zero unresolved Critical/High defects, four named MEDIUM debt items remaining.

## 2. Targets

Six real targets plus one control. "Unscripted" means driven by the production CLI hunt (web) or an observation-driven novelty loop outside `packages/` (non-web; see W6). All numbers from `hunts/*/results.md`, `audit/METRICS.md` §1, and per-hunt `actions.jsonl`.

| Target | Platform / backend tier | Unscripted | Actions | States / novelty | Findings (audited) | Wall time |
|---|---|---|---|---|---|---|
| todomvc-react@1.0.4 | Web — real Chromium via Playwright (`adapter: web-playwright`) | Yes — production CLI hunt, seed 20260821 | 250/250 (back 68, fwd 61, reload 63, wait 58) | 2 states pre-fix; **24 states post-fix** (verify) | R1 (TRUE_DEFECT, HIGH), R2 (AQ), R3 (ENV), R4 (VLV) | ~35 s (pre-fix); ~29 s (post-fix verify) |
| todomvc-backbone (official example) | Web — real Chromium via Playwright | Yes — production CLI hunt, seed 42 | 250/250 | 34 states (pre-fix); 26 post-fix (no-regression pass) | B1 (EXPECTED_BEHAVIOR — honest zero) | ~6 min; ~38 s (post-fix) |
| vim (Git-bundled 9.2) | CLI/TUI — real ConPTY via `NodePtyBackend` (`@lydell/node-pty` 1.1.0) | Bespoke out-of-tree loop (W6); production bindings exercised | 69 (final run; 207 across runs) | 67/69 novel screens, 67 distinct states | V2 (TRUE_DEFECT, HIGH), V1 (AQ), W6 (systemic AQ), V3 (VLV), V4 (ENV), V5 (EXPECTED) | not recorded in retained logs |
| Windows Calculator (UWP) | windows-uia — real PowerShell UIA bridge (`RealUiaBackend`) | Bespoke out-of-tree loop (W6) | ~66 over 3 runs (~22/run) | tree-signature novelty; collapsed deterministically at ~interaction 23/run (C-F2) | C-F1 (TRUE_DEFECT ≡ M-A1), C-F2 (TRUE_DEFECT, unresolved), C-F4 (AQ ≡ M-A2), C-F3 (EXPECTED) | not recorded |
| Store Paint (mspaint) | windows-uia — real PowerShell UIA bridge | Bespoke out-of-tree loop (W6) | 70/70 (53 success, 17 harness coin-flip failures) | 195 distinct control names | M-A1 (TD dup), M-A2 (AQ dup), M-A4 (AQ, unresolved), M-A3 (**FALSE_POSITIVE**), M-A5 (EXPECTED) | ~2 min 27 s |
| Android Settings (`com.android.settings`) | Android — real ADB + headless AVD `Nitro_API_36` (`RealAdbBackend`) | Bespoke v2 out-of-tree loop (W6) | 50 (36 taps, 6 back, 8 swipes) | 19 distinct dump hashes | D-A1 (TRUE_DEFECT, HIGH), D-A2 (AQ, unresolved), D-A3 (VLV), D-A4 (ENV) | ~22 min session incl. reboot overhead |
| **CONTROL:** inspector-seeded-app | Web — seeded Inspector fixture (production pipeline) | Yes — production CLI hunt, seed 42 | 250/250 | 13 states | **3/3 seeded defects FOUND and CONFIRMED** (PAGE_ERROR, severity high, confidence 1.00) | not recorded |

Control vs novel: the control validates that the pipeline detects planted defects (3/3 CONFIRMED); it is excluded from novel-defect claims per DOGFOOD-RC1.yaml. Novel-target results are the six rows above.

## 3. Findings by classification

Authoritative classifications from `audit/FINDING-AUDIT.md` (independent audit, every claim re-derived from cited artifacts). 24 audited rows collapse to 11 distinct useful findings (5 TRUE_DEFECTs, 6 ACTIONABLE_QUALITY_ISSUEs).

| Class | Rows | Distinct |
|---|---|---|
| TRUE_DEFECT | 6 (R1, V2, C-F1, C-F2, M-A1≡C-F1, D-A1) | **5 distinct defects** |
| ACTIONABLE_QUALITY_ISSUE | 7 (R2, V1, W6, C-F4, M-A2≡C-F4, M-A4, D-A2) | **6 distinct issues** |
| VALID_LOW_VALUE | 3 (R4, V3, D-A3) | — |
| FALSE_POSITIVE | **1** (M-A3) | — |
| DUPLICATE | 2 explicit (M-A1≡C-F1, M-A2≡C-F4); W6 counted once despite 4 independent reproductions | — |
| EXPECTED_BEHAVIOR | 4 (B1, V5, C-F3, M-A5) | — |
| ENVIRONMENT_FAILURE | 3 (R3, V4, D-A4) — none attributable to Inspector adapters | — |

### Distinct true defects

| ID | Summary | Severity | Disposition |
|---|---|---|---|
| R1 | Explorer issued nav-only actions on React DOM lacking ids/labels (`selectorFor()` emitted no selector for class/placeholder-only elements): 250 actions, 2 states, 0 findings, silent false clean bill of health | HIGH | **Fixed + committed `708ae3e`** — positional fallback in `packages/explore/src/inventory.ts`; regression coverage `web.generic-dom.integration.test.ts`; recall verified post-fix (React 2→24 states; Backbone no-regression) |
| V2 | Host Node process wedges/crashes at exit after external kill of a real PTY session — upstream defect in shipped dependency `@lydell/node-pty` 1.1.0 Windows teardown (`conpty_console_list_agent` IPC leak); accountability ours because we ship it | HIGH (at observation time) | **Mitigated + committed `708ae3e`** — dead-session teardown skips `pty.kill()` and disposes socket workers directly; unref'd force-exit guard armed on stdin EOF when `INSPECTOR_PTY=real`; N=5 regression test + repro script. Residual risk: upstream defect persists behind the guard; re-triage on dependency upgrade |
| C-F1 ≡ M-A1 | `richTree()` returns success against a dead process while `windowStatus()` correctly reports death — dishonest observation violating attributable-observation invariant; reproduced on two apps | MEDIUM | **Fixed + committed `708ae3e`** — liveness gate in both layers (`Test-AttachedAlive` + `DEAD_WINDOW` throw in `uia-bridge.ts`; typed `WindowsBackendError("DEAD_WINDOW")` in `real-uia.ts`) with regression tests |
| C-F2 | Invoking "New Tab" makes Calculator rehost content into a new HWND; cached root then enumerates a 1-node subtree silently — no STALE_ELEMENT, no error, no re-attach; exploration deterministically dies at ~interaction 23/run seeing an "empty app" | MEDIUM (arguably HIGH; held at MEDIUM because bounded and detectable in diag output) | **Open debt** — landed fixes do NOT cover it; fix direction (auto-reattach by pid when subtree collapses to root-only) recorded in audit. Highest-priority unresolved windows item |
| D-A1 | `AndroidAdapterHandler.lifecycle create` unconditionally installs `/fixtures/seeddroid.apk` → hard-fails on any real device/preinstalled app ("failed to stat") | HIGH | **Fixed + committed `708ae3e`** — seeding opt-in via `AndroidLifecycleOptions.seedApk` (+ `launchPackage`/`launchActivity`); new `android.lifecycle.test.ts` |

### Distinct actionable quality issues

| ID | Summary | Severity | Disposition |
|---|---|---|---|
| R2 | CLI workspace isolation depends on ambient cwd; `pnpm cli` from an isolated workspace resolved repo-root cwd → shared runs.db → `UNIQUE constraint failed: actions.idempotency` | MEDIUM | **Addressed + committed `708ae3e`** — repo-root warning, absolute tsx resolution, collision remapped to diagnostic. Root cause is upstream pnpm cwd behavior; Inspector now detects/warns |
| V1 | PTY `readScreen` is scrollback-tail, not a cell grid; full-screen TUI redraws leave stale fragments (`-- INSERT --` persisting) degrading state detection | MEDIUM | **Mitigated + documented, deferred** — limitation recorded in `NodePtyBackend` docstring; cell-buffer fix intentionally out of RC1 scope |
| W6 | ExploreController supports web vocabulary only; three of five supported platform vocabularies have no autonomous exploration. One systemic gap, evidenced independently by four hunts | MEDIUM | **Open, documented** — roadmap-level concern; RC1 exploration claims scoped to web |
| C-F4 ≡ M-A2 | No wait-for-window-by-title affordance; UWP launcher pid ≠ window pid; every consumer hand-rolls listWindows polling | LOW | **Fixed + committed `708ae3e`** — `waitForWindow({pid,titleContains,timeoutMs})` added and exposed as lifecycle op |
| M-A4 | Autonomous loop invoked Paint "Sign in" starting a live sign-in flow; adapter exposes no risk/policy hook to exclude side-effectful controls | MEDIUM | **Open debt** — policy-hook design note needed before wiring non-web vocabularies into ExploreController |
| D-A2 | `RealAdbBackend.shell` throws on any nonzero exit, but `pidof <pkg>` legitimately exits 1 when absent — conflates "answer is no" with "command failed" in death-detection path | MEDIUM | **Open debt** — `real-backend.ts` unchanged; test works around with `.catch(() => "")`. Small fix, flagged as must-not-slip-past-RC1 |

Remaining rows: VALID_LOW_VALUE (R4 doc mismatch, V3 no resize op, D-A3 v1-explorer dead-end pattern validation) — deferred/documented, all LOW; FALSE_POSITIVE M-A3 excluded from product findings (harness coin-flip noise; adapter typed the errors correctly); EXPECTED_BEHAVIOR rows require no action; ENVIRONMENT_FAILURE rows are ops hygiene (stale servers, msys spawn paths, harness task timeout).

## 4. Metrics highlights

All rates computed only over audited candidates (24 rows); sources `audit/METRICS.md` §2 with per-row evidence in FINDING-AUDIT.md and hunt jsonl logs.

- **Confirmation rate: 11/24 ≈ 45.8%** (TRUE_DEFECT 6 rows/5 distinct + ACTIONABLE_QUALITY_ISSUE 7 rows/6 distinct).
- **False-positive rate: 1/24 ≈ 4.2%** (M-A3). Zero FPs among hunt claims the audit upheld as product issues.
- **Duplicate rate: 2/24 ≈ 8.3%** explicit duplicate rows; W6 additionally counted once though reproduced by 4 hunts.
- **Environment-failure rate:** 3/24 rows (R3 port collisions, V4 msys spawn path, D-A4 harness timeout) — none attributable to Inspector adapters.
- **Repairs: N/A (no attempts)** — all external targets were `authorized_for_repair:false`; zero repair attempts occurred. The Inspector repository itself was repaired normally during the campaign via the fix commits listed below.
- **Reproduction/minimization: N/A on external targets** — confirmed findings are adapter/engine/process defects with code-level evidence, not target-app findings entering the reproduce/minimize pipeline. The only pipeline reproduction exercised was the CONTROL hunt (3/3 CONFIRMED).
- **Explorer effectiveness around the R1 fix** (`hunts/verify/VERIFICATION.md`):
  - React target: **2 → 24 states visited**; 0 interactive actions → 84 fills + 22 clicks + 45 presses successful; verdict RECALL PASS. Honest note: ~46% of fill attempts still ended in honest target-level failures (re-query misses) — worth a later hardening look.
  - Backbone control: **34 → 26 states** — NO-REGRESSION PASS (bar was ≥15; drop explained by seed variance and 13 reloads now surfacing honestly as target-failures on the static build).
- **Cost proxies:** ~69 actions per useful finding aggregate (≈755 actions ÷ 11); model calls: **0 (verified, not assumed)** — no LLM/API reference exists in any hunt artifact; exploration is deterministic/heuristic.

## 5. Fixes made to Inspector during the campaign

Commits between campaign base `b49eb5f` and HEAD `1125ba9`:

| Commit | One-line summary |
|---|---|
| `2d63128` | Forward lifecycle create options through `AndroidReplayDriver`; fleet android lanes opt into the seeded path |
| `8ef51a3` | Correct oracle-evaluation listing expectations in store integration tests (companion to persistence work) |
| `097b8bd` | Commit six real-target hunt results, independent finding audit, and metrics artifacts |
| `708ae3e` | Fix defects exposed by real-target dogfooding: R1 `selectorFor()` positional fallback; V2 node-pty exit-wedge mitigation (dead-session teardown skip + force-exit guard + N=5 regression test); android lifecycle `seedApk` opt-in + `pidOf` handling; CLI workspace isolation warnings/diagnostics; UIA liveness gate (`DEAD_WINDOW`), modal/rehost regression tests, `waitForWindow`; oracle-evaluations persistence (store migration + engine provenance); 41 files, +2557/-112 |
| `1125ba9` | Finalize user documentation (README/DEVELOPMENT/PLATFORM-ADAPTERS/STATUS); record post-fix recall verification PASS |

Fleet seedApk regression caught by gates: after the lifecycle fix, the fleet/android lanes initially regressed (the c3 gate run shows 1 failing store test, `c3-gates.log`/`c3-integration.log`); it was caught by the gate run and fixed in `2d63128` (fleet lanes now explicitly opt into seeding) and `8ef51a3` — `fleet-fixed.log` shows the fixed suite green.

## 6. Operational record

From METRICS.md §4–§6, CLEAN-CLONE-AUDIT.md, and hunt reports:

- **Clean-clone first contact:** clone → `pnpm install` (3.8 s warm store) → `pnpm cli doctor` PASS → fake/web runs → `runs list`, ~2 min total; clean clone left at `%TEMP%/inspector-rc1-clean` per Wave E constraint.
- **Restart/teardown events:** every hunt recorded teardown verification — backbone server killed with port 8124 confirmed free; calc process killed with no bridge powershell remaining; mspaint 0 orphan bridges / 0 mspaint pids after dispose; vim `close {ok:true}`, aliveAfterClose:false; android appErrors 0 (pre-existing unrelated `emulator-5554` zombie left untouched by design); control launcher killed with ephemeral port released. React teardown not explicitly recorded beyond exit 0.
- **Port collisions:** 1 event, 2 ports (8123/8124 bound by stale PIDs 111016/78376); moved to 8191. Ops hygiene only (R3).
- **Emulator boot timings:** attempt 1 booted in ~39.6 s but was killed at the 600 s background-task timeout (harness artifact, counted as 1 environment recovery); attempt 2 relaunched without timeout and registered cleanly. Earlier binding bring-up had booted Nitro_API_36 headless in ~42 s and driven Settings in ~65 s.
- **Flake classification:** the Wave B gate showed 4 integration failures (K1/K2 pageerror-attribution hook timeouts at the default 10 s) that passed unchanged in the rerun (`integration-final.log`, 120/120) — classified timing/hook-timeout flake under load, not a regression. Mitigation landed: `hookTimeout: 30000` in `vitest.integration.config.ts`. Separately, the clean-clone audit saw 12 subprocess-startup timeouts under concurrent load that the main-repo baseline did not reproduce (102/102 green) — downgraded from code blocker to gate-headroom robustness issue.
- **Kill/recover probes (all honest):** calc taskkill→relaunch→reattach ×3; mspaint kill probe `{alive:false}` + relaunch to a fresh 191-node tree; android force-stop→relaunch (pid 1068→3946) and `pm clear`→fresh state; vim external kill detected in ~0.9–1.2 s.

## 7. Real vs mock backend matrix

Three-tier honesty discipline per `docs/PLATFORM-ADAPTERS.md`. Mock-backend validation is never presented as production-backend validation.

| Tier | Platform / backend | Evidence |
|---|---|---|
| **Proven real on dev machine** | Web — Playwright + Chromium | E2E launch/navigation/DOM verified; two real todomvc targets hunted unscripted (250 actions each); control hunt 3/3 CONFIRMED through the full pipeline |
| **Proven real on dev machine** | CLI — real ConPTY PTY (`@lydell/node-pty`) | Round-trip integration green; vim driven live (69 interactions, honest kill/liveness probes, insert+save verified on disk) |
| **Proven real on dev machine** | Windows UIA — PowerShell bridge (`RealUiaBackend`) | Tree/invoke/value round-trip on Calculator and Store Paint; dead-window detection and `waitForWindow` landed from dogfood findings |
| **Proven real on dev machine** | Android ADB — `RealAdbBackend` | Headless AVD booted (~42 s), Settings driven end-to-end (~65 s bring-up; 50-interaction hunt); dump retries, screencap validation, logcat |
| **Proven via injectable backend only** | Electron runtime binding | Interfaces conformance-proven against fakes; binary fetch chain verified reachable, but no real Electron runtime exercised in RC1 |
| **Proven via injectable backend only** | iOS interfaces | Fully specified + conformance-tested against fakes; no macOS/Xcode runtime available |
| **Deferred** | M8 iOS/Xcode | Deferred for lack of macOS/Xcode/simulator runtime; resumption requirements in `specs/008-ios/SPEC.md` |

Backend selection is explicit (`INSPECTOR_PTY=real|mock`, `INSPECTOR_WINDOWS_BACKEND=real|mock|auto`, `INSPECTOR_ANDROID_BACKEND=real|mock|auto`); any other value is an error, never a silent fallback.

## 8. Known limitations & deferred work

- **W6 — non-web exploration vocabularies:** ExploreController is web-only; autonomous exploration on CLI/windows/android requires bespoke out-of-tree loops. The largest single gap between "production bindings" and "autonomous QA findings" outside web.
- **C-F2 — UWP rehost residual risk:** silent 1-node subtree after Calculator content rehosting is unresolved; a future non-web explorer wired to this backend will hit it constantly.
- **M-A4 — policy hook:** no adapter-side risk/policy hook to exclude side-effectful controls (live sign-in was triggered autonomously once); design note required before non-web vocabularies enter ExploreController.
- **D-A2 — adb `pidof` contract:** `shell` throws on legitimate nonzero exits; death-detection needs a `shellOk` convention. Flagged as should-not-slip-past-RC1.
- **node-pty upgrade watch:** V2 mitigation trades the hang for a forced exit that can truncate late buffered output; upstream defect resurfaces on dependency upgrade until re-triaged (noted in code).
- **readScreen fidelity:** PTY screen model is scrollback-tail, not a cell grid; unreliable state detection for full-screen TUI apps (V1, documented in `NodePtyBackend`).
- **Exploration graph resumability:** spec 003 E7 checkpointing gap — exploration graphs are not resumable.
- **Electron runtime binding:** fetch chain proven, real runtime never exercised in RC1.
- **M8 iOS:** DEFERRED_ENVIRONMENT — no macOS/Xcode/simulator runtime; interfaces fully specified behind the injectable-backend pattern.
- Carried from hardening: budgets remain in-memory; redaction key/URL-scoped not semantic; FileLock takeover sub-ms advisory race (SQLite leases are the production fix).

## 9. RC1 recommendation

**ACCEPT AS RELEASE CANDIDATE.** This accepts RC1 as a candidate for release evaluation — it is not a release, publish, or ship authorization, which remain outside granted authority.

Acceptance-gate conditions and their status at time of writing:

| Condition | Status |
|---|---|
| Fresh-user install path works end-to-end | Satisfied — clean clone install → doctor → run in ~2 min; docs finalized in `1125ba9` |
| Unscripted hunts against real, independently developed targets | Satisfied — six targets hunted; two web targets via the production CLI hunt |
| Detection validated by control | Satisfied — 3/3 seeded defects CONFIRMED through the full pipeline |
| Independent finding audit with authoritative classifications | Satisfied — 24 audited rows, ~45.8% confirmation, 1 FP, duplicates cross-referenced |
| Defects fixed or honestly dispositioned | Satisfied — both HIGH defects fixed/mitigated and committed (`708ae3e`); post-fix recall/no-regression verification PASS |
| Repairs on authorized targets only | Satisfied — zero repair attempts on unauthorized external targets; Inspector repo repaired normally |
| Zero unresolved Critical/High defects | Satisfied — CRITICAL 0 at any point; HIGH 0 unresolved (R1 fixed; V2 mitigated with tracked upstream watch) |
| Remaining MEDIUM debt named | Satisfied — C-F2, D-A2, W6, M-A4 explicitly open and listed above |
| Gates green on the candidate tree | Satisfied at last full run — unit 415+ passed / 3 skipped, integration 120/120 (`integration-final.log`, exit 0); lint/typecheck OK. **Final gate: pending at time of writing** — Phase 32 runs after this report |

Named MEDIUM debt accepted into the candidate: C-F2 (UIA rehost subtree collapse), D-A2 (adb `pidof` contract), W6 (web-only exploration), M-A4 (policy hook).

## Appendix — artifact index

- Campaign ledger: `.inspector/state/DOGFOOD-RC1.yaml`; dogfood block: `.inspector/state/campaign.yaml`; checkpoint: `.inspector/state/CHECKPOINT.md`
- Backend inventory: `.inspector/rc-work/INVENTORY.md`
- Clean-clone first-contact audit: `.inspector/rc-work/CLEAN-CLONE-AUDIT.md`
- Authoritative finding audit: `.inspector/rc-work/audit/FINDING-AUDIT.md`
- Metrics: `.inspector/rc-work/audit/METRICS.md`
- Hunts: `.inspector/rc-work/hunts/{todomvc-react,todomvc-backbone,vim-pty,calc-uia,mspaint-uia,android-settings,inspector-control}/results.md`
- Post-fix verification: `.inspector/rc-work/hunts/verify/VERIFICATION.md` (+ `verify-react.log`, `verify-backbone.log`, workspaces under `hunts/verify/{react,backbone}`)
- Gate logs: `.inspector/rc-work/baseline.log`, `waveb-gates.log`, `integration-final.log`, `integration-rerun.log`, `c3-gates.log`, `c3-integration.log`, `fleet-fixed.log`, `fleet-isolated.log`
- Fix commits: `2d63128`, `8ef51a3`, `097b8bd`, `708ae3e`, `1125ba9` (range `b49eb5f..1125ba9`)
