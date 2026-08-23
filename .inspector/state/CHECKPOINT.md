# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: **COMPLETE — M11 Operator-Grade Product Workflows & Distribution**
- Working branch: `main`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M11 P0-P7 are complete and were re-verified end to end on 2026-08-23 at
`91411fa` after the Electron runtime became executable on this host: the
production Electron field proof ran against a real Electron 43.4.1 process
(lifecycle, renderer inventory/actions, storage/screenshot/trace evidence,
target-failure classification, reset, close — previously
`ENVIRONMENT_DEFERRED`), two hardening tests that implicitly relied on the
injectable backend were pinned explicitly (they would otherwise launch real
Electron inside unit tests), the production launch test gained an honest
display gate for headless hosts, CI gained per-job timeouts, an explicit
`ELECTRON_SKIP_BINARY_DOWNLOAD` fast gate, and a dedicated Xvfb-backed
`electron-real` job plus a Windows Electron step. Full gates on that tree:
lint 0 errors / 4 pre-existing warnings; typecheck PASS; unit **533 passed /
3 skipped**; integration **155 passed / 1 skipped across 37 files on the
first run** (no retries needed); `release:smoke` PASS from a clean prefix.
Fresh clean-tree candidate `inspector-cli-0.1.0-m11.0.tgz` SHA-256 is
`2149dc76f09e4409e953270fa6c0481a9500439369ee09c595048765e10963ae`, built from
`23a4a27dcff472bd709c3b93b29572ad087564a5` with `source.dirty: false`; the
smoke proves the installed CLI's `--version`, `doctor`, fake `hunt`, fake
`explore`, findings/runs inspection, and `campaign list`.
Hosted CI has still not executed (no push authority; GitHub unreachable from
this host), so the Linux/Windows/Xvfb lanes remain CONFIGURED-not-yet-run.
M8 remains deferred to a macOS/Xcode environment; no release/tag action was
taken.

M9 native exploration is complete at `6ebc414`. M10 implementation waypoints
R0-R9 are complete at `c0835d7` (with the state synchronization committed
immediately afterward): a dedicated, checksummed exploration
campaign/checkpoint stream and durable reset events retain the generic
`checkpoints` table for low-level `RunController` step-sequence recovery;
web/native explorers, CLI continuation, deterministic restart tests, and real
web/Android interruption proofs are in place. Frozen install, lint, typecheck,
unit, integration, targeted resume, and bounded soak gates all passed. M8
remains deferred to a macOS/Xcode environment; no release/tag action was taken.

M11 P0-P7 are complete at the implementation tree ending in `36ed898`; the
final state and documentation synchronization follows in the closing commit.
The repository was clean at `023dabf` before M11 changes. `git fetch origin`
was attempted on 2026-08-23 but GitHub was unreachable from this environment;
the local `origin/main` reference remains behind the completed local work and
no push was performed.

### M11 P1 — verify/regress checkpoint

- Added durable verification and regression records (SQLite migration 9).
- Added `inspector verify <findingId>` with provenance validation, original
  adapter-family replay, bounded repeated oracle evaluation, lifecycle updates,
  evidence artifacts, JSON schema `inspector-cli/verify/1`, and deterministic
  exit classes.
- Added `inspector regress` with finding/run/adapter/revision filters,
  idempotent scenario keys, durable per-attempt progress, explicit skip and
  failure classifications, JSON schema `inspector-cli/regress/1`, and stable
  exit classes.
- Targeted integration: **2 passed** (`verify-regress.integration.test.ts`).
- M11 checkpoint gates: **typecheck PASS; lint 0 errors / 4 pre-existing
  warnings**.

### M11 P2 — explicit explore checkpoint

- Added `inspector explore` as a distinct workflow over the existing hunt and
  resumable exploration engines; it persists `workflow: explore` provenance,
  preserves `--resume`, and refuses cross-workflow resume mismatches.
- Added JSON schema `inspector-cli/explore/1` with durable campaign,
  coverage/novelty, finding-lifecycle, and explicit patching-disabled fields.
- Added operator help and a deterministic fake-adapter CLI integration proof.
- Targeted integration: **1 passed** (`cli.integration.test.ts` explore case).
- P2 checkpoint gates: **typecheck PASS**.

### M11 P3 — repair CLI checkpoint

- Added `inspector repair <findingId>` with required explicit `--repo-root`,
  exact resolved `--revision`, and explicit `--provider`/`--patch-agent`
  module boundary implementing the existing PatchAgent, replay driver,
  OracleSuite, and masking-probe contracts.
- The command invokes `RepairEngine` unchanged for confirmed findings,
  persists a running/completed SQLite repair record, preserves accepted and
  rejected patch attempts in an atomic audit artifact, and reports that the
  primary checkout was not modified or auto-applied.
- Added a deterministic provider-boundary integration proof: exact detached
  worktree, failing pre-patch regression, accepted patch, masking probe,
  post-patch replay/regression, RESOLVED finding, clean untouched checkout.
- No provider is synthesized when configuration is absent; the command
  refuses with `provider-required`.
- Targeted integration: **2 passed** (`repair-cli.integration.test.ts`).
- P3 checkpoint gates: **typecheck PASS; lint 0 errors / 4 pre-existing
  warnings**.

### M11 P4 — campaign CLI checkpoint

- Added `inspector campaign run|list|show|stop|resume` over the existing
  `@inspector/scale` `UnattendedCampaign` controller.
- Campaign manifests, queue/completion state, leases, resource ledger, worker
  assignments, budgets, and stop state are durable under the workspace;
  SQLite leases are the CLI default, with bounded worker/action/wall budgets.
- Added explicit `id=fake` target assignments and refusal for unsupported
  targets rather than silently routing them through the fake executor.
- Added a deterministic two-worker integration proof plus idempotent rerun and
  durable stop/resume checks; completed executions remain exactly once.
- Targeted integration: **1 passed** (`campaign.integration.test.ts`).
- P4 checkpoint gates: **typecheck PASS; lint 0 errors / 4 pre-existing
  warnings**.

### M11 P5 — product correctness and safety checkpoint

- Tightened the universal automation-failure boundary with deterministic
  hidden-element, stale-selector, UIA/ADB/PTY miss, and true-crash oracle
  regressions; automation misses cannot satisfy target-failure reproduction.
- Replaced lexical-only repair path checks with realpath-aware nearest-existing
  ancestor containment, covering symlink/junction escapes, traversal, absolute,
  UNC/drive, case-normalization, and `.git` policy cases.
- Redacted freeform PTY/logcat/web text for URL secrets, bearer/auth headers,
  cookies, credential variables, and recognizable API-key forms while keeping
  non-sensitive diagnostic context.
- Made JSON evidence/manifests atomic with bounded old-orphan cleanup; repair
  attempts and run artifact-byte accounting now survive process restart.
- Web page-error ownership now uses timestamped event buffering and action
  sequence windows, preserving the bounded settle window without attributing
  earlier errors to later automation misses.
- Targeted gates: **41 unit tests across oracle/redaction/artifact/containment,
  15 core hardening tests, 17 store/repair integration tests, 18 web
  integration tests, typecheck PASS, lint 0 errors / 4 pre-existing warnings**.
- P6 is now checkpointed; the next waypoint is P7 layered CI,
  distribution smoke, acceptance, and documentation synchronization.

### M11 P6 — Electron binding and terminal viewport checkpoint

- Added a production Electron handler using Playwright's Electron API,
  including renderer inventory/actions, main-process and renderer logs,
  page-error attribution, storage/screenshot/trace evidence, reset/restart,
  target-failure classification, and a deterministic fixture application.
- `auto` selects the real Electron executable only when it is installed;
  explicit `real` fails closed when the executable is absent, and injectable
  contract tests are explicitly selected rather than presented as real proof.
- This host has the pinned Electron npm package but no downloaded executable.
  The production test therefore records **1 availability/refusal pass and 1
  real-runtime test skipped**; no real Electron claim is made. `doctor` reports
  the missing executable as an optional warning.
- Replaced PTY scrollback-tail-only state with a deterministic VT cell grid,
  viewport/scrollback split, cursor/dimensions/fingerprint, bounded resize,
  and a cursor-addressed full-screen fixture. Real PTY redraw/resize proof:
  **1 integration test passed**.
- P6 targeted gate: **8 unit tests passed; Electron conformance 2/2;
  production binding integration 1 passed/1 skipped; PTY integration PASS;
  typecheck PASS; lint 0 errors / 4 pre-existing warnings**.
- P7 final checkpoint is recorded below; M11 is complete.

### M11 P7 — final CI, distribution, and acceptance checkpoint

- Added layered CI in `.github/workflows/ci.yml`: the Linux required gate runs
  frozen install, lint, typecheck, unit, and deterministic integration; a
  Windows runner covers path/repair, PTY/CLI, and release-smoke behavior.
  Hosted execution was not invoked because this session has no push authority.
- Release packaging now emits `inspector-release/2` provenance with version,
  source commit/dirty state, platform/architecture, Node/dependency
  expectations, payload entries, and checksums. Tarball content assertions
  reject workspaces, tests, evidence, secrets, temporary data, and undeclared
  payloads.
- Clean-prefix installed-artifact smoke passed for `--version`, `doctor
  --json`, fake `hunt`, `findings list`, `runs list`, and `campaign list`.
  Candidate `inspector-cli-0.1.0-m11.0.tgz` SHA-256 is
  `a626595041a3b1a9aab87145fca8fd36708c84e9bc015253041d4e54039001f3`, built
  from `e6f4c78471e030a39fcf9e232cb12e2b781bc8e3` with `source.dirty: false`.
- The deterministic product chain passed: hunt → confirmed finding → verify
  → regression → isolated repair → exact replay/regression pass → masking and
  benign checks → accepted reviewable patch, with the primary checkout
  untouched. Campaign restart/lease proofs, discovery-only explore/resume,
  and real PTY viewport proofs also pass.
- Final applicable evidence: **lint 0 errors / 4 pre-existing warnings;
  typecheck PASS; unit 533 passed / 3 skipped; integration 155 passed / 1
  skipped after bounded retries of the documented concurrent subprocess
  startup-flake class; M11 acceptance PASS; release smoke PASS**.
- Electron production binding and fixture are complete, but this host has no
  downloaded Electron executable: the real-runtime proof remains
  `ENVIRONMENT_DEFERRED`; injectable conformance is explicitly separate.
  M8 iOS remains deferred to macOS/Xcode/simulator. No package, tag, release,
  deployment, or other publication action was taken.

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

## Current debt audit

- CLOSED BY M9: native exploration, platform-faithful replay provenance, and
  automation-failure exclusion from target-defect promotion.
- CLOSED BY M10: resumable web/native exploration graphs, RNG/decision state,
  finding continuity, checkpoint checksums/retention, and durable hunt budgets.
- CLOSED BY M11 P1-P7: operator `verify`, `regress`, `explore`, `repair`, and
  campaign CLI workflows; repair containment/redaction; durable unattended
  accounting; atomic artifact cleanup; web action-window attribution;
  production Electron binding; terminal viewport semantics; layered CI;
  truthful release packaging; clean distribution smoke; stable CLI machine
  errors; and the M11 acceptance matrix.
- STILL OPEN: web exploration replay is expensive (~4-6 minutes in the
  existing full E2E gate); this is product-acceptable but not optimized.
- ENVIRONMENT-DEFERRED: iOS requires macOS/Xcode/simulator. Electron's
  production field proof is deferred because this host has no downloaded
  Electron executable; independent binding, fixture, refusal, and integration
  work is complete.
- PRODUCT DECISION REQUIRED: none currently.

Historical hardening and RC1/GA ledgers below remain historical evidence and
are not rewritten to claim that M11 work occurred earlier.

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

## M9 NATIVE AUTONOMOUS EXPLORATION — WAYPOINT 1 (2026-08-23)

- SPEC-009 created (`specs/009-native-autonomous-exploration/SPEC.md`); roadmap entry M9 added.
- W0 landed: `Capabilities.vocabulary` (ActionKindSpec: kind/targetScheme/risk/autonomousEligible) + schema validation + negotiation passthrough; backward compatible.
- W1 landed: honest vocabulary declarations for web/cli/windows/android adapters; windows adapter gained targeted create-attach (titleContains/pid via waitForWindow+attach) and a rich observe path exposing UIA patterns for candidate selection.
- W2 landed: two-layer external-side-effect gate — adapter-declared kind risk + contextual label deny-patterns (`sign in`, `purchase`, `delete`, `install`, ...) promoting candidates to external-side-effect; default policy denies.
- W3/W4 landed: buildUiaInventory/buildAndroidInventory/buildPtyInventory dispatched purely by declared target scheme; `runNativeHunt` generic session through RunController+FindingEngine with LRU rotation and fine-grained novelty fingerprinting; `hunt --adapter cli|windows|android [--target]` wired incl. durable resume specs (createOptions/spawnEnvDelta) and configurable observe timeouts for real-device adapters.
- Coverage: 494 unit / integration A4 test proves the session drives the Windows mock end-to-end with finding promotion + evidence bundles.
- Field proofs: P-WIN PASS (real Calculator, 40 actions/14 states, honest zero), P-CLI PASS (real vim over ConPTY, 80 actions/80 distinct states), P-ANDROID functional (65 actions on Settings, honest zero; depth + replay-faithful reproduction = next waypoints).

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

## M9 NATIVE AUTONOMOUS EXPLORATION - COMPLETE (2026-08-23)

- SPEC-009 W0-W8 all landed; spec Status: COMPLETE.
- W6 replay-faithful reproduction: android driver refactored to explicit
  backend selection (mock | real | injected) with pre-contact provenance
  refusal and force-stop reset (never pm clear); CLI fresh-session replay
  driver; windows semantic-descriptor driver (rid fast path, AutomationId
  fallback, type+name last) where an unresolvable locator is an
  ACTION_FAILED automation failure and NEVER a TARGET_FAILURE defect.
  Failure-class and wrong-target refusal tests are deterministic.
- W7 android depth: full-hierarchy UIAutomator parser (nested nodes,
  entity decoding, structural paths), semantic selector schemes with nth
  disambiguation, bounded container scrolling through the adapter
  vocabulary. Field result: com.android.settings 45 actions / 19 distinct
  states (pre-W7 baseline was 2 states).
- W8 proofs + exit gate: native finding pipeline proven (CONFIRMED via
  faithful replay; REJECTED when non-reproducible; automation misses never
  become defects). Field proofs on the final tree:
  Windows Calculator 56 actions / 50 states (clean exhaustion;
  Keep-on-top surface-detaching control annotated and declined
  autonomously; ROOT_ONLY_STUB blind-stub guard added to RealUiaBackend);
  CLI vim 100 actions / 100 distinct terminal states, no orphan processes.
- Exit gate on final tree: install PASS; lint 0 errors / 4 pre-existing
  warnings; typecheck PASS; unit 515 passed / 3 skipped (45 files);
  integration run 1 had 14 concurrent subprocess-startup flakes across six
  spawn-heavy files (documented environmental class) - every affected file
  verified GREEN in isolation - bounded retry run 2: 137/137 PASSED.
  No deterministic failure was reclassified as flake.
- Next proposed milestone: M10 resumable exploration campaigns (spec-003 E7
  gap). rc.2 publication status remains NOT_PUBLISHED; v0.1.0-rc.1 tag
  untouched; M8 iOS remains DEFERRED_ENVIRONMENT.
