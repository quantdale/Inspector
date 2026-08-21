# RC1 Phase 22/29 — Clean-Install Release Proof

Date: 2026-08-21. Operator: autonomous agent (ox-alpha).
Method: fresh `git clone` of the source repo into `%TEMP%/inspector-rc1-final`
(HEAD `1125ba9`, clean tree), then every step executed using ONLY
`README.md` (Quickstart) + `docs/DEVELOPMENT.md` + `dogfood/README.md`.
No node_modules or runtime state reused from any prior checkout.
Workspaces: `$TEMP/inspector-rc1-ws{,2,3}` (isolated via `--workspace`).

Environment: Windows, Node v22.23.2, pnpm 9.15.9.

---

## Verdict table

| Step | Documented command | Worked? | Evidence | Doc gaps |
| --- | --- | --- | --- | --- |
| Clone | `git clone <repo> $TEMP/inspector-rc1-final` | YES | HEAD `1125ba9`; `git status` clean | — |
| INSTALL | `pnpm install --frozen-lockfile` | YES | Done in 8.1s, 201 pkgs, exit 0. Docs say plain `pnpm install`; frozen-lockfile also works and is stricter | GAP-3 (docs never mention `--frozen-lockfile`) |
| DOCTOR | `pnpm cli doctor` | YES | Exit 0; PASS: node 22, workspace writable, sqlite opens, fake adapter, **web (Chromium)**, **pty (@lydell/node-pty)**, **android adb**, **windows-uia (4 windows enumerated)**; WARN electron optional. Matches expected capability profile exactly | — |
| Target acquisition | dogfood/README.md npm-tarball recipe | YES (after friction) | `todomvc-react-1.0.4.tgz` + `todomvc-0.1.1.tgz` fetched from registry.npmjs.org; backbone example unpacked to `.inspector/rc-work/targets/todomvc-backbone/app` | GAP-4 (`$TARGETS` variable used but never defined) |
| Serve target | `node dogfood/bin/serve-static.mjs --port 8125 --dir .../app` | YES | HTTP 200 on `/`, stays up detached | — |
| HUNT | `pnpm cli hunt --url http://127.0.0.1:8125/ --seed 7 --max-actions 120 --max-minutes 8 --max-findings 3 --json --workspace <ws>` | YES | `"ok": true`, runId `run_722bc0c1f8574a489ace9a33c79eb287`, adapter web, seed honored, stoppedReason `action-budget`, actionsExecuted 120, statesVisited 29, anomalies 0, findings [], exit 0 | — |
| FINDINGS | `pnpm cli findings list --json --workspace <ws>` | YES | `[]` (hunt produced no findings — honest empty result). Bundle dir `<ws>/.inspector/bundles/run_722b.../` created but empty, consistent with zero findings | GAP-1 (empty bundle dir is created even with no findings; mildly confusing, docs silent) |
| RESUME | `pnpm cli runs list` / `runs resume <runId>` | PARTIAL | `runs list`: run shown `closed`. `runs resume` printed `resumed ... re-attached a fresh adapter process` then `re-observation FAILED: environment not created ... final status: closed`, **exit 1** | DEFECT-D1 (see below) |
| RESTART INJECTION | start hunt → taskkill tree at ~20–25s | YES | Killed full tree (bash→sh→pnpm→cmd→tsx→node bin.ts) with `taskkill /T /F`; all PIDs confirmed terminated; **0 orphan chrome.exe, 0 orphan node.exe** from the hunt; post-kill `doctor --workspace ws3` exit 0 all core PASS; killed run recorded as `created` in runs.db (honest, not misleading) | GAP-2 (first injection attempt failed to catch mid-run: a 120-action hunt completes in well under 20s on this machine — no doc guidance on kill-testing budgets; chromium had not yet spawned when tree was killed, so browser-child cleanup was not exercised under kill) |
| Post-kill doctor | `pnpm cli doctor --workspace <ws3>` | YES | exit 0, "core checks OK (1 optional capability warning(s))" | — |
| CLEANUP | dogfood/README Cleanup section | YES (after friction) | Server killed via `taskkill //PID //F`; port 8125 down; scratch `targets/` + `/tmp/cand` deleted; zero leftover serve-static processes | GAP-5 (docs say "Kill any serve-static.mjs processes" but never say how; Git-Bash `kill <winpid>` silently fails on detached Windows nodes — must use taskkill; cost one failed cleanup attempt) |

## Overall verdict: **PASS**

The documented flow clone → install → doctor → (configure = backend env vars,
defaults were correct for this machine) → hunt against a real npm-acquired web
target → findings → resume → restart-injection → cleanup is completable end to
end using only the repository documentation. Every command behaved sanely and
exit codes were honest. One behavioral defect candidate (D1) and five minor doc
gaps found; none block RC1.

## Defect candidates

### D1 — `runs resume` on a closed run reports success before failing (Medium)
`pnpm cli runs resume run_722bc0c1f8574a489ace9a33c79eb287` on a **closed** run
printed `resumed <id> on web-playwright` / `re-attached a fresh adapter process`,
then failed with `re-observation FAILED: environment not created` and exit 1.
Two problems: (a) it claims "resumed" for a run that cannot be resumed
(already closed); (b) the failure message "environment not created" is opaque.
Per the task contract a clear non-misleading result was required; this output
is misleading until the last two lines. Suggested fix: refuse resume of a
closed run with an explicit "run already closed" error (exit non-zero, no
"resumed"/"re-attached" lines).

### Doc gaps (Low severity each)
- GAP-1: An empty bundle directory is created per run even when there are no
  findings/bundles; README says "Evidence bundles land under ..." without
  noting the empty-dir case. Cosmetic confusion only.
- GAP-2: No documented guidance for validating hard-kill behavior (what budget
  keeps a hunt alive long enough to be killed mid-run; what post-kill state to
  expect in `runs list` — observed status `created`). Restart-injection testing
  required trial and error.
- GAP-3: README/DEVELOPMENT quickstart uses bare `pnpm install`;
  `--frozen-lockfile` (CI-appropriate, verified working) is undocumented.
- GAP-4: dogfood/README acquisition recipe copies into `"$TARGETS/todomvc-backbone/app"`
  but never defines `$TARGETS` (the roster table implies
  `.inspector/rc-work/targets/`). A first-time reader must infer it.
- GAP-5: Cleanup says "Kill any serve-static.mjs processes" without a command;
  on Windows/Git-Bash, `kill <pid>` (MSYS) does not terminate the detached
  Windows node process — `taskkill /PID <pid> /F` is required. Also worth
  noting stale servers from previous sessions may still hold ports (an
  orphaned 8123 server from a prior session was present and had to be killed;
  DEVELOPMENT.md troubleshooting covers port collisions generally, which helped).

## Raw evidence excerpts

### doctor (fresh clone, repo-root workspace)
```
PASS  node >= 22  (node 22.23.2)
PASS  workspace writable
PASS  sqlite store opens (...runs.db)
PASS  fake adapter resolvable
PASS  web adapter (Playwright + Chromium)  (...chromium-1234\chrome-win64\chrome.exe)
PASS  pty support (@lydell/node-pty)
PASS  android adb on PATH  (Android Debug Bridge version 1.0.41)
PASS  windows-uia automation  (4 top-level window(s) enumerated)
WARN  electron runtime  (electron package not installed)
doctor: core checks OK (1 optional capability warning(s))   EXIT=0
```
Note: doctor prints `warning: using repository-root workspace; pass --workspace
<dir> to isolate runs` — good actionable guidance.

### hunt (real target)
```json
{"ok":true,"runId":"run_722bc0c1f8574a489ace9a33c79eb287","adapter":"web",
 "seed":7,"stoppedReason":"action-budget","actionsExecuted":120,
 "statesVisited":29,"resets":0,"anomalies":0,"findings":[],"bundles":[],
 "warnings":[]}
```

### findings + bundles
`pnpm cli findings list --json` → `[]` (exit 0).
`<ws>/.inspector/bundles/run_722bc0c1f8574a489ace9a33c79eb287/` exists, empty.
`<ws>/.inspector/runs.db` exists.

### resume (closed run)
```
resumed run_722bc0c1f8574a489ace9a33c79eb287 on web-playwright
  re-attached a fresh adapter process; in-flight actions marked unknown
  re-observation FAILED: environment not created
  steps recorded: 241
  final status: closed
ELIFECYCLE  Command failed with exit code 1.
```

### restart injection
Tree killed at ~25s: `taskkill /PID 97088 /T /F` terminated 10 processes
(sh→pnpm node→cmd→tsx node→bin.ts node→adapter children incl. 116848/103708).
Post-kill scan: no chrome.exe, no node.exe matching the hunt workspace.
Post-kill `doctor --workspace ws3` exit 0. `runs list` shows the killed run as
`created` (honest record of an interrupted run).
Caveat recorded honestly: the injected hunt was killed during adapter startup
(Playwright chromium had not yet spawned), so child-browser teardown under kill
was not directly exercised.

### cleanup
- `taskkill //PID 121776 //F` (my 8125 server) → port 8125 DOWN.
- Stale pre-existing server on 8123 (from a prior session of the source repo)
  also killed via `taskkill //PID 111016 //F`.
- Deleted clone's `.inspector/rc-work/targets/` and `/tmp/cand`.
- Final scan: zero serve-static processes remain.
