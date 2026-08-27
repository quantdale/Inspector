# M11 Acceptance Matrix

This matrix is the durable acceptance record for M11. It distinguishes
production-real evidence, deterministic injectable evidence, and environment
deferral. It is updated at each M11 checkpoint; no row is satisfied by a mock
result presented as a real-backend proof.

| Proof | Evidence | Status |
| --- | --- | --- |
| Product chain: hunt → confirmed finding → verify → regression → repair → isolated accepted patch | `packages/cli/src/m11-acceptance.integration.test.ts` (1/1): fake seeded hunt, durable verify/regress, exact detached worktree, pre-patch failure, masking probe, accepted patch, exact replay/regression pass, untouched primary checkout | PASS |
| Verify/regress refusal and durable records | `packages/cli/src/verify-regress.integration.test.ts` (2/2) | PASS |
| Repair provider/policy boundary | `packages/cli/src/repair-cli.integration.test.ts` (2/2); no provider means refusal, test tampering/masking/containment remain enforced by RepairEngine suites | PASS |
| Explicit discovery-only explore and resume metadata | `packages/cli/src/cli.integration.test.ts` explore case and M10 resumable exploration suite | PASS |
| Two-worker campaign, lease ownership, restart-safe idempotency | `packages/cli/src/campaign.integration.test.ts` and `packages/scale/src/campaign.integration.test.ts` | PASS |
| Real PTY full-screen redraw, viewport, cursor, dimensions, resize | `packages/cli-adapter/src/tui-screen.integration.test.ts` (1/1), real `NodePtyBackend` | PASS |
| Electron production binding | `packages/electron-adapter/src/electron-production.integration.test.ts`: real Electron 43.4.1 process launched on the Windows host (lifecycle, renderer inventory/actions, storage/screenshot/trace evidence, target-failure classification, reset, close); refusal path proven when the executable is absent; launch is display-gated so headless hosts defer honestly | PASS (real runtime, Windows host) |
| Electron injectable contract | `packages/electron-adapter/src/electron.conformance.integration.test.ts` (2/2), explicitly forced injectable | PASS (injectable only) |
| Clean distribution | `pnpm release:smoke`: fresh npm prefix runs `--version`, `doctor`, fake hunt, fake **explore**, findings/runs inspection, and `campaign list`; tarball content assertion passes | PASS |
| Linux required CI gate | `.github/workflows/ci.yml`: frozen install, lint, typecheck, unit, deterministic integration (browser provisioning via `pnpm --filter @inspector/adapter-web provision:browser`) | HARDENING_5 certified SUCCESS on run 33034546691 (exact SHA e1e0864: Linux quality 678/211, all 4 lanes green) |
| Windows-sensitive CI gate | `.github/workflows/ci.yml`: real Windows runner path/repair/PTY/CLI/Electron/release smoke + windows-campaign fleet proof | HARDENING_5 certified SUCCESS on run 33034546691 (Windows lane 98394296129 SUCCESS incl. windows-campaign) |
| Electron real-runtime CI proof | `.github/workflows/ci.yml` `electron-real` job: Xvfb-displayed genuine Electron execution of production binding + fleet campaign tests; per-job timeouts on every job | HARDENING_5 certified SUCCESS on run 33034546691 (Electron Xvfb 98395880854 SUCCESS: electron-production + electron-fleet, browser provisioned) |
| iOS real backend | No macOS/Xcode/simulator available | ENVIRONMENT_DEFERRED (M8) |

The local candidate artifact is built with `RELEASE_VERSION=0.1.0-m11.0` for
verification only. Publication, release tagging, GitHub releases, and npm
publishing remain unauthorized and are not part of this matrix.

Local gate evidence (HARDENING_5 final tree `e1e0864` with H5.10 verification-truth, plus state-sync `89bd974`/`0385501`): install --frozen-lockfile OK; lint 0 errors/4 warnings; typecheck PASS; unit **678 passed / 3 skipped across 65 files**, integration **211 passed / 2 skipped across 51 files** (full Linux integration executed, browser provisioned; windows-campaign and verify-regress-truth green), release:smoke PASS from clean installed prefix (including model-runtime and campaign fleet checks). Hosted certification is no longer deferred: all 4 required lanes green on exact pushed SHA `e1e0864` (run 33034546691). The M11 candidate tarball SHA-256 cited below remains a historical checkpoint; HARDENING_5 is the current certified tree.


Historical M11 local gate evidence (re-run on `91411fa`, 2026-08-23): lint
0 errors/4 pre-existing warnings, typecheck PASS, unit 533 passed/3 skipped,
integration **155 passed / 1 skipped across 37 files on the first run** (the
single skip is the executable-absent refusal case that does not apply once
the binary is installed), and installed-artifact smoke PASS (including the
fake `explore` workflow from the installed artifact). The local
candidate tarball SHA-256 is
`2149dc76f09e4409e953270fa6c0481a9500439369ee09c595048765e10963ae`, built
from clean source commit `23a4a27dcff472bd709c3b93b29572ad087564a5`. Earlier
clean candidates (`de577d58…d7126` from `91411fa…c44b`; `a6265950…39001f3`
from `e6f4c78…bc8e3`) remain records of their own checkpoints.
