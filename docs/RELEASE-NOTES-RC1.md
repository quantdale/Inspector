# Inspector RC1 Release Notes (DRAFT)

Status: **DRAFT** — final numbers/SHA are stamped at Phase 30-32 after the
final gate on the release candidate. Do not distribute.

## Version

`0.1.0-rc.1` (semver pre-release; workspace packages remain private).

## What RC1 is

First distributable of the Inspector autonomous defect-discovery system:
a Node 22 CLI (`inspector`) plus its adapter subprocesses, installable from a
local artifact. The campaign line that produced it:

- **Implementation M0-M7**: foundation kernel, web sensing/acting, finding +
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
  artifact definition + packaging + install proofs (Phases 7-12).

## Install

See `INSTALL.txt` in the artifact. Summary:

1. `npm install -g <artifact-dir>` (fetches/compiles native deps:
   better-sqlite3, @lydell/node-pty).
2. For web targets: `npx --yes playwright install chromium`.
3. Verify: `inspector --version`, `inspector doctor`.

## Known limitations at RC1

- iOS simulator adapter (M8) is DEFERRED_ENVIRONMENT — interfaces specified,
  no macOS/Xcode runtime was available.
- Windows UIA bridge keeps query-string values in freeform text; uiTree
  `hidden` is always false (no UIA geometry). Redaction is key/URL-scoped.
- Web exploration E2E wall clock is minutes-scale (fresh Chromium per replay).
- Budgets (wall-clock/model-request) are in-memory; artifact-byte accounting
  is post-hoc. Oracle-evaluation provenance IS persisted end-to-end.
- Full ledger: `.inspector/state/campaign.yaml` (`hardening.deferred_debt`),
  `docs/DOGFOOD-RC1-REPORT.md`.

## Publication boundary

Local artifacts + git tag only. No npm publish, no GitHub Release, no hosted
uploads without explicit operator authorization.
