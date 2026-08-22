# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: **COMPLETE**
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M7 scale/integrations is COMPLETE. `@inspector/scale` provides durable exclusive leases with TTL reclaim, a deterministic priority scheduler over bounded workers, per-item isolated environments, a resource ledger with deterministic global/per-worker budgets, a provider-neutral model router with fallback/escalation, finding clustering with provenance preservation, an MCP-compatible read-only facade with cooperative stop, and adapter registration/discovery with protocol compatibility matrix. The S8 proving campaign runs two isolated workers over four bounded items, injects controller restart, verifies no duplicate execution or cross-worker contamination, and produces a consolidated report.

M7 exit gate satisfied: bounded multi-worker unattended campaign survives controller restart, preserves durable evidence/state, accounts for resources, exposes a stable integration facade.

## Milestone summary

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 Foundation kernel | COMPLETE | fake adapter executes typed loops, crash/restart recovery |
| M1 Web sensing/acting | COMPLETE | Playwright adapter + seeded web app conformance |
| M2 Finding/reproduction | COMPLETE | confirmed/minimized/replayable evidence bundles |
| M3 Autonomous exploration | COMPLETE | 3 hidden defects discovered deterministically |
| M4 Oracle/repair | COMPLETE | full DISCOVERED→CONFIRMED→PATCHING→VERIFYING→RESOLVED loop in isolated worktree |
| M5 Android adapter | COMPLETE | mock ADB conformance + 2 defects confirmed via core pipeline |
| M6 Cross-platform adapters | COMPLETE | CLI/Electron/Windows pass common conformance |
| M7 Scale/unattended ops | COMPLETE | 2-worker campaign survives restart; facade stable |
| M8 iOS | DEFERRED_ENVIRONMENT | no macOS/Xcode/simulator runtime; interfaces fully specified |

Final gates at M7 checkpoint: **lint (0 errors), typecheck (exit 0), test (63 unit), test:integration (47 integration across 12 files)** — all green.

## Known debt (recorded in campaign.yaml)

- Legacy TargetFailureOracle counts ACTION_FAILED target-failures as reproduction; partially mitigated by OracleSuite.
- Web exploration E2E takes ~4–6 min wall clock.
- Production bindings (PTY/UIA/Electron runtime/ADB CLI/emulator) remain hardening items; injectable contracts proven by mocks.

## Resumption notes

- Hardening campaigns are separately invoked (`docs/HARDENING-CAMPAIGN.md`).
- M8 resumption requires a macOS worker with Xcode/iOS Simulator; entry point is an `IosSimulatorBackend` behind the established injectable-backend pattern plus `runCommonConformance`.

## HARDENING CAMPAIGN #1 COMPLETE (2026-08-21)

- Campaign: **HARDENING_1 — COMPLETE**. Implementation campaign state untouched (`IMPLEMENTATION` / `COMPLETE`). Full ledger: `.inspector/state/HARDENING-CHECKPOINT.md`.
- Result: **66 defects confirmed and closed** (5 CRITICAL, 23 HIGH, 38 MEDIUM/LOW) across reliability, recovery, correctness, oracle quality, repair safety, concurrency, adapter robustness, security boundaries, and long-run stability. Zero unresolved Critical/High defects.
- Final gates at the hardening final commit: lint 0 errors (5 warnings); typecheck exit 0; unit **387 passed / 3 skipped** (28 files); integration **101 passed** (19 files, ~262s wall) — including the dogfood proof (6/6), soak (7/7), web torture/hardening (16/16), repair e2e (3/3), explore E2E (2/2), and all adapter conformance suites. Unit suite grew 63 → 387 over the campaign.
- Dogfood proof: Inspector explored its own seeded web app autonomously, discovered the `#boom` defect itself, confirmed it with intact evidence bundles, REJECTED a masking patch (which exposed and fixed H-65: masking-by-removal had been accepted), accepted a valid patch with regression-first proof, applied and replayed it clean on a fixture checkout, persisted RESOLVED state, and ran two more pipelines concurrently without cross-contamination.
- Soak: no material leak or corruption — exactly-once execution across 37 durable restart injections, fenced stale completions, stable RSS/handles/temp dirs, bounded SQLite/artifact growth.
- M8 remains DEFERRED_ENVIRONMENT (no macOS/Xcode runtime became available).
- Remaining debt and next recommended campaign (HARDENING_2: production adapter bindings, SQLite-backed leases, oracle-evaluation persistence, resumable exploration graphs) are recorded in `.inspector/state/campaign.yaml` (`hardening.deferred_debt`) and the hardening checkpoint.

## RC DOGFOOD CAMPAIGN — Wave A (2026-08-21)

Fresh-engineer simulation artifacts under `.inspector/rc-work/`:

- `INVENTORY.md` — empirically probed production-backend matrix (Playwright/PTY/Electron/ADB/UIA/network egress) with gaps and action items.
- `CLEAN-CLONE-AUDIT.md` — clean-clone first-contact audit (`%TEMP%/inspector-rc1-clean`, left in place for later phases). Documented happy path (install → doctor → fake run → runs list) works in ~2 min; findings: web adapter undocumented/stale docs, `--help` exits 1, no `--version`, `--url` silently half-honored, integration gate has zero timeout headroom (12 subprocess-startup timeouts under concurrent load; main-repo baseline 102/102 green).
- `baseline.log` — main-repo baseline: lint/typecheck/unit 387/integration 102 all green.

Next recommended waves (per RC plan): B — production bindings + debt closure; C — unscripted dogfood hunts; D — independent finding audit; E — docs finalization + RC1 report.

## RC DOGFOOD CAMPAIGN — Wave B COMPLETE (2026-08-21)

Production bindings landed behind `real|mock|auto` selection (mock always available; real auto-probed):

- **web**: arbitrary localhost `targetUrl` targets (adapter-web create option + env), origin policy narrowed to configured origin, honest external reset; explore/core forward `targetUrl` so reproduction replays hit the SAME app; core gained `StartRunOptions.createOptions`.
- **cli-adapter**: real PTY (`@lydell/node-pty`) round-trip proven on this machine.
- **windows-adapter**: real UIA via PowerShell JSON bridge; Paint driven end-to-end (tree/invoke/value/IsOffscreen); stale-element + process-reap semantics.
- **android**: real ADB backend with liveness-verified devices, quoted input, dump retries, PNG screencap validation; booted Nitro_API_36 headless (~42s) and drove com.android.settings end-to-end (~65s).
- **cli**: `hunt` (unscripted web hunts via `--url`, deterministic fake walker through the full finding pipeline), `findings list/show`, `runs resume`, capability-probing `doctor` (9 probes, honors `--workspace`), named arg errors, `--version/--help`.
- **scale**: SQLite-backed lease store alongside FileLock; hardening suite green.
- **finding/repair**: oracle evaluation provenance recorded on verdicts; strict repair gates carry provenance.
- **dogfood/**: target manifests + stdlib static server; two independently developed real web targets acquired from npm and empirically served (todomvc-react@1.0.4 MIT; official TodoMVC backbone example w/ localStorage).

Durable state: `.inspector/state/DOGFOOD-RC1.yaml` (wave ledger) + `dogfood:` block in campaign.yaml. Next: Wave C unscripted hunts per target.

## INSPECTOR DOGFOOD / RC1 CAMPAIGN COMPLETE (2026-08-22)

- Campaign: **DOGFOOD_RC1 — COMPLETE**. Implementation (IMPLEMENTATION/COMPLETE), HARDENING_1, and M8 DEFERRED_ENVIRONMENT states untouched.
- Six real independently developed targets hunted **unscripted**: todomvc-react + todomvc-backbone (web/Playwright+Chromium), vim (real ConPTY PTY), calc + mspaint (real UIA bridge), Android Settings on a freshly booted headless AVD (real ADB). Seeded-app control ran separately and is excluded from novel-defect claims.
- Independent audit (`.inspector/rc-work/audit/FINDING-AUDIT.md`): 24 candidate rows → 5 distinct TRUE_DEFECTs, 6 distinct ACTIONABLE_QUALITY_ISSUEs, 1 FALSE_POSITIVE, duplicates marked; honest zeros on healthy apps. All Critical/High resolved via committed fixes (`708ae3e`, `2d63128`); remaining debt is MEDIUM/LOW and named in the report.
- Fixes driven by dogfood: explorer selector generation for label-less DOM (React recall 2→24 states, no-regression on Backbone 26 states), node-pty exit wedge mitigation + regression tests, android lifecycle seeding opt-in + pidOf semantics, CLI workspace isolation, UIA liveness/modal/rehost/waitForWindow honesty, oracle_evaluations persistence (migration #5) with bundle embedding, fleet seedApk integration caught by gates.
- Clean-install proof: **PASS** — clone→install→doctor→acquire target→hunt→findings→resume→mid-run kill→cleanup using only documented instructions (`​.inspector/rc-work/clean-install/PROOF.md`).
- Documentation finalized: README quickstart, DEVELOPMENT rewrite, PLATFORM-ADAPTERS real/mock/deferred matrix, STATUS refresh.
- Durable report: `docs/DOGFOOD-RC1-REPORT.md`.
- Final gate (Phase 32): recorded in `.inspector/rc-work/phase32-gates.log`; verified commit = final state commit on main.

## RC1_FIELD_VALIDATION RECOVERY (2026-08-22)

Interrupted GA session reconciled at `main@f41063a` ("unfinished progress",
clean tree, synced with origin/main). What survived that commit and what it
means:

- **Survived (harnesses)**: `.inspector/ga-work/hunts/{uia-soak,vim-pty,web-attribution,interrupt-resume}` + `tools/`. These are TOOLS ONLY — their existence is not phase evidence.
- **Survived (compact evidence)**: `ga-uia-summary.json` (2 notepad cycles only; 4× "Specified cast is not valid." invoke failures; kill probe honest) and `ga-summary.json` (3 vim PTY sessions, 265 interactions, ctrl-C ok, external-kill honest ACTION_FAILED, close clean). Both are retained as provenance-tagged inputs to phases P6/P5 but DO NOT by themselves complete those phases.
- **Runtime litter removed**: `sandbox/.scratch.txt.swp`, `sandbox/scratch.txt` untracked and regenerated deterministically by the harness from now on.
- **Portability fixed**: harnesses no longer hard-code `C:/Users/.../AppData/Roaming/npm/...` or Git-for-Windows vim paths; artifact/bin/vim/better-sqlite3 resolution is dynamic (env override → discovery → explicit failure).
- **Known gap in old vim soak**: machine-global `tasklist vim.exe` count was the orphan metric — replaced by launched-PID ancestry tracking (before/after spawn snapshot diff + per-PID liveness polls).

Phases 0–2 of `GA-READINESS.yaml` were independently re-checked against this
tree: post-tag audit (745433b+acbf924 = state-only + formatting-only), fresh
reproduction from ddeea86 with byte-identical tarball — records stand.

Remaining: phases 3–31 per `.inspector/state/GA-READINESS.yaml`.
