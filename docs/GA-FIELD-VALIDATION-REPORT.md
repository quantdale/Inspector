# GA Field Validation Report — RC1_FIELD_VALIDATION

Campaign: RC1_FIELD_VALIDATION (GA readiness)
Opened: 2026-08-22 · Decided: 2026-08-23
Ledger: `.inspector/state/GA-READINESS.yaml` (machine-readable source of truth)

## Decision

**GO_WITH_DOCUMENTED_DEBT** for the **0.1.0-rc.2** candidate.

- Publication status: **NOT_PUBLISHED**. No npm publish, no GitHub Release, no
  hosted binaries, and no replacement tag was created or pushed (authority not
  granted). `v0.1.0-rc.1` remains untouched.
- The decision is GO_WITH_DOCUMENTED_DEBT rather than GO because the validated
  candidate is rc.2, not the originally tagged rc.1: field validation found one
  HIGH defect that required a runtime fix. All named residual debt is
  MEDIUM/LOW and enumerated below; none of it invalidates the GA claims.

## Provenance

| Item | Value |
| --- | --- |
| Campaign start SHA | `f41063a94fe2137a9f80af9749812f80dd1866e0` ("unfinished progress", reconciled not discarded) |
| Original RC1 candidate | `v0.1.0-rc.1` @ `ddeea863905c1e185601ec95daffe7472bfa28de` (untouched) |
| Final tree SHA | `febbbab03e81caace420ed2f7c1076645bc848a3` |
| Proposed release candidate | **0.1.0-rc.2**, built from tree `85011ca9733c1dda3312acdb71bc1010332c482e` |
| rc.2 tarball SHA256 | `dc16434aae1c42053a5f65746b217ea8ad8ce52f97d57f4dfff27d7ce22f1263` |
| rc.2 bundle JS SHA256 | `48b67d4e41529b2c9573ea47d5a72f13d3af225d09883914837a1fc222039571` |
| Machine | Windows 11 (MINGW64_NT-10.0-26200), Node v22.23.2, pnpm 9.15.9, git 2.55.0.windows.3 |

## Confirmed Inspector defects (found by field validation)

| ID | Severity | Summary | Status |
| --- | --- | --- | --- |
| FIELD-1 | HIGH | `resumeRun` never issued `lifecycle.create` on the fresh adapter process and lost the targeted-web spawn-env delta → resume of a mid-flight killed web run always failed re-observation ("environment not created"); custom-target runs would have silently retargeted. Masked historically because the fake adapter tolerates observe-before-create. | **CLOSED** — migration #6 (`environments.create_options/spawn_env`), durable create-spec replay in `RunManager`, credential-stripped persistence; regression: strict-lifecycle fixture test + store tests (`cc0d34b`) |
| FIELD-2 | MEDIUM | UIA rehost recovery could not follow a window migrating to a NEW owner pid (Calculator "Keep on top" class): same-pid-only reattach died at the transition. | **CLOSED** — title-evidenced cross-owner fallback + bounded 250 ms poll in `attemptReattach`; 3 deterministic tests (`e40fa2d`). Note: the keep-on-top pinned surface itself is not enumerable at desktop root on this Win11 build, so that specific transition ends in truthful `REATTACH_FAILED` by design (evidence retained). |

Every fix carries deterministic regression coverage; affected field evidence
was re-run after the fixes (install battery 20/20 on rc.2, resume soak PASS).

## Environment findings (NOT Inspector defects — classified with evidence)

- **"Specified cast is not valid." during UIA Invoke**: app-side broken
  pattern advertisement on nameless WinUI `Pane` elements (Win11 Notepad).
  A/B/C escalation matrix (same-bridge retry / session reattach / brand-new
  PowerShell+UIA session) fails identically while every named control invokes
  cleanly. Product surfaced the failures honestly and continued exploring.
  Evidence: `.inspector/ga-work/hunts/uia-soak/cast-matrix-summary.json`.
- **ConPTY short-path cwd crash**: spawning through ConPTY with an 8.3 short
  path cwd (`%TEMP%` → `MICHAE~1`) hard-crashes node-pty natively. Harnesses
  sandbox under long paths; product paths never chdir into short paths.
- **Historical "transient vim after close"**: harness measurement error +
  delayed OS process reaping. PID-ancestry tracking shows every session's own
  vim pid reaped ≤745 ms after close; no Inspector leak.

## Field targets exercised (all production-real)

| Target | Backend | Result |
| --- | --- | --- |
| todomvc-react@1.0.4 | Playwright/Chromium vs installed artifact | 220 actions, 21 states, honest-zero findings |
| todomvc-backbone (official example) | Playwright/Chromium | 180 actions, 22 states, honest-zero findings |
| Calculator (UWP) | Real UIA bridge | 50 interactions, 0 failures, honest kill probe |
| Paint (Store) | Real UIA bridge | 38 interactions, 0 failures, honest kill probe |
| Notepad (WinUI) | Real UIA bridge | ~26 interactions, app-side pane failures honestly classified |
| vim (Git-for-Windows) | ConPTY via @lydell/node-pty | 265 interactions across 3 sessions; Ctrl-C ok; external kill → honest ACTION_FAILED; all session pids reaped ≤745 ms |
| com.android.settings | Real ADB on live AVD (Nitro_API_36) | 60 actions, 40 clicks, 0 failures, 7 screens |
| Seeded control (fake adapter) | LABELED CONTROL | finding reproduced→confirmed→bundled through full pipeline; excluded from novel-defect claims |
| Electron | — | NOT claimed production-real (injectable-only proof); explicit debt |
| iOS | — | DEFERRED_ENVIRONMENT (no macOS/Xcode runtime) |

## Soak / operational evidence

- **Interrupt/resume (installed rc.2)**: 14 abrupt process-tree kills across
  lifecycle timings incl. high-risk repeats → 11 clean resumes, 3 honestly
  documented refusals (adapter identity not yet recorded / run already
  failed), terminal-run guard refuses closed runs, **zero UNIQUE/BUSY errors,
  zero duplicate action ids, strictly increasing step sequences**, workspace
  cleanup possible after every cycle.
- **Web action-window attribution**: 56/56 passes (S1–S6 × 8 reps) with timing
  distribution persisted; beyond-settle behavior remains pinned/documented.
- **Long unattended campaign**: 6 sequential hunts in ONE workspace = 720
  actions, 0 failures; runs.db grows ~1.5 KB/step (linear, bounded);
  orchestrator RSS flat; process counts return to baseline; cleanup complete.
- **Resource stability**: UIA RSS 59.6→60.6 MB over 6 cycles with one shared
  PowerShell bridge (flat count); vim RSS/handles flat; no orphan processes
  attributable to Inspector anywhere (PID-tracked).

## Finding quality

- Healthy targets return **honest zeros** which remain visible in their own
  summaries (react 0/220, backbone 0/180, UIA 0 defect findings from 114
  interactions, vim 0/265, android 0/60).
- GA field false positives promoting environment noise into defects: **0**.
- Environment-failure rate on UIA: 4/114 interactions (3× classified app-side,
  1× honest staleness). Web/PTY/ADB: 0 unexpected failures.
- Reproduction: seeded-control finding 1/1 reproduced+confirmed in-run;
  historical dogfood audit stands (24 candidates → 5 true defects, 6 quality
  issues, 1 FP ≈ 4.2%).

## Install / provisioning / native deps

- npm tarball global install proven twice (disposable prefix AND
  machine-global repair path); shim invocation verified from cmd, PowerShell,
  Git Bash — all report the installed version.
- better-sqlite3 + @lydell/node-pty load from the installed artifact's own
  node_modules in every CLI operation; Chromium resolves from the documented
  `%LOCALAPPDATA%\ms-playwright` provisioning flow.

## Performance baseline

- Real-target web hunts: react 6.67 act/s, backbone 4.37 act/s (incl. browser
  lifecycle); inline target ~4.6 act/s sustained unattended.
- UIA cycle ≈ 25 interactions per ~2–3 min including app launch/close.
- Resume re-observation latency after mid-flight kill: seconds.

## Model/token/cost accounting

**Zero model calls** across every GA field campaign — zero by construction
(no model provider configured) and zero observed in artifacts. Recorded as
zero, not manufactured.

## Security / privacy re-check

No host-global mouse/keyboard injection APIs exist under `packages/**`
(grep-verified); UIA acts only through Invoke/Toggle/Value patterns.
`pnpm audit --prod`: zero known vulnerabilities. Persisted resume spawn-env is
credential-stripped at write. Freeform-text redaction unchanged from the
hardening ledger. Repair worktree containment remains lexical (documented
debt, unchanged). Policy/risk/idempotency enforcement exercised by every soak
resume. No security boundary was weakened during GA.

## Exact final gate (tree `febbbab`)

```
pnpm install --frozen-lockfile   PASS
pnpm lint                        PASS (0 errors, 4 pre-existing warnings)
pnpm typecheck                   PASS
pnpm test                        480 passed / 3 skipped (40 files)
pnpm test:integration            134 passed (27 files), exit 0, first run
```

Integration includes real-backend conformance (Chromium/ConPTY/UIA/ADB),
dogfood proof, repair e2e, soak suites — rerun on this exact tree.

## Residual debt (accepted, named)

1. W6 — autonomous exploration remains web-only in the product explorer;
   non-web platforms need bespoke loops (the Part C milestone addresses this).
2. C-F2 residue — keep-on-top pinned surfaces are not enumerable at desktop
   root on this Win11 build; transitions end in truthful REATTACH_FAILED.
3. PTY readScreen is scrollback-tail, not a cell grid (full-screen TUI state
   detection limited).
4. Electron adapter lacks a production-real target proof.
5. Repair worktree containment is lexical, not realpath-based.
6. Exploration graphs are not resumable (spec 003 E7 gap).
7. Wall-clock/budget accounting partly in-memory (hardening ledger carryover).

## Candidate/tag disposition

`v0.1.0-rc.1` untouched. rc.2 exists as a local, fully provenance-stamped
artifact. No tag was created or pushed (no authority). Publication remains
NOT_PUBLISHED pending explicit operator authorization.
