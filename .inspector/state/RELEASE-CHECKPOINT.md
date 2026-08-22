# RC1 Finalization Checkpoint

Release campaign: **RC1_FINALIZATION — ACTIVE** (opened 2026-08-22).
Durable ledger: `.inspector/state/RELEASE-RC1.yaml`. Resume from that file,
never from chat history.

## Candidate resolution (Phase 0-1)

- Working tree clean; branches: local `main` only; remotes: `origin/main` only.
- `git pull --ff-only origin main` satisfied; HEAD == origin/main.
- Ambiguity `2a1fb6a` vs `15cda16`: RESOLVED. `15cda16` is a direct child of
  `2a1fb6a` (merge-base == `2a1fb6a`); diff touches exactly
  `.inspector/state/campaign.yaml` (+11/-2) and `docs/DOGFOOD-RC1-REPORT.md`
  (+2/-2) — pure durable-state/report checkpoint recording that the dogfood
  gate ran on `2a1fb6a`. No production code, tests, or release-relevant files
  differ between them.
- Authoritative starting candidate SHA:
  `15cda16421dffec69b988f578f9dba6168e449c6`.

## Environment (recorded)

- Node v22.23.2, pnpm 9.15.9, Git 2.55.0.windows.3
- OS: Windows 11 x86_64 (MINGW64_NT-10.0-26200)

## Key structural fact driving packaging work

Workspace packages are `private: true`, point `main`/`exports` at
TypeScript **source** (`src/index.ts`), have no build step (`tsc --noEmit`
only), and the CLI runs via `tsx packages/cli/src/bin.ts` with tsconfig path
aliases. **There is no distributable today** — RC1 must produce one
(bundle/build + production deps), prove install-from-artifact outside the
workspace, and keep it auditable.

## Progress log

- [x] Phase 0 rehydrate + repo topology verified (main-only, synced)
- [x] Phase 1 SHA ambiguity resolved -> candidate 15cda16
- [x] Phase 2 durable release state opened (this file + RELEASE-RC1.yaml)
- [x] Phase 3 freeze feature development (in force from now)
- [ ] Phase 4 exact-candidate baseline gates (BLOCKED by ENV-1; run FIRST
      on stashed-pristine tree per catch-up runbook below)
- [x] Phases 5-6 version/package surface audits (findings below; manifest
      remediation queued as REL-FIX items, applied with Phase 7 once shell
      returns — lockfile regen + gate rerun required)
- [x] REL-FIX-1 + PACK-FIX-1/2 IMPLEMENTED (code-complete, UNVERIFIED —
      no compiler/shell available; see Implementation batch section)
- [x] Packaging tooling implemented: scripts/build-release.mjs (+ root
      `build:release` script, esbuild devDep), version stamping, meta-manifest,
      SHA256SUMS, zip step
- [x] Release notes draft: docs/RELEASE-NOTES-RC1.md
- [x] Phase 25 skipped-test audit (grep-based, see below)
- [ ] Phases 7-12 artifact definition, packaging, checksums, install proof,
      artifact-only functional hunt, clean-machine simulation
- [ ] Phases 13-18 doctor/help/config/state/upgrade/uninstall audits & tests
- [ ] Phases 19-24 dependency/license/notices/SBOM/reproducibility/provenance
- [ ] Phases 26-27 security recheck, flake audit
- [ ] Phases 28-29 release docs + notes
- [ ] Phase 30 final gate on FINAL candidate SHA
- [ ] Phase 31 artifact-based final dogfood
- [ ] Phase 32 tag creation (only after pass) + Phase 33 push within authority
- [ ] Phases 34-37 stop-before-publish, final state, final report, git verification

## Phase 5/6 audit results (2026-08-22, read-only)

### Version surface (Phase 5)

- Root + all 17 workspace packages: `version 0.1.0`, `private: true`,
  `"type": "module"`, `main`/`types`/`exports` -> TypeScript source
  (`src/index.ts`). No `files`, no `repository`, no `license` field on any
  package manifest. Only `@inspector/cli` has a `bin`
  (`inspector` -> `src/bin.ts`, TS source — needs a TS loader today).
- RC1 version decision (pending, routine): semver pre-release on the shipped
  artifact (expected `0.1.0-rc.1`); workspace manifests stay `private` so the
  artifact version lives in the packaging definition, not npm publishes.

### Dependency declaration matrix (Phase 6)

Production-code imports vs declared deps — UNDECLARED workspace deps found
(all currently masked by pnpm hoisting; they break standalone/bundled installs):

| Package | Undeclared imports (production code) |
| --- | --- |
| `@inspector/core` | `protocol`, `store-sqlite`, `artifact-store`, `adapter-sdk` (core declares none) |
| `@inspector/cli` | `core`, `protocol`, `store-sqlite`, `finding`, `explore`, `artifact-store` (cli declares none) |
| `@inspector/adapter-web` | `adapter-sdk`, `artifact-store` (declares only `playwright`) |
| `@inspector/finding` | `store-sqlite` |
| `@inspector/explore` | `store-sqlite` (type-only) |
| `@inspector/scale` | `adapter-fake` |

Verified CLEAN (all production imports declared): `adapter-sdk`,
`artifact-store`, `oracle`, `repair`, `android`, `cli-adapter`,
`electron-adapter`, `windows-adapter`, `store-sqlite`, `adapter-fake`,
`protocol`.

REL-FIX queue (apply as one scoped release-engineering commit once shell is
back; adding deps requires `pnpm install` lockfile regen + full gate rerun,
which also produces the NEW candidate SHA):

- REL-FIX-1: add the undeclared `workspace:*` deps above to the six manifests.
- REL-FIX-2 (decide): test-only imports of `store-sqlite`/`artifact-store` in
  `explore`, `repair`, `scale`, `android`, `windows-adapter`, `cli-adapter`
  integration tests run under root vitest — acceptable to leave undeclared
  while packages stay private, but bundling must not rely on that.
- External runtime deps in the shipping graph: `ajv`, `ajv-formats`
  (`protocol`), `better-sqlite3` ^11.7.0 (`store-sqlite`, `scale`),
  `playwright` ^1.49.1 (`adapter-web`), `@lydell/node-pty` ^1.1.0
  (`cli-adapter`) — two native modules + browser binaries drive the Phase 7+
  packaging design.

### Skipped-test audit (Phase 25)

- `.skip`/`.only`/`.todo(` static annotations: **none**. The historical
  "3 skipped" unit results are `it.skipIf(!SYMLINKS_AVAILABLE)` cases in
  `packages/artifact-store/src/hardening.test.ts` (Windows symlink
  privilege-gated); integration adds `describe.skipIf` gates on real-backend
  availability (ADB `android.real-backend`, UIA `windows.real-uia`, PTY
  `node-pty-backend`, `pty-exit-wedge`). All are documented,
  environment-conditional skips — no unexplained skips remain.

## Phase 7 packaging design — DRAFT v1 (2026-08-22, shell-free)

Constraints discovered by read-only inspection (all verified in source):

- C1: Five adapter packages self-describe a spawn of their OWN TypeScript
  source: `<pkg>/index.ts` resolves `join(here,"bin.ts")` and spawns
  `node --import tsx <bin.ts>` (adapter-fake, adapter-web, cli-adapter,
  windows-adapter, android; electron-adapter passes
  `["--import","tsx",bin.ts]` through its launcher). An artifact without
  tsx + sources cannot spawn adapters.
- C2: `packages/cli/src/workspace.ts` joins `../../<pkg>/src/bin.ts`
  repo-relative; `packages/cli/src/doctor.ts` hard-codes
  `"packages"/"<pkg>/src/bin.ts"` from its own location — both assume a
  workspace CHECKOUT layout.
- C3: Native/platform deps in the runtime graph: `better-sqlite3` (prebuild),
  `@lydell/node-pty` (+ `@lydell/node-pty-win32-x64`), Playwright browser
  binaries (installed separately, not in node_modules).
- C4: All manifests private, ESM, NodeNext; tsconfig `paths` alias
  `@inspector/*` -> TS source.

Chosen approach (smallest design satisfying install-from-artifact):

1. COMPILE, don't bundle-across-process-boundaries: build all workspace
   packages with tsc into `dist-release/build/packages/*/src/**.js`
   (structure-preserving), so adapter bins exist as real JS files.
2. Ship a generated NON-private meta-manifest `dist-release/package.json`
   (`name: inspector-cli`, `version: 0.1.0-rc.1` expected,
   `bin: {inspector: build/packages/cli/src/bin.js}`, explicit `files`,
   prod deps limited to true runtime externals: `better-sqlite3`,
   `playwright`, `@lydell/node-pty`; pure-JS `ajv`/`ajv-formats` may be
   bundled into the cli entry IF their dynamic schema loads are static —
   decide during implementation, verify by grep for dynamic import).
3. PACK-FIX-1 (code, release-scoped): add one shared bin-resolver used by
   the five adapter default-spawn descriptors: prefer sibling
   `bin.js` when `import.meta.url` ends `.js` (built tree), else current
   `tsx + bin.ts` dev behavior. No behavior change in dev mode.
4. PACK-FIX-2 (code, release-scoped): route `workspace.ts` + `doctor.ts`
   bin discovery through the same resolver so they work outside a checkout.
5. Playwright Chromium is NOT vendored: post-install step
   (`playwright install chromium`) documented in README + surfaced by
   `doctor` (Phase 13 verifies messaging).
6. Artifact = `dist-release/inspector-cli-<ver>-win-x64.zip` (platform-
   tagged due to natives) + SHA256SUMS; install proof runs from an extracted
   copy OUTSIDE the repo with `npm install --omit=dev`.
7. Every code touch in 3-4 carries regression tests (dev-path unchanged;
   built-path covered by a fixture test using compiled output) — gate policy.

Open items deferred to implementation (with shell): esbuild-vs-tsc for the
cli entry (tsc suffices given structure preservation), exact `exports` map,
version stamp injection, upgrade/uninstall semantics (Phases 17-18).

## Config/env surface audit (feeds Phases 13-15; 2026-08-22)

Complete env-var surface (grep-verified, all of `packages/**`):
`INSPECTOR_WORKSPACE` (cli hunt workspace resolution), `INSPECTOR_PTY`,
`INSPECTOR_CLI_PROGRAM` (cli-adapter bin), `WEB_FAULTS`, `WEB_TARGET_URL`
(adapter-web bin), `FAKE_FAULTS` (adapter-fake bin).

Implications: no HOME/global state directory exists — durable state always
lives under the resolved workspace (`.inspector/` inside it), so installed-
artifact tests can isolate fully via `INSPECTOR_WORKSPACE` + temp dirs.
No env override exists for adapter bin discovery (confirms PACK-FIX-1
resolver should key off `import.meta.url` build shape, not a new env knob).

## Phase 19 license inventory — PARTIAL (direct runtime deps, 2026-08-22)

Verified from installed manifests (`node_modules/.pnpm/...`):

| Dependency | Resolved | License |
| --- | --- | --- |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| better-sqlite3 | 11.10.0 | MIT |
| playwright | 1.62.1 | Apache-2.0 |
| @lydell/node-pty | 1.1.0 | MIT |

All permissive; no licensing conflict for RC1. Transitive closure + notice
aggregation still require `pnpm licenses list` / audit under shell (Phase
20-21 remain open).

## Implementation batch (2026-08-22, staged UNCOMMITTED — code-complete, unverified)

All edits made without compiler/shell (ENV-1); LSP producers also fail with
the same root cause. Every changed file was re-read and manually reviewed.
Verification debt lands in the catch-up runbook below.

New files:

- `packages/adapter-sdk/src/bin-resolve.ts` — `pickAdapterBinFile` (pure 3-tier
  layout decision: bundled sibling -> compiled .js -> ts source) +
  `resolveAdapterBin` (adds node command; absolute tsx loader for source picks)
- `packages/adapter-sdk/src/bin-resolve.test.ts` — unit tests for all tiers
  (tmpdir-based, no process spawning)
- `scripts/build-release.mjs` — esbuild bundles 7 entries (cli + 6 adapter
  bins) into `dist-release/bundle/`, externals: better-sqlite3/playwright/
  @lydell/node-pty/ajv/ajv-formats; writes stamped version file, meta
  package.json (`inspector-cli`, bin -> bundle/inspector-cli.js), INSTALL.txt,
  SHA256SUMS.txt, platform zip
- `docs/RELEASE-NOTES-RC1.md` (DRAFT)

Modified:

- 6 adapter indexes now resolve their bin through the shared resolver
  (adapter-fake/-web/-cli/-windows/-android/-electron), replacing hard-wired
  `--import tsx <here>/bin.ts`
- `packages/cli/src/workspace.ts` — adapterSpawn routes through resolver;
  TSX_TSCONFIG_PATH retained for dev alias resolution
- `packages/cli/src/doctor.ts` — fake/electron probes lazy + layout-safe;
  PACKAGE_CONTEXTS anchored to module location instead of repo-root guess
- `packages/cli/src/version.ts` — added installed-artifact candidate
  `bundle/inspector-version.txt` (stamped by build script)
- Manifests (REL-FIX-1): core +4 deps, cli +7, adapter-web +3 (incl. the
  under-reported protocol), finding +store-sqlite, explore +store-sqlite,
  scale +adapter-fake, adapter-fake +adapter-sdk
- Root package.json: devDep esbuild ^0.25.0, script build:release

## Catch-up runbook (execute in THIS order when shell returns)

1. Probe bash. Record versions. Confirm HEAD still `15cda16` on main.
2. Attribution-preserving baseline: `git stash push -u -m "rc1-batch"`
   (tree returns to pristine candidate) -> Phase 4 full gates:
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm
   test && pnpm test:integration`. All must pass BEFORE popping.
3. `git stash pop` -> `pnpm install` (regenerates lockfile for REL-FIX-1 +
   esbuild). Re-run lint/typecheck/unit; fix any fallout from this batch
   only; targeted first: `vitest run packages/adapter-sdk packages/cli`.
4. Full gate again on the batched tree; then `pnpm build:release`.
5. Install proof OUTSIDE the repo (Phase 8-11): unzip to temp, extract,
   `npm install --omit=dev` inside, set INSPECTOR_WORKSPACE to a fresh temp
   dir, run `inspector --version`, `inspector doctor`, one bounded fake hunt,
   findings list, runs resume, kill/cleanup. Record outputs to rc-work logs.
6. Remaining gates per phase list (upgrade/uninstall, reproducibility via
   two fresh builds + SHA compare, security/flake rechecks).
7. Commit scoped waypoint(s) including durable state; NEW candidate SHA =
   post-commit HEAD; Phase 30 final gate on that exact tree; tag
   `v0.1.0-rc.1` only after PASS; push main+tag within recorded authority
   (no npm/GitHub Release).

## Blockers / remedies log

- ENV-1 (OPEN 2026-08-22): Shell/tool bridge failure — every `bash` (plain,
  PTY) and `devcontainer` invocation rejects with
  `The "paths[0]" property must be of type string, got undefined`
  before execution; reproduced identically from fresh subagent contexts.
  ROOT CAUSE (confirmed 2026-08-22): upstream OpenCode Windows bug
  (anomalyco/opencode#17458; duplicates #27789/#38245/#32673/#17415) —
  the built-in bash tool's win32 path handling feeds `undefined` into
  `path.resolve`, producing Node's ERR_INVALID_ARG_TYPE naming `paths[0]`.
  It is compiled into the Bun binary (opencode.exe) — NOT locally patchable.
  Secondary symptom: LSP servers die the same way (`'\\\\?\\C:\\Users\\Michael'
  is not recognized...`) because the space in the project path is unquoted
  by the same layer. Present in installed 1.18.21 (auto-upgraded 2026-08-22
  01:50, still failing after).
  STAGED SELF-HEALING FIX (this session):
  - Recovery shell tool registered at BOTH levels:
    `~/.config/opencode/tool/shim-shell.ts` (pre-existing from earlier
    session, never loaded) and `<repo>/.opencode/tool/shim-shell.ts` (new).
    Registers `shimshell` — in-process child_process.exec with
    stdout/stderr/exit capture; bypasses the broken built-in entirely.
    Load proof marker: `~/.local/share/opencode/ffshim-loaded.log`.
  - Optional dormant plugin override `<config>/plugin/bash-fix.ts` +
    `<repo>/.opencode/plugin/bash-fix.ts` deliberately NOT wired into
    opencode.jsonc (unverified override API vs risk of breaking all plugin
    loading). Escalation path only.
  OPERATOR ACTION REQUIRED: restart the opencode process once (tools are
  registered at process start; hot-load proven impossible in-session).
  THEN: say "resume" — verify `shimshell` exists (or bash works after any
  upstream fix/upgrade) and execute the catch-up runbook below end-to-end.

## Session continuation log

### 2026-08-22 (continuation session, ox-alpha)

- Rehydrated from durable state per AGENTS.md order; resumed RC1_FINALIZATION
  (the campaign the prior session had opened; its chat session ID is not
  recoverable from local history — durable state is authoritative).
- HEAD re-verified without shell by reading `.git/HEAD` +
  `.git/refs/heads/main`: `15cda16421dffec69b988f578f9dba6168e449c6` ==
  authoritative candidate SHA. Branch `main`, on ref (no detached HEAD).
- Working-tree cleanliness vs index NOT yet re-verifiable (needs git);
  carried as part of Phase 4 baseline-gate evidence instead.
- Phase 3 recorded IN FORCE in this file and RELEASE-RC1.yaml
  (`feature_freeze: IN_FORCE`). No feature code will be touched; only
  release-engineering changes are permitted for RC1.
- Phases 5-6 audits completed read-only (results above); Phase 25
  skipped-test audit completed. REL-FIX-1 queued for the first shell-backed
  session, together with Phase 4 gates (order: gates on candidate 15cda16 ->
  apply REL-FIX-1 + lockfile regen -> re-run full gates -> new candidate SHA).
- Phase 7 packaging DRAFT v1 + Phase 19 direct-dep license inventory
  completed read-only (sections above); identified PACK-FIX-1/2 release-
  scoped code items (shared adapter-bin resolver; workspace/doctor path
  decoupling from checkout layout).

## Session continuation log — RC1 resume (blockers closed)

### Reconciliation and blocker-fix session

- Rehydrated per AGENTS.md order. HEAD == origin/main == c338a40 ("progress");
  branch topology clean (local main only; origin/main + origin/HEAD only).
  Working tree clean at start.
- STALE LEDGER RECONCILED: the implementation batch recorded as
  STAGED_UNCOMMITTED is COMMITTED as c338a40. ENV-1 CLOSED — the shell/tool
  bridge works in the current runtime (the old failure was an OpenCode
  Windows bug in the prior harness process). RELEASE-RC1.yaml rewritten to
  reality; candidate_sha advanced to the blocker-fix commit.
- c338a40 AUDITED (Phase 2): bin-resolve 3-tier layout pick preserves dev
  tsx behavior; six adapter indexes + workspace.ts route through it; doctor
  probes lazy/layout-safe; version resolution gains stamped artifact file;
  manifests add previously-undeclared workspace deps (declaration-only);
  lockfile regenerated accordingly; eslint ignores .opencode agent tooling.
  No runtime weakening found — source-tier spawn behavior is byte-equivalent
  to the prior hard-coded path.
- FULL INTEGRATION SUITE on c338a40 (pre-fix baseline): 27 files / 132 tests
  ALL GREEN in this environment. The two recorded blockers are intermittent,
  not deterministic — but were reproduced during targeted rechecks:
  - WEB-K1 reproduced under back-to-back load context (historical evidence
    rc-work/final-integration.log); root cause = racy test construction
    (crash timer 25ms vs act-entry latency). FIXED deterministically;
    product classification code unchanged (K2 discipline already correct).
  - WIN-UIA-PAINT root-caused as Win11 Paint HWND rehost mid-session with
    pid alive. Product fix: bounded single reattach+retry for ROOT-level
    staleness only, pid-liveness gated; element staleness never retried;
    dead targets stay DEAD_WINDOW. New regression file
    windows.stale-window.test.ts (8 cases).
- CLI INTERRUPT/RESUME RACE (Phase 6) REPRODUCED (~1-in-3 full-file runs)
  and ROOT-CAUSED: kill between commitStep(N) and checkpoint write leaves
  checkpoint stepSeq lagging durable steps; resume reused a persisted
  sequence -> UNIQUE(run_id, sequence) failure on re-observation.
  FIXED: Store.maxRunStepSequence() is the authoritative floor for
  RunController step sequencing. Regressions: hardening C5b, store H10b.
  Post-fix: full cli.integration.test.ts green 4x consecutive.
- UNIT LOAD FLAKES (Phase 20 class): worktree.hardening (git ops),
  channel-fuzz (child channels), web.target-url (cold Chromium init)
  exceeded 5s defaults under unbounded fork fan-out. FIXED via calibrated
  unit config (testTimeout 15s, maxForks 6) + explicit 30s initialize
  budget in target-url test. All green isolated AND under load post-fix.
- GENERATED ARTIFACT POLICY (Phase 3): dist-release/ UNTRACKED + gitignored.
  Committing bundles broke `pnpm lint` outright (239 no-undef errors from
  generated JS) — tracked artifacts are anti-policy. Artifacts regenerate
  from the exact tagged SHA; provenance lives here and in release docs.
- Gates after fixes: lint 0 errors (4 pre-existing warnings); typecheck
  exit 0; unit 474 passed / 3 skipped; window-classification + cli +
  real-uia integration green post-fix.

### Finalization session (Phase 21-23)

- Phase 8 (version coherence) DEFECT FOUND AND FIXED during artifact install
  proof: resolveVersion() probed ambient package.json files before the
  stamped version file, so an installed artifact reported the CONSUMER's
  manifest version ('1.0.0'). Stamped inspector-version.txt is now
  authoritative; regression coverage in packages/cli/src/version.test.ts.
- Phase 9 (license truth): repository grants NO license (README explicit);
  generated artifact metadata corrected from false 'MIT' claim to
  UNLICENSED + private. Dependency licenses inventoried: 48 prod packages,
  all permissive, zero copyleft.
- Phase 11-16 proofs from the INSTALLED tarball outside the source tree:
  install 49 prod deps / 0 vulnerabilities; --version coherent; doctor all
  core probes PASS from bundle layout; fake hunt + interrupted-run resume
  (15,674 steps preserved); REAL web hunt against independent Backbone
  TodoMVC via Chromium (120 actions / 29 states / clean shutdown);
  upgrade proof on genuine pre-RC dogfood state (2.4MB runs.db readable,
  CONFIRMED findings shown, new hunt succeeds); uninstall clean with zero
  orphan processes/locks.
- Install-flow defect fixed: folder-form `npm install -g <dir>` skips prod
  dependencies on current npm; builder now emits the npm tarball itself and
  INSTALL.txt prescribes the tarball flow.
- Phase 17: pnpm audit --prod CLEAN (0 known vulnerabilities); dev-toolchain
  findings (vitest/vite/esbuild) reviewed and classified non-blocking.
- Phase 18: CycloneDX 1.6 SBOM generated from the installed tree
  (.inspector/rc-work/rc1-sbom.cdx.json).
- Phase 19 reproducibility QUALIFIED PASS: two independent clean clones @
  frozen lockfile — tarball byte-identical; zip extracted contents identical
  (18/18), archive metadata differs.
- Docs finalized: RELEASE-NOTES-RC1.md (FINAL), STATUS.md, README unchanged
  (already accurate), RC1-RELEASE-MANIFEST.md created.
- Remaining: full exact-SHA gate rerun on this finalization commit, then
  tag v0.1.0-rc.1 at HEAD and push; final state commit records tag_status.
