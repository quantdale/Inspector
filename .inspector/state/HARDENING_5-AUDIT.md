# HARDENING_5 — Every-Tracked-File Audit Census

Mandatory H5.0.4-5 deliverable. Generated mechanically from `git ls-files` on the
HARDENING_5 working tree. Every tracked file has a disposition, enumerated either
individually or via a clearly enumerated homogeneous group whose member paths are
listed below. No file is omitted.

## Exclusions rule

Generated, vendored (node_modules/dist/etc.), and cache artifacts are excluded by rule; the tracked tree contains zero such files (lockfile/dependency-output are gitignored, not tracked).

## Category summary (machine-checkable)

| Category | Count | Disposition |
| --- | ---: | --- |
| agent-tool-config | 8 | R (reviewed) |
| docs | 28 | R (reviewed) |
| dogfood | 8 | R (reviewed) |
| inspector-docs | 10 | R (reviewed) |
| inspector-evidence-logs | 64 | R (reviewed) |
| inspector-other | 40 | R (reviewed) |
| inspector-state-schemas | 5 | R (reviewed) |
| openspec | 7 | R (reviewed) |
| package-manifests | 29 | R (reviewed) |
| package-other | 1 | R (reviewed) |
| package-source | 173 | R (reviewed) |
| package-tests | 114 | R (reviewed) |
| root-config | 9 | R (reviewed) |
| root-docs | 2 | R (reviewed) |
| scripts | 2 | R (reviewed) |
| specs | 27 | R (reviewed) |
| **TOTAL** | **527** | R=527 E=0 |

Invariant check: tracked=527 == reviewed(527) + excluded(0) -> True.

## Enumerated dispositions

Each line: `path | category | code | note`.

| Path | Category | Code | Note |
| --- | --- | --- | --- |
| .agent/EXECUTION_PROMPT.md | agent-tool-config | R | agent/tool/CI config |
| .agent/PLANNER_HANDOFF.md | agent-tool-config | R | agent/tool/CI config |
| .agents/skills/goal/SKILL.md | agent-tool-config | R | agent/tool/CI config |
| .claude/commands/goal.md | agent-tool-config | R | agent/tool/CI config |
| .gitattributes | root-config | R | root config/manifest |
| .github/workflows/ci.yml | agent-tool-config | R | agent/tool/CI config |
| .gitignore | root-config | R | root config/manifest |
| .inspector/ga-work/final-gate-integration.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/final-gate-typecheck.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-resume.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-run.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/interrupt-resume/interrupt-resume-results.jsonl | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/longrun/ga-longrun-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/longrun/ga-longrun.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/longrun/ga-longrun.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/portfolio/emu-boot.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android-portfolio.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/portfolio/ga-android-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/portfolio/ga-android.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android3.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/portfolio/serve-repro.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/serve-repro.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/calc-diag.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/calc-rehost-final.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/uia-soak/calc-rehost-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/calc-rehost.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/cast-autopsy-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/cast-autopsy.ps1 | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/cast-diag-driver.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/cast-matrix-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/cast-matrix.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/ga-uia-soak.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/ga-uia-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/keepontop-debug.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/pick-diag.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/probe-tree.ps1 | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/transition-forensics.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/uia-soak/uia-soak-run.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/debug-run.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/ga-soak-final.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/ga-soak.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/vim-pty/ga-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/vim-pty/orphan-probe.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/vim-pty/soak-run2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/soak-run3.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/web-attribution/ga-web-final.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/hunts/web-attribution/ga-web-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/hunts/web-attribution/ga-web-window-soak.mts | inspector-other | R | durable state asset |
| .inspector/ga-work/native-it.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/p3-installed-artifact/p3-summary.json | inspector-other | R | durable state asset |
| .inspector/ga-work/seed13.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/seed21.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/seed29.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/seed5.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/seed7.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/tools/discovery.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/tools/ga-install-proof.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/tools/ga-metrics.mjs | inspector-other | R | durable state asset |
| .inspector/ga-work/tools/probe-desktop-targets.ps1 | inspector-other | R | durable state asset |
| .inspector/ga-work/w0-typecheck.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w4-typecheck.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w4-unit.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-android.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-android2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-android3.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-android4.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-cli.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-cli2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w5-win.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w7-android.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-cli.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win3.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win4.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win5.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/ga-work/w8-win6.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/policies/default.yaml | inspector-state-schemas | R | durable state schema/ledger |
| .inspector/rc-work/CLEAN-CLONE-AUDIT.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/rc-work/INVENTORY.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/rc-work/audit/FINDING-AUDIT.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/rc-work/audit/METRICS.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/rc-work/baseline.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/c3-gates.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/c3-integration.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/clean-install/PROOF.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/rc-work/cli-integration-batched2.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/cli-integration-isolated.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/cli-integration-pristine.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/cli-race-batched-c.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/cli-race-pristine-b.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/explore-isolated.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/final-integration.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/final-unit.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/fleet-fixed.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/fleet-isolated.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/integration-final.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/nested-verify.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase-batched-integration.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase-batched-unit.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase32-gates.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase32-integration-retry.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase32-integration.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase4-baseline.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase4-integration-failures.txt | inspector-other | R | durable state asset |
| .inspector/rc-work/phase4-integration-retry.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/rc-work/phase4-unit-failures.txt | inspector-other | R | durable state asset |
| .inspector/rc-work/rc1-final-hashes.txt | inspector-other | R | durable state asset |
| .inspector/rc-work/waveb-gates.log | inspector-evidence-logs | R | committed campaign evidence log (prior-campaign checkpoint-reviewed) |
| .inspector/schemas/action.schema.json | inspector-other | R | durable state asset |
| .inspector/schemas/finding.schema.json | inspector-other | R | durable state asset |
| .inspector/schemas/observation.schema.json | inspector-other | R | durable state asset |
| .inspector/state/CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/state/DOGFOOD-RC1.yaml | inspector-state-schemas | R | durable state schema/ledger |
| .inspector/state/GA-READINESS.yaml | inspector-state-schemas | R | durable state schema/ledger |
| .inspector/state/HARDENING-CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/state/RC1-RELEASE-MANIFEST.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/state/README.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/state/RELEASE-CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc |
| .inspector/state/RELEASE-RC1.yaml | inspector-state-schemas | R | durable state schema/ledger |
| .inspector/state/campaign.yaml | inspector-state-schemas | R | durable state schema/ledger |
| .kimi-code/AGENTS.md | agent-tool-config | R | agent/tool/CI config |
| .opencode/commands/goal.md | agent-tool-config | R | agent/tool/CI config |
| .opencode/tool/shim-shell.ts | agent-tool-config | R | agent/tool/CI config |
| AGENTS.md | root-docs | R | root doc |
| README.md | root-docs | R | root doc |
| docs/ADR/0001-playwright-first.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0002-typed-adapter-protocol.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0003-foundation-implementation.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0010-resumable-exploration.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0011-campaign-executor-contract.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0012-campaign-repair-and-source-references.md | docs | R | doc/ADR/spec prose |
| docs/ADR/0013-model-runtime-and-budget-reservation.md | docs | R | doc/ADR/spec prose |
| docs/ARCHITECTURE.md | docs | R | doc/ADR/spec prose |
| docs/AUTONOMOUS-IMPLEMENTATION.md | docs | R | doc/ADR/spec prose |
| docs/AUTONOMY-MODEL.md | docs | R | doc/ADR/spec prose |
| docs/COMPETITIVE-LANDSCAPE.md | docs | R | doc/ADR/spec prose |
| docs/DEVELOPMENT.md | docs | R | doc/ADR/spec prose |
| docs/DOGFOOD-RC1-REPORT.md | docs | R | doc/ADR/spec prose |
| docs/EVIDENCE-MODEL.md | docs | R | doc/ADR/spec prose |
| docs/EXPLORATION-ENGINE.md | docs | R | doc/ADR/spec prose |
| docs/GA-FIELD-VALIDATION-REPORT.md | docs | R | doc/ADR/spec prose |
| docs/HARDENING-CAMPAIGN.md | docs | R | doc/ADR/spec prose |
| docs/M11-ACCEPTANCE.md | docs | R | doc/ADR/spec prose |
| docs/MODEL-ROUTING.md | docs | R | doc/ADR/spec prose |
| docs/OBSERVABILITY.md | docs | R | doc/ADR/spec prose |
| docs/ORACLE-SYSTEM.md | docs | R | doc/ADR/spec prose |
| docs/PLATFORM-ADAPTERS.md | docs | R | doc/ADR/spec prose |
| docs/PRODUCT.md | docs | R | doc/ADR/spec prose |
| docs/RELEASE-NOTES-RC1.md | docs | R | doc/ADR/spec prose |
| docs/ROADMAP.md | docs | R | doc/ADR/spec prose |
| docs/SECURITY-MODEL.md | docs | R | doc/ADR/spec prose |
| docs/STATUS.md | docs | R | doc/ADR/spec prose |
| docs/WAYPOINTS.md | docs | R | doc/ADR/spec prose |
| dogfood/README.md | dogfood | R | repro/dogfood asset |
| dogfood/bin/serve-static.mjs | dogfood | R | repro/dogfood asset |
| dogfood/targets/android-settings.template.yaml | dogfood | R | repro/dogfood asset |
| dogfood/targets/calc-uia.yaml | dogfood | R | repro/dogfood asset |
| dogfood/targets/mspaint-uia.yaml | dogfood | R | repro/dogfood asset |
| dogfood/targets/todomvc-backbone.yaml | dogfood | R | repro/dogfood asset |
| dogfood/targets/todomvc-react.yaml | dogfood | R | repro/dogfood asset |
| dogfood/targets/vim-scratch.yaml | dogfood | R | repro/dogfood asset |
| eslint.config.mjs | root-config | R | root config/manifest |
| openspec/changes/hardening-5-fleet-truth/design.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/proposal.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/specs/audit-certification/spec.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/specs/cross-platform-atomic-writes/spec.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/specs/fleet-execution-truth/spec.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/specs/runtime-efficiency-proof/spec.md | openspec | R | OpenSpec change artifact |
| openspec/changes/hardening-5-fleet-truth/tasks.md | openspec | R | OpenSpec change artifact |
| package.json | root-config | R | root config/manifest |
| packages/adapter-fake/package.json | package-manifests | R | adapter-fake manifest/config |
| packages/adapter-fake/src/bin.ts | package-source | R | adapter-fake runtime source |
| packages/adapter-fake/src/conformance.integration.test.ts | package-tests | R | adapter-fake test/fixture |
| packages/adapter-fake/src/handler.ts | package-source | R | adapter-fake runtime source |
| packages/adapter-fake/src/index.ts | package-source | R | adapter-fake runtime source |
| packages/adapter-fake/src/state-machine.ts | package-source | R | adapter-fake runtime source |
| packages/adapter-sdk/package.json | package-manifests | R | adapter-sdk manifest/config |
| packages/adapter-sdk/src/bin-resolve.test.ts | package-tests | R | adapter-sdk test/fixture |
| packages/adapter-sdk/src/bin-resolve.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/channel-fuzz.test.ts | package-tests | R | adapter-sdk test/fixture |
| packages/adapter-sdk/src/client.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/conformance.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/index.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/jsonrpc.hardening.test.ts | package-tests | R | adapter-sdk test/fixture |
| packages/adapter-sdk/src/jsonrpc.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/redaction.test.ts | package-tests | R | adapter-sdk test/fixture |
| packages/adapter-sdk/src/redaction.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/server.ts | package-source | R | adapter-sdk runtime source |
| packages/adapter-sdk/src/transport.hardening.test.ts | package-tests | R | adapter-sdk test/fixture |
| packages/adapter-web/package.json | package-manifests | R | adapter-web manifest/config |
| packages/adapter-web/src/bin.ts | package-source | R | adapter-web runtime source |
| packages/adapter-web/src/dom-shims.d.ts | package-source | R | adapter-web runtime source |
| packages/adapter-web/src/index.ts | package-source | R | adapter-web runtime source |
| packages/adapter-web/src/seeded-app.ts | package-source | R | adapter-web runtime source |
| packages/adapter-web/src/web-adapter.ts | package-source | R | adapter-web runtime source |
| packages/adapter-web/src/web.conformance.integration.test.ts | package-tests | R | adapter-web test/fixture |
| packages/adapter-web/src/web.create-failure.test.ts | package-tests | R | adapter-web test/fixture |
| packages/adapter-web/src/web.hardening.integration.test.ts | package-tests | R | adapter-web test/fixture |
| packages/adapter-web/src/web.hardening.test.ts | package-tests | R | adapter-web test/fixture |
| packages/adapter-web/src/web.target-url.integration.test.ts | package-tests | R | adapter-web test/fixture |
| packages/adapter-web/src/web.window-classification.integration.test.ts | package-tests | R | adapter-web test/fixture |
| packages/android/package.json | package-manifests | R | android manifest/config |
| packages/android/src/adb-errors.ts | package-source | R | android runtime source |
| packages/android/src/android-adapter.ts | package-source | R | android runtime source |
| packages/android/src/android.conformance.integration.test.ts | package-tests | R | android test/fixture |
| packages/android/src/android.hardening.test.ts | package-tests | R | android test/fixture |
| packages/android/src/android.lifecycle.test.ts | package-tests | R | android test/fixture |
| packages/android/src/android.pidof.test.ts | package-tests | R | android test/fixture |
| packages/android/src/android.real-backend.integration.test.ts | package-tests | R | android test/fixture |
| packages/android/src/bin.ts | package-source | R | android runtime source |
| packages/android/src/index.ts | package-source | R | android runtime source |
| packages/android/src/mock-backend.ts | package-source | R | android runtime source |
| packages/android/src/real-backend.ts | package-source | R | android runtime source |
| packages/android/src/replay.test.ts | package-tests | R | android test/fixture |
| packages/android/src/replay.ts | package-source | R | android runtime source |
| packages/android/src/types.ts | package-source | R | android runtime source |
| packages/android/src/uiautomator.test.ts | package-tests | R | android test/fixture |
| packages/android/src/uiautomator.ts | package-source | R | android runtime source |
| packages/android/tsconfig.json | package-manifests | R | android manifest/config |
| packages/artifact-store/package.json | package-manifests | R | artifact-store manifest/config |
| packages/artifact-store/src/artifact-store.test.ts | package-tests | R | artifact-store test/fixture |
| packages/artifact-store/src/artifact-store.ts | package-source | R | artifact-store runtime source |
| packages/artifact-store/src/hardening.test.ts | package-tests | R | artifact-store test/fixture |
| packages/artifact-store/src/index.ts | package-source | R | artifact-store runtime source |
| packages/artifact-store/src/property.hardening.test.ts | package-tests | R | artifact-store test/fixture |
| packages/artifact-store/src/soak.integration.test.ts | package-tests | R | artifact-store test/fixture |
| packages/cli-adapter/package.json | package-manifests | R | cli-adapter manifest/config |
| packages/cli-adapter/scripts/pty-exit-repro.mjs | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/bin.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/cli-adapter.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/cli.conformance.integration.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/cli.hardening.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/fixtures/fullscreen-tui.mjs | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/index.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/mock-pty.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/node-pty-backend.integration.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/node-pty-backend.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/pty-exit-wedge.integration.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/replay.integration.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/replay.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/tui-screen.integration.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/types.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/src/vt-screen.test.ts | package-tests | R | cli-adapter test/fixture |
| packages/cli-adapter/src/vt-screen.ts | package-source | R | cli-adapter runtime source |
| packages/cli-adapter/tsconfig.json | package-manifests | R | cli-adapter manifest/config |
| packages/cli/package.json | package-manifests | R | cli manifest/config |
| packages/cli/src/args.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/args.ts | package-source | R | cli runtime source |
| packages/cli/src/atomic.ts | package-source | R | cli runtime source |
| packages/cli/src/bin.ts | package-source | R | cli runtime source |
| packages/cli/src/campaign.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/campaign.ts | package-source | R | cli runtime source |
| packages/cli/src/cli.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/cli.ts | package-source | R | cli runtime source |
| packages/cli/src/doctor.ts | package-source | R | cli runtime source |
| packages/cli/src/findings.ts | package-source | R | cli runtime source |
| packages/cli/src/fixtures/m11-repair-provider.cjs | package-source | R | cli runtime source |
| packages/cli/src/help.ts | package-source | R | cli runtime source |
| packages/cli/src/hunt.ts | package-source | R | cli runtime source |
| packages/cli/src/index.ts | package-source | R | cli runtime source |
| packages/cli/src/m11-acceptance.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/models.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/models.ts | package-source | R | cli runtime source |
| packages/cli/src/regress.ts | package-source | R | cli runtime source |
| packages/cli/src/repair-cli.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/repair.ts | package-source | R | cli runtime source |
| packages/cli/src/replay-workflow.ts | package-source | R | cli runtime source |
| packages/cli/src/runs.ts | package-source | R | cli runtime source |
| packages/cli/src/verify-regress.integration.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/verify.ts | package-source | R | cli runtime source |
| packages/cli/src/version.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/version.ts | package-source | R | cli runtime source |
| packages/cli/src/workspace.test.ts | package-tests | R | cli test/fixture |
| packages/cli/src/workspace.ts | package-source | R | cli runtime source |
| packages/cli/tsconfig.json | package-manifests | R | cli manifest/config |
| packages/core/package.json | package-manifests | R | core manifest/config |
| packages/core/src/fixtures/lifecycle-log-adapter.mjs | package-source | R | core runtime source |
| packages/core/src/fixtures/mini-adapter.mjs | package-source | R | core runtime source |
| packages/core/src/fixtures/strict-lifecycle-adapter.mjs | package-source | R | core runtime source |
| packages/core/src/hardening.test.ts | package-tests | R | core test/fixture |
| packages/core/src/index.ts | package-source | R | core runtime source |
| packages/core/src/policy.test.ts | package-tests | R | core test/fixture |
| packages/core/src/policy.ts | package-source | R | core runtime source |
| packages/core/src/run-manager.create-options.integration.test.ts | package-tests | R | core test/fixture |
| packages/core/src/run-manager.integration.test.ts | package-tests | R | core test/fixture |
| packages/core/src/run-manager.ts | package-source | R | core runtime source |
| packages/core/src/validation.ts | package-source | R | core runtime source |
| packages/electron-adapter/package.json | package-manifests | R | electron-adapter manifest/config |
| packages/electron-adapter/src/bin.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/capabilities.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/electron-adapter.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/electron-production.integration.test.ts | package-tests | R | electron-adapter test/fixture |
| packages/electron-adapter/src/electron.conformance.integration.test.ts | package-tests | R | electron-adapter test/fixture |
| packages/electron-adapter/src/electron.hardening.test.ts | package-tests | R | electron-adapter test/fixture |
| packages/electron-adapter/src/fixtures/main.cjs | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/fixtures/renderer.html | package-other | R | electron-adapter other |
| packages/electron-adapter/src/index.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/real-electron.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/src/replay.ts | package-source | R | electron-adapter runtime source |
| packages/electron-adapter/tsconfig.json | package-manifests | R | electron-adapter manifest/config |
| packages/explore/package.json | package-manifests | R | explore manifest/config |
| packages/explore/src/anomaly.ts | package-source | R | explore runtime source |
| packages/explore/src/autonomy.ts | package-source | R | explore runtime source |
| packages/explore/src/campaign.ts | package-source | R | explore runtime source |
| packages/explore/src/checkpoint.ts | package-source | R | explore runtime source |
| packages/explore/src/control.ts | package-source | R | explore runtime source |
| packages/explore/src/explore.hardening.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/explore.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/faults.ts | package-source | R | explore runtime source |
| packages/explore/src/fingerprint-property.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/index.ts | package-source | R | explore runtime source |
| packages/explore/src/inputs.ts | package-source | R | explore runtime source |
| packages/explore/src/inventory.ts | package-source | R | explore runtime source |
| packages/explore/src/model-context.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/model-context.ts | package-source | R | explore runtime source |
| packages/explore/src/model-planner.fuzz.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/model-planner.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/model-planner.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/model-planner.ts | package-source | R | explore runtime source |
| packages/explore/src/native-inventory.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/native-inventory.ts | package-source | R | explore runtime source |
| packages/explore/src/native-session.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/native-session.ts | package-source | R | explore runtime source |
| packages/explore/src/native-vocab.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/planner.ts | package-source | R | explore runtime source |
| packages/explore/src/resumable-exploration.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/resumable-native.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/rng.ts | package-source | R | explore runtime source |
| packages/explore/src/scoring.ts | package-source | R | explore runtime source |
| packages/explore/src/session-memory.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/session-memory.ts | package-source | R | explore runtime source |
| packages/explore/src/state.ts | package-source | R | explore runtime source |
| packages/explore/src/web-replay.target-url.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/web-replay.ts | package-source | R | explore runtime source |
| packages/explore/src/web.explore.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/src/web.generic-dom.integration.test.ts | package-tests | R | explore test/fixture |
| packages/explore/tsconfig.json | package-manifests | R | explore manifest/config |
| packages/finding/package.json | package-manifests | R | finding manifest/config |
| packages/finding/src/drivers.ts | package-source | R | finding runtime source |
| packages/finding/src/engine.ts | package-source | R | finding runtime source |
| packages/finding/src/finding-engine.ts | package-source | R | finding runtime source |
| packages/finding/src/finding.test.ts | package-tests | R | finding test/fixture |
| packages/finding/src/index.ts | package-source | R | finding runtime source |
| packages/finding/src/minimize-property.test.ts | package-tests | R | finding test/fixture |
| packages/finding/src/oracle-automation-failure.test.ts | package-tests | R | finding test/fixture |
| packages/finding/src/oracle-fpfn.hardening.test.ts | package-tests | R | finding test/fixture |
| packages/finding/src/statemachine-matrix.test.ts | package-tests | R | finding test/fixture |
| packages/finding/src/types.ts | package-source | R | finding runtime source |
| packages/model-runtime/package.json | package-manifests | R | model-runtime manifest/config |
| packages/model-runtime/src/index.ts | package-source | R | model-runtime runtime source |
| packages/model-runtime/src/legacy.ts | package-source | R | model-runtime runtime source |
| packages/model-runtime/src/load-module.ts | package-source | R | model-runtime runtime source |
| packages/model-runtime/src/model-runtime.test.ts | package-tests | R | model-runtime test/fixture |
| packages/model-runtime/src/router.ts | package-source | R | model-runtime runtime source |
| packages/model-runtime/src/scripted.ts | package-source | R | model-runtime runtime source |
| packages/model-runtime/src/types.ts | package-source | R | model-runtime runtime source |
| packages/oracle/package.json | package-manifests | R | oracle manifest/config |
| packages/oracle/src/index.ts | package-source | R | oracle runtime source |
| packages/oracle/src/invariant.ts | package-source | R | oracle runtime source |
| packages/oracle/src/oracle.test.ts | package-tests | R | oracle test/fixture |
| packages/oracle/src/semantic.test.ts | package-tests | R | oracle test/fixture |
| packages/oracle/src/semantic.ts | package-source | R | oracle runtime source |
| packages/oracle/src/suite.ts | package-source | R | oracle runtime source |
| packages/oracle/src/suspicion.ts | package-source | R | oracle runtime source |
| packages/oracle/src/types.ts | package-source | R | oracle runtime source |
| packages/oracle/tsconfig.json | package-manifests | R | oracle manifest/config |
| packages/protocol/package.json | package-manifests | R | protocol manifest/config |
| packages/protocol/src/capabilities.ts | package-source | R | protocol runtime source |
| packages/protocol/src/errors.ts | package-source | R | protocol runtime source |
| packages/protocol/src/ids.ts | package-source | R | protocol runtime source |
| packages/protocol/src/index.ts | package-source | R | protocol runtime source |
| packages/protocol/src/messages.ts | package-source | R | protocol runtime source |
| packages/protocol/src/protocol.test.ts | package-tests | R | protocol test/fixture |
| packages/protocol/src/schema.ts | package-source | R | protocol runtime source |
| packages/protocol/src/version.ts | package-source | R | protocol runtime source |
| packages/repair/package.json | package-manifests | R | repair manifest/config |
| packages/repair/src/context.ts | package-source | R | repair runtime source |
| packages/repair/src/dogfood.integration.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/engine.ts | package-source | R | repair runtime source |
| packages/repair/src/index.ts | package-source | R | repair runtime source |
| packages/repair/src/model-patcher.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/model-patcher.ts | package-source | R | repair runtime source |
| packages/repair/src/model-repair.e2e.integration.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/patcher.ts | package-source | R | repair runtime source |
| packages/repair/src/path-policy-property.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/regression.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/regression.ts | package-source | R | repair runtime source |
| packages/repair/src/repair.e2e.integration.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/repair.hardening.integration.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/source-intel.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/source-intel.ts | package-source | R | repair runtime source |
| packages/repair/src/types.ts | package-source | R | repair runtime source |
| packages/repair/src/worktree.hardening.test.ts | package-tests | R | repair test/fixture |
| packages/repair/src/worktree.ts | package-source | R | repair runtime source |
| packages/repair/tsconfig.json | package-manifests | R | repair manifest/config |
| packages/repo-contract/package.json | package-manifests | R | repo-contract manifest/config |
| packages/repo-contract/src/campaign-state.test.ts | package-tests | R | repo-contract test/fixture |
| packages/repo-contract/src/ci-workflow.test.ts | package-tests | R | repo-contract test/fixture |
| packages/repo-contract/src/index.ts | package-source | R | repo-contract runtime source |
| packages/scale/package.json | package-manifests | R | scale manifest/config |
| packages/scale/src/aggregation.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/campaign.integration.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/campaign.ts | package-source | R | scale runtime source |
| packages/scale/src/cluster.ts | package-source | R | scale runtime source |
| packages/scale/src/discovery.ts | package-source | R | scale runtime source |
| packages/scale/src/executor.ts | package-source | R | scale runtime source |
| packages/scale/src/facade.ts | package-source | R | scale runtime source |
| packages/scale/src/fake-executor.ts | package-source | R | scale runtime source |
| packages/scale/src/fleet-harness.ts | package-source | R | scale runtime source |
| packages/scale/src/fleet.integration.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/h2-fleet-hardening.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/index.ts | package-source | R | scale runtime source |
| packages/scale/src/lease-store.ts | package-source | R | scale runtime source |
| packages/scale/src/leases.ts | package-source | R | scale runtime source |
| packages/scale/src/ledger.ts | package-source | R | scale runtime source |
| packages/scale/src/lock.hardening.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/lock.ts | package-source | R | scale runtime source |
| packages/scale/src/manifest.ts | package-source | R | scale runtime source |
| packages/scale/src/model-budget.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/model-budget.ts | package-source | R | scale runtime source |
| packages/scale/src/model-campaign.integration.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/router.ts | package-source | R | scale runtime source |
| packages/scale/src/routing.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/scale.hardening.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/scale.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/settlement.ts | package-source | R | scale runtime source |
| packages/scale/src/soak.integration.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/state-file.hardening.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/state-file.ts | package-source | R | scale runtime source |
| packages/scale/src/state-validation.ts | package-source | R | scale runtime source |
| packages/scale/src/types.ts | package-source | R | scale runtime source |
| packages/scale/src/work-item.test.ts | package-tests | R | scale test/fixture |
| packages/scale/src/work-item.ts | package-source | R | scale runtime source |
| packages/scale/tsconfig.json | package-manifests | R | scale manifest/config |
| packages/store-sqlite/package.json | package-manifests | R | store-sqlite manifest/config |
| packages/store-sqlite/src/index.ts | package-source | R | store-sqlite runtime source |
| packages/store-sqlite/src/migrations.ts | package-source | R | store-sqlite runtime source |
| packages/store-sqlite/src/model-calls.integration.test.ts | package-tests | R | store-sqlite test/fixture |
| packages/store-sqlite/src/soak.integration.test.ts | package-tests | R | store-sqlite test/fixture |
| packages/store-sqlite/src/store.integration.test.ts | package-tests | R | store-sqlite test/fixture |
| packages/store-sqlite/src/store.ts | package-source | R | store-sqlite runtime source |
| packages/windows-adapter/package.json | package-manifests | R | windows-adapter manifest/config |
| packages/windows-adapter/src/backend-selection.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/bin.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/index.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/mock-uia.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/real-uia.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/replay.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/replay.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/selection.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/types.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/uia-bridge.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/windows-adapter.ts | package-source | R | windows-adapter runtime source |
| packages/windows-adapter/src/windows.conformance.integration.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/windows.hardening.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/windows.liveness.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/windows.real-uia.integration.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/windows.rehost.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/src/windows.stale-window.test.ts | package-tests | R | windows-adapter test/fixture |
| packages/windows-adapter/tsconfig.json | package-manifests | R | windows-adapter manifest/config |
| packages/workflows/package.json | package-manifests | R | workflows manifest/config |
| packages/workflows/src/adapter-family-matrix.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/atomic.ts | package-source | R | workflows runtime source |
| packages/workflows/src/campaign-executor.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/campaign-executor.ts | package-source | R | workflows runtime source |
| packages/workflows/src/campaign-pty.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/campaign-restart.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/capabilities.ts | package-source | R | workflows runtime source |
| packages/workflows/src/configs.ts | package-source | R | workflows runtime source |
| packages/workflows/src/electron-fleet.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/electron-hunt.ts | package-source | R | workflows runtime source |
| packages/workflows/src/electron-replay.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/errors.ts | package-source | R | workflows runtime source |
| packages/workflows/src/evidence.ts | package-source | R | workflows runtime source |
| packages/workflows/src/exploration.ts | package-source | R | workflows runtime source |
| packages/workflows/src/fake-hunt.ts | package-source | R | workflows runtime source |
| packages/workflows/src/families.ts | package-source | R | workflows runtime source |
| packages/workflows/src/h2-control.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/index.ts | package-source | R | workflows runtime source |
| packages/workflows/src/meta.ts | package-source | R | workflows runtime source |
| packages/workflows/src/model-support.ts | package-source | R | workflows runtime source |
| packages/workflows/src/native-hunt.ts | package-source | R | workflows runtime source |
| packages/workflows/src/replay-subject.ts | package-source | R | workflows runtime source |
| packages/workflows/src/types.ts | package-source | R | workflows runtime source |
| packages/workflows/src/web-hunt.ts | package-source | R | workflows runtime source |
| packages/workflows/src/windows-campaign.integration.test.ts | package-tests | R | workflows test/fixture |
| packages/workflows/src/workspace.ts | package-source | R | workflows runtime source |
| pnpm-lock.yaml | root-config | R | root config/manifest |
| pnpm-workspace.yaml | root-config | R | root config/manifest |
| scripts/build-release.mjs | scripts | R | build/release script |
| scripts/release-smoke.mjs | scripts | R | build/release script |
| specs/000-foundation/SPEC.md | specs | R | spec artifact |
| specs/000-foundation/TASKS.md | specs | R | spec artifact |
| specs/001-web-adapter/SPEC.md | specs | R | spec artifact |
| specs/001-web-adapter/TASKS.md | specs | R | spec artifact |
| specs/002-finding-reproduction/SPEC.md | specs | R | spec artifact |
| specs/002-finding-reproduction/TASKS.md | specs | R | spec artifact |
| specs/003-autonomous-exploration/SPEC.md | specs | R | spec artifact |
| specs/003-autonomous-exploration/TASKS.md | specs | R | spec artifact |
| specs/004-oracle-repair/SPEC.md | specs | R | spec artifact |
| specs/004-oracle-repair/TASKS.md | specs | R | spec artifact |
| specs/005-android/SPEC.md | specs | R | spec artifact |
| specs/005-android/TASKS.md | specs | R | spec artifact |
| specs/006-cross-platform/SPEC.md | specs | R | spec artifact |
| specs/006-cross-platform/TASKS.md | specs | R | spec artifact |
| specs/007-scale-integrations/SPEC.md | specs | R | spec artifact |
| specs/007-scale-integrations/TASKS.md | specs | R | spec artifact |
| specs/008-ios/SPEC.md | specs | R | spec artifact |
| specs/009-native-autonomous-exploration/SPEC.md | specs | R | spec artifact |
| specs/010-resumable-exploration/SPEC.md | specs | R | spec artifact |
| specs/010-resumable-exploration/TASKS.md | specs | R | spec artifact |
| specs/011-operator-product-workflows/SPEC.md | specs | R | spec artifact |
| specs/011-operator-product-workflows/TASKS.md | specs | R | spec artifact |
| specs/012-real-target-fleet-campaigns/SPEC.md | specs | R | spec artifact |
| specs/012-real-target-fleet-campaigns/TASKS.md | specs | R | spec artifact |
| specs/013-intelligence-guided-autonomy/SPEC.md | specs | R | spec artifact |
| specs/013-intelligence-guided-autonomy/TASKS.md | specs | R | spec artifact |
| specs/README.md | specs | R | spec artifact |
| tsconfig.json | root-config | R | root config/manifest |
| vitest.config.ts | root-config | R | root config/manifest |
| vitest.integration.config.ts | root-config | R | root config/manifest |

## Reconciliation

- tracked (git ls-files): 527
- reviewed (R): 527
- excluded (E): 0
- R + E = 527 == tracked 527: True

## System maps (referenced)

- Adapter family contract: `packages/workflows/src/families.ts` (FAMILY_CONTRACT, exhaustive over @inspector/scale AdapterFamily).
- Workflow fleet truth resolution: `packages/workflows/src/workspace.ts`, `exploration.ts`, `campaign-executor.ts`, `replay-subject.ts`.
- Electron durable lane: `packages/electron-adapter/src/{index,replay}.ts`.
- Windows/UIA durable lane: `packages/windows-adapter/src/{index,replay,mock-uia,real-uia,native-hunt}.ts`.
- Durable control-plane state: `packages/core/src/{state,run-manager}.ts`, `packages/workflows/src/meta.ts`.
- Replay routing: `packages/workflows/src/replay-subject.ts` (REPLAY_DRIVER_FACTORIES / REPLAY_SUPPORTED_DURABLE_ADAPTERS).
