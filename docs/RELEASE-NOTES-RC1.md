# Inspector RC1 Release Notes

Version: **`0.1.0-rc.1`** (semver pre-release; workspace packages remain
private and unpublished).

Status: **FINAL** — every gate recorded in
`.inspector/state/RC1-RELEASE-MANIFEST.md` ran on the exact tagged commit
(`git rev-list -n 1 v0.1.0-rc.1`). Publication boundary: local artifacts +
annotated git tag only. No npm publish, no GitHub Release, no hosted uploads.

## What RC1 is

First distributable of the Inspector autonomous defect-discovery system:
a Node 22 CLI (`inspector`) plus its adapter subprocesses, installable from a
local artifact. The campaign line that produced it:

- **Implementation M0–M7**: foundation kernel, web sensing/acting, finding +
  reproduction bundles, autonomous exploration, oracle + repair loop in an
  isolated worktree, Android (ADB) and cross-platform adapters (CLI PTY,
  Electron, Windows UIA), scale/unattended operations (durable leases,
  scheduler, resource ledger, model router, clustering, MCP-compatible
  read-only facade, adapter discovery).
- **HARDENING_1**: 66 confirmed-and-closed defects across reliability,
  recovery, correctness, oracle quality, repair safety, concurrency, adapter
  robustness, security boundaries, soak. Zero unresolved Critical/High.
- **DOGFOOD_RC1**: six real independently developed targets hunted unscripted
  (two web TodoMVCs, vim over ConPTY, Calculator + Paint via UIA, Android
  Settings on a headless AVD); independent audit separated true defects from
  noise; clean-install proof from documented instructions only.
- **RC1_FINALIZATION** (this campaign): dependency-declaration hygiene
  (REL-FIX-1), checkout-independent adapter binary resolution (PACK-FIX-1/2),
  artifact definition + packaging + install proofs, and closure of the two
  RC1 completion blockers plus the CLI resume sequence-reuse defect:

  - **WEB-K1** — the pageerror-during-failing-action classification test was
    inherently racy (crash timer 25 ms vs act-entry latency under load);
    made deterministic. The product's attribution discipline was verified
    correct in both directions (K2 pre-window non-attribution retained).
  - **WIN-UIA-PAINT** — Win11 Paint rehosts its top-level HWND mid-session
    while the process stays alive; `RealUiaBackend` now performs exactly one
    bounded reattach+retry for ROOT-level staleness, gated on pid liveness.
    Element-level staleness is never retried; dead targets stay DEAD_WINDOW.
  - **CLI resume sequencing** — a hard kill between step-commit and
    checkpoint left the checkpoint lagging durable steps; resume reused an
    occupied step sequence and failed with UNIQUE(run_id, sequence). Step
    sequencing now floors at `Store.maxRunStepSequence()`.

## Install

From the artifact directory produced by `scripts/build-release.mjs`
(`dist-release/`):

1. `npm pack <artifact-directory>` then
   `npm install -g inspector-cli-<version>.tgz` — the tarball flow is the
   only one that reliably pulls production dependencies (folder-form global
   installs skip them on current npm).
2. For web targets: `npx --yes playwright install chromium`.
3. Verify: `inspector --version` (must print `0.1.0-rc.1`),
   `inspector doctor`.

Native modules (better-sqlite3, @lydell/node-pty) are fetched/compiled by
the install; state always lives under your isolated workspace
(`INSPECTOR_WORKSPACE` or `--workspace`).

## Version coherence

`inspector --version`, the stamped `bundle/inspector-version.txt`, the
generated package metadata, the artifact filename, these notes, and the
`v0.1.0-rc.1` tag all report the same version. Workspace source manifests
remain `0.1.0` / private by design; the shipped version lives in the
packaging definition.

## License truth

The repository grants **no license** (see README "License": no open-source
license selected; all rights reserved). The distribution manifest therefore
declares `license: UNLICENSED` + `private: true`. Dependency licenses are
unaffected: the 48-package production tree is fully permissive (MIT, ISC,
Apache-2.0, BSD-2/3-Clause, MIT-OR-WTFPL); zero copyleft findings.

## Known limitations at RC1

- iOS simulator adapter (M8) is DEFERRED_ENVIRONMENT — interfaces specified,
  no macOS/Xcode runtime was available.
- Windows UIA bridge keeps query-string values in freeform text; uiTree
  `hidden` is always false (no UIA geometry). Redaction is key/URL-scoped.
- Web exploration E2E wall clock is minutes-scale (fresh Chromium per replay).
- Budgets (wall-clock/model-request) are in-memory; artifact-byte accounting
  is post-hoc. Oracle-evaluation provenance IS persisted end-to-end.
- Dev-toolchain audit findings (vitest/vite/esbuild) are documented and
  reviewed; none are runtime dependencies of the artifact
  (`pnpm audit --prod`: zero known vulnerabilities).
- Full debt ledger: `.inspector/state/campaign.yaml`
  (`hardening.deferred_debt`), `docs/DOGFOOD-RC1-REPORT.md`.

## Reproducibility statement

Built twice from independent clean clones of the tagged commit with
`pnpm install --frozen-lockfile`: the npm tarball is byte-identical;
zip archives differ only in archive metadata (extracted contents are
byte-identical across all 18 files). Qualified PASS — see the manifest.
