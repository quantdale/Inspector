# RC1 Release Manifest

Durable provenance for the `v0.1.0-rc.1` release candidate. This file is
committed BEFORE tagging; the tagged commit is by definition the exact
tested candidate (`candidate_sha` below resolves via
`git rev-list -n 1 v0.1.0-rc.1`). Post-tag bookkeeping is limited to the
final state commit recording `tag_status`.

## Identity

| Field | Value |
| --- | --- |
| Release | RC1 |
| Version | 0.1.0-rc.1 |
| Exact Git SHA | see `git rev-list -n 1 v0.1.0-rc.1` (= HEAD when this manifest's commit was gated and tagged) |
| Git tree | clean at gate time; `git status --short` empty except untracked rc-work logs |
| Node | v22.23.2 |
| pnpm | 9.15.9 |
| OS | Windows 11 Pro, MINGW64_NT-10.0-26200 x86_64 (AMD Ryzen 5 7535HS, 12 logical cores) |
| Build command | `pnpm install --frozen-lockfile && pnpm build:release` |

## Artifacts

Produced into `dist-release/` (untracked by policy):

| Artifact | Notes |
| --- | --- |
| `inspector-cli-0.1.0-rc.1.tgz` | npm tarball; **byte-reproducible** across independent clean builds. Content sha256 at final build recorded below. |
| `inspector-cli-0.1.0-rc.1-win32-x64.zip` | zip of bundle+meta+checksums; archive metadata varies per build, extracted contents byte-reproducible (18/18 files identical across two clones). |
| `SHA256SUMS.txt` | covers package.json, INSTALL.txt, 7 bundles + maps, version stamp; verified OK. |
| Tarball sha256 (final) | recorded in `.inspector/rc-work/rc1-final-hashes.txt` at tag time; stable because bundles derive only from `packages/**` sources. |

## Gate results (all on the exact tagged tree)

| Gate | Result | Evidence |
| --- | --- | --- |
| lint | PASS — 0 errors (4 pre-existing warnings) | `pnpm lint` |
| typecheck | PASS — exit 0 | `tsc --noEmit -p tsconfig.json` |
| unit suite | PASS — 474 passed / 3 skipped (39 files); skips are documented Windows symlink privilege gates | `pnpm test` |
| integration suite | PASS — 27 files / 132 tests (~6–7 min wall incl. real Chromium/PTY/UIA/AVD suites) | `pnpm test:integration` |
| security regressions | PASS — hardening wave I security boundaries green in unit+integration (path traversal, worktree escape, device-shell injection, command injection, secret redaction, repair provenance, masking-patch rejection, stale leases, duplicate external effects, artifact integrity) | HARDENING_1 Phase I + suites on candidate |
| dependency audit | PASS/REVIEWED — `pnpm audit --prod`: 0 known vulnerabilities. Dev-toolchain findings (vitest UI critical, vite fs.deny high, esbuild/vite moderates) reviewed: dev-only, not shipped in artifact, not runtime-exploitable; upgrade deferred post-RC1 to protect gate stability | `pnpm audit`, `pnpm audit --prod` |
| packaging | PASS — artifact built from exact candidate; version coherent across CLI stamp/meta/filename/notes/tag | build log + `inspector --version` |
| artifact install | PASS — tarball flow installs 49 prod packages with 0 vulnerabilities; `--version` = 0.1.0-rc.1; folder-form global install documented as unsupported (INSTALL.txt) | install proof session log |
| doctor from artifact | PASS — node/workspace/sqlite/fake/web+Chromium/pty/adb/UIA all PASS; electron WARN-optional; zero checkout-relative probes | `inspector doctor` from consumer dir |
| functional artifact hunt (real web) | PASS — installed CLI hunted independently developed Backbone TodoMVC over real Chromium: 120 actions, 29 states, clean shutdown, durable runs.db (15,955 steps incl. prior fake runs) | proof workspace ws2 |
| interrupted-run resume from artifact | PASS — hard-killed long hunt resumed honestly (re-attach, re-observe, steps preserved) | proof workspace ws2 |
| upgrade path | PASS — genuine pre-RC dogfood state (2.4 MB runs.db, Aug 21) opened by RC1 artifact: runs/findings readable (CONFIRMED PAGE_ERROR finding shown with full detail), new hunt succeeds on same workspace. No migration errors; migrations are forward-only, transactional, idempotent | proof workspace upgrade-ws |
| uninstall/cleanup | PASS — global package removed; no inspector node processes, no orphaned UIA bridge hosts, no mspaint, no stale locks; user evidence untouched | process audit at cleanup |
| config/state/migration audit | PASS — malformed/unsupported config rejected with named errors (CLI integration); fresh/existing/replayed/repeated-startup SQLite covered by store+soak+hardening suites (40 reopen cycles; 24 corruption quarantines in soak); no destructive migration exists | targeted suite reruns on candidate |
| reproducibility | QUALIFIED PASS — two independent clean clones @ frozen lockfile: tarball byte-identical; zip metadata differs, all 18 extracted files byte-identical | clone A/B comparison |
| skipped-test audit | PASS — no unexplained `.skip`/`.only`; 3 unit skips are symlink-privilege-gated; integration skips are environment-conditional real-backend gates | grep audit + vitest output |
| flake audit | PASS/QUALIFIED — WEB-K1 FIXED (deterministic), WIN-UIA-PAINT FIXED (reattach semantics + coverage), CLI EBUSY/race FIXED (sequence floor + bounded cleanup retries), unit load-flakes FIXED (calibrated pool budgets). Residual ENVIRONMENT_GATED: real-backend integration suites require local ADB/emulator/Paint availability; hookTimeout raised once (30s) for cold Chromium spawns | this campaign's evidence |
| license | PASS/REVIEWED — project grants NO license (README; UNLICENSED/private in artifact metadata); 48-package production dep tree fully permissive, zero copyleft | `pnpm licenses list --prod` |
| SBOM | GENERATED — CycloneDX 1.6 JSON from the installed artifact tree (49 components): `.inspector/rc-work/rc1-sbom.cdx.json`. Generated from the install root rather than the workspace because the CycloneDX npm plugin requires an npm lockfile (repo is a pnpm workspace); the installed tree is the shipped dependency closure | SBOM file |
| notices | NOT REQUIRED for distribution — no public distribution is authorized; project reserves all rights; third-party licenses inventoried above and inside installed package metadata | this manifest |

## Known limitations

See `docs/RELEASE-NOTES-RC1.md` ("Known limitations") and
`.inspector/state/campaign.yaml` (`hardening.deferred_debt`).

## Publication boundary

No npm publish, no GitHub Release, no hosted binaries. The release consists
of the annotated git tag plus locally generated artifacts.
