# METRICS — Phase 11 Dogfood (RC1 Campaign), 2026-08-21/22

Sources: hunt artifacts under `.inspector/rc-work/hunts/<target>/`, authoritative
class counts from `audit/FINDING-AUDIT.md` (independent audit, 2026-08-22),
gate logs `baseline.log` / `waveb-gates.log` / `integration-final.log`.
Classification counts below are the AUDIT's FINAL classifications, not hunt
self-classifications. All fixes referenced are uncommitted working-tree changes
on top of `b49eb5f`.

## 1. Per-target table

| Target | Platform / backend | Unscripted? | Actions executed | Wall time | States / novelty | Candidate findings (audited rows) | Confirmed useful (TD+AQ) | FP | Duplicates | Env failures | Repro success | Minimization success | Repair attempts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| todomvc-react | web — real Chromium via Playwright (`adapter: web-playwright`, results.md) | Yes — production CLI hunt (`pnpm`-equivalent `tsx … bin.ts hunt`) | 250/250 (back 68, fwd 61, reload 63, wait 58; results.md) | ~35 s (results.md) | 2 distinct states, resets 4 | R1 (TRUE_DEFECT, HIGH), R2 (AQ), R3 (ENV), R4 (VALID_LOW_VALUE) | **2** | 0 | 0 | 1 (R3 port collisions) | N/A (0 findings on target → nothing to reproduce) | N/A | 0 (`authorized_for_repair:false`; no repair attempted) |
| todomvc-backbone | web — real Chromium via Playwright | Yes — production CLI hunt | 250/250 (results.md) | ~6 min (results.md) | 34 states, resets 1 | B1 (EXPECTED_BEHAVIOR — honest zero) | **0** | 0 | 0 | 0 (stale server on 8124 reused, not a failure; R3-adjacent) | N/A (zero findings by design — healthy target) | N/A | 0 |
| vim-pty | cli — real ConPTY PTY (`NodePtyBackend`, `@lydell/node-pty` 1.1.0) | Bespoke out-of-tree loop (ExploreController is web-only, W6); production adapter bindings exercised | 69 final run (207 across all runs; run3-actions.jsonl / actions.jsonl) | not recorded in retained logs | 67/69 novel screens, 67 distinct states (results.md) | V2 (TRUE_DEFECT, HIGH), V1 (AQ), W6 (systemic AQ, one gap four reproductions), V3 (VLV), V4 (ENV), V5 (EXPECTED) | **3** (V2, V1, W6) | 0 | W6 is itself the canonical row for its family (calc/mspaint/android reproduce it) | 1 (V4 spawn-path env reality) | N/A for target defects (vim healthy); defect repro = post-hoc N=5 wedge regression (FINDING-AUDIT V2) | N/A | 0 |
| calc-uia | windows-uia — real PowerShell UIA bridge (`RealUiaBackend` + `PowerShellUiaBridge`) | Bespoke out-of-tree novelty loop | ~66 interactions over 3 runs (~22/run; results.md; final-run jsonl retains 31 lines) | not recorded (no wall-clock timestamps in actions.jsonl) | tree-signature novelty; exploration deterministically collapsed at ~interaction 23/run (C-F2) | C-F1 (TRUE_DEFECT), C-F2 (TRUE_DEFECT, UNRESOLVED), C-F4 (AQ), C-F3 (EXPECTED) | **3** (C-F1, C-F2, C-F4) | 0 | 0 (C-F1 is canonical; M-A1 duplicates it) | 0 (taskkill probes were deliberate, honestly reported) | N/A (app defects: none found — Calculator healthy); adapter-defect fix verified in working tree | N/A | 0 |
| mspaint-uia | windows-uia — real PowerShell UIA bridge vs Store Paint | Bespoke out-of-tree loop | 70/70 interactions (82 jsonl events) | ~2 min 27 s (15:08:03→15:10:30Z, actions.jsonl first/last ts) | 195 distinct control names observed (results.md) | M-A1 (TD ≡ C-F1), M-A2 (AQ ≡ C-F4), M-A4 (AQ, UNRESOLVED), M-A3 (**FALSE_POSITIVE**), M-A5 (EXPECTED) | **3 rows** (M-A1 dup, M-A2 dup, M-A4 new) | **1** (M-A3) | 2 (M-A1→C-F1, M-A2→C-F4) | 0 | N/A (no product findings to reproduce; kill→relaunch→reattach recovery succeeded, results.md) | N/A | 0 |
| android-settings | android — real ADB + headless emulator (`Nitro_API_36`, serial emulator-5556, `RealAdbBackend`) | Bespoke v2 out-of-tree loop | 50 interactions (36 taps, 6 back, 8 swipes) | ~22 min session (14:55:34→15:17:30Z, actions.jsonl) incl. attempt-1 emulator loss + reboot | 19 distinct dump hashes | D-A1 (TRUE_DEFECT, HIGH), D-A2 (AQ), D-A3 (VLV), D-A4 (ENV) | **2** (D-A1, D-A2) | 0 | 0 | 1 (D-A4 harness timeout destroyed booted emulator) | N/A (Settings healthy: 0 FATAL EXCEPTIONs, appErrors count 0) | N/A | 0 |

Control measurement (excluded from novel-defect claims per DOGFOOD-RC1.yaml):
`hunts/inspector-control` — seeded Inspector fixture, production pipeline,
250 actions, 13 states, **3/3 seeded defects found and CONFIRMED** (PAGE_ERROR,
severity high, confidence 1.00; results.md). Validates end-to-end
explore→oracle→reproduce→confirm→bundle detection.

## 2. Overall rates (computed ONLY over audited candidates)

Audited anomaly/candidate rows in FINDING-AUDIT: 24 (R1–R4, B1, V1–V6-family, C-F1–C-F4, M-A1–M-A5, D-A1–D-A4).

- **Confirmation rate**: 11 confirmed-useful rows (TRUE_DEFECT 6 rows / 5 distinct defects + ACTIONABLE_QUALITY_ISSUE 7 rows / 6 distinct issues) of 24 audited rows = **11/24 ≈ 45.8%** (11 distinct findings after collapsing duplicates).
- **FP rate**: **1/24 ≈ 4.2%** (M-A3). Zero FPs among hunts' TRUE_DEFECT/AQ claims that the audit upheld as product issues.
- **Duplicate rate**: **2/24 ≈ 8.3%** explicit duplicate rows (M-A1≡C-F1, M-A2≡C-F4); additionally W6 is one systemic gap evidenced independently by 4 hunts (counted once).
- **Repairs attempted**: **N/A (no attempts)** — `authorized_for_repair:false` on all external targets; zero repair attempts occurred, so repair success rate is N/A (no attempts).
- **Reproduction/minimization rates**: **N/A (no candidates on external targets required them)** — all confirmed useful findings are adapter/engine/process defects with code-level evidence rather than target-app findings entering the reproduce/minimize pipeline. The only pipeline reproduction exercised was the control hunt (3/3 CONFIRMED).
- **Environment-failure rate**: 3 env-failure rows of 24 audited rows (R3, V4, D-A4) — none attributable to Inspector adapters.

## 3. Cost proxies

- **Actions per useful finding** (final/clean runs only): react 125 (250/2), backbone N/A (0 findings), vim 23 (69/3), calc 22 (66/3), mspaint 23 (70/3), android 25 (50/2). Aggregate across the six hunts: ~755 actions ÷ 11 useful findings ≈ **69 actions per useful finding**.
- **Wall time per useful finding** (where recorded): react ~17.5 s/finding (35 s/2); mspaint ~49 s/finding (147 s/3); android ~11 min/finding (session includes boot overhead — not a clean denominator). Backbone/vim/calc: **not recorded** (no timestamps in retained logs for vim/calc).
- **Model calls: 0 (verified, not assumed).** No LLM/API-model reference exists in any hunt artifact (`actions.jsonl`, harness scripts, logs); grep for `llm|model call|openai|anthropic` over the campaign docs returns nothing; the explore path is deterministic/heuristic per `docs/EXPLORATION-ENGINE.md` and each bespoke harness describes heuristic novelty scoring in its own header.
- **Artifact bytes per run** (`du -sb` of hunt dirs): todomvc-react 732,155 B (includes workspace runs.db); android-settings 636,530 B (screenshots dominate); vim-pty 85,585 B; mspaint-uia 47,327 B; calc-uia 19,086 B; inspector-control 3,999 B; todomvc-backbone 2,130 B.

## 4. Operational events

- **Port collisions**: 1 event, 2 ports (8123/8124 bound by stale PIDs 111016/78376; moved to 8191) — todomvc-react results.md #1; corroborated by backbone report reusing stale PID 78376.
- **Adapter/target kill-recoveries recorded in actions.jsonl**: calc — taskkill probe + relaunch + reattach OK ×3 runs (jsonl lines 18–20); mspaint — kill probe honest `{alive:false}`, relaunch+reattach pid 114620, 191-node fresh tree (jsonl lines 78–79); android — force-stop→relaunch (pid 1068→3946) and pm-clear→fresh-state probes passed (jsonl lines 140–141); vim — external-kill honesty probe, `isAlive→false` in ~0.9–1.2 s (summary.json/results.md).
- **Adapter failures**: mspaint 17× `PATTERN_UNSUPPORTED: Invoke` — harness coin-flip noise, correctly typed/mapped by the adapter (M-A3, FALSE_POSITIVE). Zero stale-element errors, zero bridge timeouts, zero hangs across both UIA hunts. One host-exit wedge class (V2, node-pty teardown) — mitigated in working tree.
- **Restart/recovery of harness infrastructure**: android boot attempt 1 killed at the 600 s background-task timeout after successful boot; relaunched without timeout (attempt 2 clean) — counted as 1 environment recovery, not an adapter failure.
- **Teardown verifications**: backbone server killed, port 8124 verified free; calc process killed + no bridge powershell remaining; mspaint 0 orphan bridges, 0 mspaint pids after dispose; vim `close {ok:true}` aliveAfterClose:false; android appErrors 0, pre-existing unrelated emulator-5554 zombie left untouched; control launcher killed, ephemeral port released. React hunt teardown not explicitly recorded beyond exit 0.

## 5. Explorer effectiveness before/after the `selectorFor()` fix

- **Before** (todomvc-react, pre-fix): 250/250 nav-only actions (back 68 / forward 61 / reload 63 / wait 58), **2 states**, 0 findings, `ok:true` — silent major coverage loss on class/placeholder-only React DOM (root cause `packages/explore/src/inventory.ts:57`).
- **After**: **pending** — `.inspector/rc-work/hunts/todomvc-react-verify/workspace/` contains only an empty `.inspector/` directory; no post-fix verification run numbers exist yet. Fix + regression coverage (`web.generic-dom.integration.test.ts`) verified present in working tree by the audit but not yet demonstrated by a re-run against the React target.

## 6. Gate history

| Gate | Commit / point | Unit tests | Integration tests | Notes |
|---|---|---|---|---|
| Baseline | `8df0189` (2026-08-21 19:23+08:00, baseline.log header) | 387 passed \| 3 skipped (28 files) | 102 passed (20 files) | lint OK, typecheck OK, INTEGRATION_OK, exit 0 |
| Wave B gate | working tree @ 2026-08-21 21:59+08:00 (waveb-gates.log) | **415 passed \| 3 skipped** (32 files), lint/typecheck OK | 116/120 pass, 4 FAIL (K1/K2 pageerror-attribution hook timeouts, 10 s) | Flake analysis: the same K1/K2 tests pass in `integration-final.log` rerun (22:14+08:00) with no code change between → timing/hook-timeout flake under load, not a regression. Full integration then green: **120/120** (25 files) |
| Current (latest available) | working tree on top of `b49eb5f`, fixes uncommitted | 415 \| 3 skipped | **120/120** (integration-final.log, exit 0) | All dogfood-driven fixes still uncommitted — must land in checkpoint commit to count durably (FINDING-AUDIT note) |

## Honesty notes

- Zero-finding targets (backbone; app-level zeros on vim/calc/mspaint/android) are shown as zeros, not averaged away.
- "not recorded" marks genuinely missing data: vim/calc wall times; post-fix explorer verification numbers.
- Denominators of zero are stated as "N/A (no attempts)" (repairs) or "N/A" with reason (repro/minimize on external targets).
- Every number above traces to: hunt `results.md`, hunt `actions.jsonl` line evidence, `audit/FINDING-AUDIT.md`, or the named gate log.
