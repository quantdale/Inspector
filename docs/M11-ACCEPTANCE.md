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
| Electron production binding | `packages/electron-adapter/src/electron-production.integration.test.ts`: availability/refusal passes; real-runtime case is skipped because this host has no downloaded Electron executable | ENVIRONMENT_DEFERRED |
| Electron injectable contract | `packages/electron-adapter/src/electron.conformance.integration.test.ts` (2/2), explicitly forced injectable | PASS (injectable only) |
| Clean distribution | `pnpm release:smoke`: fresh npm prefix runs `--version`, `doctor`, fake hunt, findings/runs inspection, and `campaign list`; tarball content assertion passes | PASS |
| Linux required CI gate | `.github/workflows/ci.yml`: frozen install, lint, typecheck, unit, deterministic integration | CONFIGURED |
| Windows-sensitive CI gate | `.github/workflows/ci.yml`: real Windows runner path/repair/PTY/CLI/release smoke jobs | CONFIGURED (hosted-run evidence pending) |
| iOS real backend | No macOS/Xcode/simulator available | ENVIRONMENT_DEFERRED (M8) |

The local candidate artifact is built with `RELEASE_VERSION=0.1.0-m11.0` for
verification only. Publication, release tagging, GitHub releases, and npm
publishing remain unauthorized and are not part of this matrix.
