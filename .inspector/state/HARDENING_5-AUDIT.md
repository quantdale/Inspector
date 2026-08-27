# HARDENING_5 — Every-Tracked-File Audit Census

Mandatory H5.0.4-5 deliverable. Generated mechanically from `git ls-files` on the
HARDENING_5 working tree. Every tracked file has a disposition, enumerated either
individually or via a clearly enumerated homogeneous group whose member paths are
listed below. No file is omitted.

## Exclusions rule

Generated, vendored (node_modules/dist/etc.), and cache artifacts are excluded by rule; the tracked tree contains zero such files. Tracked manifests and lockfiles (including pnpm-lock.yaml, package.json, workspace configs) ARE authored dependency/configuration surfaces and are inventoried/reviewed as R, not excluded.

## Category summary (machine-checkable)

| Category | Count | Disposition |
| --- | ---: | --- |
| agent-tool-config | 8 | R (reviewed) |
| docs | 28 | R (reviewed) |
| dogfood | 8 | R (reviewed) |
| inspector-docs | 11 | R (reviewed) |
| inspector-evidence-logs | 64 | R (reviewed) |
| inspector-other | 40 | R (reviewed) |
| inspector-state-schemas | 5 | R (reviewed) |
| openspec | 11 | R (reviewed) |
| package-manifests | 29 | R (reviewed) |
| package-other | 1 | R (reviewed) |
| package-source | 173 | R (reviewed) |
| package-tests | 114 | R (reviewed) |
| root-config | 8 | R (reviewed) |
| root-docs | 2 | R (reviewed) |
| root-lockfile | 1 | R (reviewed) |
| scripts | 4 | R (reviewed) |
| specs | 27 | R (reviewed) |
| **TOTAL** | **534** | R=534 E=0 |

Invariant check: tracked=534 == reviewed(534) + excluded(0) -> True.

## Enumerated dispositions

Each line: `path | category | code | note`.

| Path | Category | Code | Note |
| --- | --- | --- | --- |
| .agent/EXECUTION_PROMPT.md | agent-tool-config | R | agent/tool/CI config — blob:91950c14268a |
| .agent/PLANNER_HANDOFF.md | agent-tool-config | R | agent/tool/CI config — blob:9242086fe0b1 |
| .agents/skills/goal/SKILL.md | agent-tool-config | R | agent/tool/CI config — blob:8e603f89aae3 |
| .claude/commands/goal.md | agent-tool-config | R | agent/tool/CI config — blob:7c2e5bff7cc8 |
| .gitattributes | root-config | R | root config/manifest — blob:f3f7762fb783 |
| .github/workflows/ci.yml | agent-tool-config | R | agent/tool/CI config — blob:f875fae1528f |
| .gitignore | root-config | R | root config/manifest — blob:1806e67b7302 |
| .inspector/ga-work/final-gate-integration.log | inspector-evidence-logs | R | campaign evidence log — blob:d5f97e3c6ad9 (checkpoint-reviewed) |
| .inspector/ga-work/final-gate-typecheck.log | inspector-evidence-logs | R | campaign evidence log — blob:f1184852bc43 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-resume.mjs | inspector-other | R | durable state asset — blob:ad7f339c4641 |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-run.log | inspector-evidence-logs | R | campaign evidence log — blob:7690e3f3e3a4 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-summary.json | inspector-other | R | durable state asset — blob:b690e2b5a701 |
| .inspector/ga-work/hunts/interrupt-resume/interrupt-resume-results.jsonl | inspector-other | R | durable state asset — blob:5666221e5c5f |
| .inspector/ga-work/hunts/longrun/ga-longrun-summary.json | inspector-other | R | durable state asset — blob:0a539175a5c6 |
| .inspector/ga-work/hunts/longrun/ga-longrun.log | inspector-evidence-logs | R | campaign evidence log — blob:4adf609a54c1 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/longrun/ga-longrun.mjs | inspector-other | R | durable state asset — blob:f47c0ffc3920 |
| .inspector/ga-work/hunts/portfolio/emu-boot.log | inspector-evidence-logs | R | campaign evidence log — blob:a03b5cf2c97b (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android-portfolio.mjs | inspector-other | R | durable state asset — blob:3d44c92cb7c0 |
| .inspector/ga-work/hunts/portfolio/ga-android-summary.json | inspector-other | R | durable state asset — blob:2d7ed9524590 |
| .inspector/ga-work/hunts/portfolio/ga-android.log | inspector-evidence-logs | R | campaign evidence log — blob:3cd79e810fe8 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android2.log | inspector-evidence-logs | R | campaign evidence log — blob:df286c80008f (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-android3.log | inspector-evidence-logs | R | campaign evidence log — blob:09dea9b76778 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.json | inspector-other | R | durable state asset — blob:0ce3eee38e57 |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.log | inspector-evidence-logs | R | campaign evidence log — blob:7a1850dbc4bc (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/ga-web-portfolio.mjs | inspector-other | R | durable state asset — blob:d6e55d552008 |
| .inspector/ga-work/hunts/portfolio/serve-repro.log | inspector-evidence-logs | R | campaign evidence log — blob:8ce0eacb7b6c (checkpoint-reviewed) |
| .inspector/ga-work/hunts/portfolio/serve-repro.mjs | inspector-other | R | durable state asset — blob:2998d39c1a6a |
| .inspector/ga-work/hunts/uia-soak/calc-diag.mts | inspector-other | R | durable state asset — blob:9ea266457c37 |
| .inspector/ga-work/hunts/uia-soak/calc-rehost-final.log | inspector-evidence-logs | R | campaign evidence log — blob:697135746d41 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/uia-soak/calc-rehost-summary.json | inspector-other | R | durable state asset — blob:4f2a728c163c |
| .inspector/ga-work/hunts/uia-soak/calc-rehost.mts | inspector-other | R | durable state asset — blob:c13bfa1531a4 |
| .inspector/ga-work/hunts/uia-soak/cast-autopsy-summary.json | inspector-other | R | durable state asset — blob:8c3335a2382d |
| .inspector/ga-work/hunts/uia-soak/cast-autopsy.ps1 | inspector-other | R | durable state asset — blob:0bbf92b80110 |
| .inspector/ga-work/hunts/uia-soak/cast-diag-driver.mts | inspector-other | R | durable state asset — blob:87e325b46745 |
| .inspector/ga-work/hunts/uia-soak/cast-matrix-summary.json | inspector-other | R | durable state asset — blob:770455e2ed46 |
| .inspector/ga-work/hunts/uia-soak/cast-matrix.mts | inspector-other | R | durable state asset — blob:6e60c82ca7ed |
| .inspector/ga-work/hunts/uia-soak/ga-uia-soak.mts | inspector-other | R | durable state asset — blob:1eeaccb672d1 |
| .inspector/ga-work/hunts/uia-soak/ga-uia-summary.json | inspector-other | R | durable state asset — blob:a18e4f375942 |
| .inspector/ga-work/hunts/uia-soak/keepontop-debug.mts | inspector-other | R | durable state asset — blob:1e3e7483859d |
| .inspector/ga-work/hunts/uia-soak/pick-diag.mts | inspector-other | R | durable state asset — blob:0eb752789c58 |
| .inspector/ga-work/hunts/uia-soak/probe-tree.ps1 | inspector-other | R | durable state asset — blob:47dd3db543ff |
| .inspector/ga-work/hunts/uia-soak/transition-forensics.mts | inspector-other | R | durable state asset — blob:e4f9bfafe426 |
| .inspector/ga-work/hunts/uia-soak/uia-soak-run.log | inspector-evidence-logs | R | campaign evidence log — blob:d0a8be761b74 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/debug-run.log | inspector-evidence-logs | R | campaign evidence log — blob:e69de29bb2d1 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/ga-soak-final.log | inspector-evidence-logs | R | campaign evidence log — blob:e69de29bb2d1 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/ga-soak.mjs | inspector-other | R | durable state asset — blob:2371040438a9 |
| .inspector/ga-work/hunts/vim-pty/ga-summary.json | inspector-other | R | durable state asset — blob:2ccede646c8f |
| .inspector/ga-work/hunts/vim-pty/orphan-probe.mjs | inspector-other | R | durable state asset — blob:a1452d333e16 |
| .inspector/ga-work/hunts/vim-pty/soak-run2.log | inspector-evidence-logs | R | campaign evidence log — blob:245cd64a532a (checkpoint-reviewed) |
| .inspector/ga-work/hunts/vim-pty/soak-run3.log | inspector-evidence-logs | R | campaign evidence log — blob:8a8d451415a9 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/web-attribution/ga-web-final.log | inspector-evidence-logs | R | campaign evidence log — blob:dfaa0374f656 (checkpoint-reviewed) |
| .inspector/ga-work/hunts/web-attribution/ga-web-summary.json | inspector-other | R | durable state asset — blob:913caca4e1b8 |
| .inspector/ga-work/hunts/web-attribution/ga-web-window-soak.mts | inspector-other | R | durable state asset — blob:bd466414d35d |
| .inspector/ga-work/native-it.log | inspector-evidence-logs | R | campaign evidence log — blob:6aecefa72737 (checkpoint-reviewed) |
| .inspector/ga-work/p3-installed-artifact/p3-summary.json | inspector-other | R | durable state asset — blob:50d329775246 |
| .inspector/ga-work/seed13.log | inspector-evidence-logs | R | campaign evidence log — blob:22c430dc5b26 (checkpoint-reviewed) |
| .inspector/ga-work/seed21.log | inspector-evidence-logs | R | campaign evidence log — blob:8ec77aad98a5 (checkpoint-reviewed) |
| .inspector/ga-work/seed29.log | inspector-evidence-logs | R | campaign evidence log — blob:f85597489b86 (checkpoint-reviewed) |
| .inspector/ga-work/seed5.log | inspector-evidence-logs | R | campaign evidence log — blob:f466d674072b (checkpoint-reviewed) |
| .inspector/ga-work/seed7.log | inspector-evidence-logs | R | campaign evidence log — blob:71adb54eb6c8 (checkpoint-reviewed) |
| .inspector/ga-work/tools/discovery.mjs | inspector-other | R | durable state asset — blob:4393f345cc7a |
| .inspector/ga-work/tools/ga-install-proof.mjs | inspector-other | R | durable state asset — blob:18e284f06002 |
| .inspector/ga-work/tools/ga-metrics.mjs | inspector-other | R | durable state asset — blob:3927d7e44704 |
| .inspector/ga-work/tools/probe-desktop-targets.ps1 | inspector-other | R | durable state asset — blob:20e777688136 |
| .inspector/ga-work/w0-typecheck.log | inspector-evidence-logs | R | campaign evidence log — blob:f1184852bc43 (checkpoint-reviewed) |
| .inspector/ga-work/w4-typecheck.log | inspector-evidence-logs | R | campaign evidence log — blob:ba3a35a86379 (checkpoint-reviewed) |
| .inspector/ga-work/w4-unit.log | inspector-evidence-logs | R | campaign evidence log — blob:4ef7155e8185 (checkpoint-reviewed) |
| .inspector/ga-work/w5-android.log | inspector-evidence-logs | R | campaign evidence log — blob:d08ee6bb196d (checkpoint-reviewed) |
| .inspector/ga-work/w5-android2.log | inspector-evidence-logs | R | campaign evidence log — blob:7b4722811518 (checkpoint-reviewed) |
| .inspector/ga-work/w5-android3.log | inspector-evidence-logs | R | campaign evidence log — blob:6f37181f6536 (checkpoint-reviewed) |
| .inspector/ga-work/w5-android4.log | inspector-evidence-logs | R | campaign evidence log — blob:90d2b0df8d2a (checkpoint-reviewed) |
| .inspector/ga-work/w5-cli.log | inspector-evidence-logs | R | campaign evidence log — blob:c3f4d1ed9073 (checkpoint-reviewed) |
| .inspector/ga-work/w5-cli2.log | inspector-evidence-logs | R | campaign evidence log — blob:2769f734a9af (checkpoint-reviewed) |
| .inspector/ga-work/w5-win.log | inspector-evidence-logs | R | campaign evidence log — blob:10c811501a26 (checkpoint-reviewed) |
| .inspector/ga-work/w7-android.log | inspector-evidence-logs | R | campaign evidence log — blob:2f0b0175d8f5 (checkpoint-reviewed) |
| .inspector/ga-work/w8-cli.log | inspector-evidence-logs | R | campaign evidence log — blob:e9c4c495255d (checkpoint-reviewed) |
| .inspector/ga-work/w8-win.log | inspector-evidence-logs | R | campaign evidence log — blob:7cf8cbda9b12 (checkpoint-reviewed) |
| .inspector/ga-work/w8-win2.log | inspector-evidence-logs | R | campaign evidence log — blob:0c94c2a090f0 (checkpoint-reviewed) |
| .inspector/ga-work/w8-win3.log | inspector-evidence-logs | R | campaign evidence log — blob:46fd3ff0418f (checkpoint-reviewed) |
| .inspector/ga-work/w8-win4.log | inspector-evidence-logs | R | campaign evidence log — blob:f28e7b1921c1 (checkpoint-reviewed) |
| .inspector/ga-work/w8-win5.log | inspector-evidence-logs | R | campaign evidence log — blob:90d514618877 (checkpoint-reviewed) |
| .inspector/ga-work/w8-win6.log | inspector-evidence-logs | R | campaign evidence log — blob:83b1faf96129 (checkpoint-reviewed) |
| .inspector/policies/default.yaml | inspector-state-schemas | R | durable state schema/ledger — blob:5d55a7f8ec29 |
| .inspector/rc-work/CLEAN-CLONE-AUDIT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:fb3baf1823f6 |
| .inspector/rc-work/INVENTORY.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:1c648c907741 |
| .inspector/rc-work/audit/FINDING-AUDIT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:c7b9642100c7 |
| .inspector/rc-work/audit/METRICS.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:fde9bcf0364d |
| .inspector/rc-work/baseline.log | inspector-evidence-logs | R | campaign evidence log — blob:996c68c3c5a0 (checkpoint-reviewed) |
| .inspector/rc-work/c3-gates.log | inspector-evidence-logs | R | campaign evidence log — blob:7a02e92866e7 (checkpoint-reviewed) |
| .inspector/rc-work/c3-integration.log | inspector-evidence-logs | R | campaign evidence log — blob:667d885d8f16 (checkpoint-reviewed) |
| .inspector/rc-work/clean-install/PROOF.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:236aded896af |
| .inspector/rc-work/cli-integration-batched2.log | inspector-evidence-logs | R | campaign evidence log — blob:fc0764d8f083 (checkpoint-reviewed) |
| .inspector/rc-work/cli-integration-isolated.log | inspector-evidence-logs | R | campaign evidence log — blob:a6afcb2eed56 (checkpoint-reviewed) |
| .inspector/rc-work/cli-integration-pristine.log | inspector-evidence-logs | R | campaign evidence log — blob:d4936655425e (checkpoint-reviewed) |
| .inspector/rc-work/cli-race-batched-c.log | inspector-evidence-logs | R | campaign evidence log — blob:be55753c05ba (checkpoint-reviewed) |
| .inspector/rc-work/cli-race-pristine-b.log | inspector-evidence-logs | R | campaign evidence log — blob:719099aba4b0 (checkpoint-reviewed) |
| .inspector/rc-work/explore-isolated.log | inspector-evidence-logs | R | campaign evidence log — blob:37b9e39103ae (checkpoint-reviewed) |
| .inspector/rc-work/final-integration.log | inspector-evidence-logs | R | campaign evidence log — blob:a16387e9c7fa (checkpoint-reviewed) |
| .inspector/rc-work/final-unit.log | inspector-evidence-logs | R | campaign evidence log — blob:2d1ee8460148 (checkpoint-reviewed) |
| .inspector/rc-work/fleet-fixed.log | inspector-evidence-logs | R | campaign evidence log — blob:32e3d438535f (checkpoint-reviewed) |
| .inspector/rc-work/fleet-isolated.log | inspector-evidence-logs | R | campaign evidence log — blob:d8d624435984 (checkpoint-reviewed) |
| .inspector/rc-work/integration-final.log | inspector-evidence-logs | R | campaign evidence log — blob:50bb40dcea9d (checkpoint-reviewed) |
| .inspector/rc-work/nested-verify.log | inspector-evidence-logs | R | campaign evidence log — blob:6251d0323c6c (checkpoint-reviewed) |
| .inspector/rc-work/phase-batched-integration.log | inspector-evidence-logs | R | campaign evidence log — blob:f104d37288db (checkpoint-reviewed) |
| .inspector/rc-work/phase-batched-unit.log | inspector-evidence-logs | R | campaign evidence log — blob:26393d4e4aa2 (checkpoint-reviewed) |
| .inspector/rc-work/phase32-gates.log | inspector-evidence-logs | R | campaign evidence log — blob:a70cab5757d4 (checkpoint-reviewed) |
| .inspector/rc-work/phase32-integration-retry.log | inspector-evidence-logs | R | campaign evidence log — blob:92d6e3c186c4 (checkpoint-reviewed) |
| .inspector/rc-work/phase32-integration.log | inspector-evidence-logs | R | campaign evidence log — blob:39cba4e040e2 (checkpoint-reviewed) |
| .inspector/rc-work/phase4-baseline.log | inspector-evidence-logs | R | campaign evidence log — blob:17c5e2c94643 (checkpoint-reviewed) |
| .inspector/rc-work/phase4-integration-failures.txt | inspector-other | R | durable state asset — blob:feb506392ac8 |
| .inspector/rc-work/phase4-integration-retry.log | inspector-evidence-logs | R | campaign evidence log — blob:ae4caf4fca3f (checkpoint-reviewed) |
| .inspector/rc-work/phase4-unit-failures.txt | inspector-other | R | durable state asset — blob:4c8f1a3d337c |
| .inspector/rc-work/rc1-final-hashes.txt | inspector-other | R | durable state asset — blob:a629d14d026e |
| .inspector/rc-work/waveb-gates.log | inspector-evidence-logs | R | campaign evidence log — blob:12d9399cb076 (checkpoint-reviewed) |
| .inspector/schemas/action.schema.json | inspector-other | R | durable state asset — blob:6ec2f1aeca2f |
| .inspector/schemas/finding.schema.json | inspector-other | R | durable state asset — blob:18c9087996ce |
| .inspector/schemas/observation.schema.json | inspector-other | R | durable state asset — blob:2423fc3b4113 |
| .inspector/state/CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:124e769e3253 |
| .inspector/state/DOGFOOD-RC1.yaml | inspector-state-schemas | R | durable state schema/ledger — blob:77441d117f79 |
| .inspector/state/GA-READINESS.yaml | inspector-state-schemas | R | durable state schema/ledger — blob:609fa35287a3 |
| .inspector/state/HARDENING-CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:9b5ba9a2a01c |
| .inspector/state/HARDENING_5-AUDIT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:d0082f7aa3b4 |
| .inspector/state/RC1-RELEASE-MANIFEST.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:f2b2b91a562a |
| .inspector/state/README.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:a6f5b6c39c2e |
| .inspector/state/RELEASE-CHECKPOINT.md | inspector-docs | R | campaign checkpoint/ledger doc — blob:813c08760d52 |
| .inspector/state/RELEASE-RC1.yaml | inspector-state-schemas | R | durable state schema/ledger — blob:bc232f2fad6c |
| .inspector/state/campaign.yaml | inspector-state-schemas | R | durable state schema/ledger — blob:ba7199409655 |
| .kimi-code/AGENTS.md | agent-tool-config | R | agent/tool/CI config — blob:e26bffb93845 |
| .opencode/commands/goal.md | agent-tool-config | R | agent/tool/CI config — blob:e1350592830c |
| .opencode/tool/shim-shell.ts | agent-tool-config | R | agent/tool/CI config — blob:6685e2f76666 |
| AGENTS.md | root-docs | R | root doc — blob:23e280ee9160 |
| README.md | root-docs | R | root doc — blob:4f70273977de |
| docs/ADR/0001-playwright-first.md | docs | R | doc/ADR/spec prose — blob:6e11fd7a9b77 |
| docs/ADR/0002-typed-adapter-protocol.md | docs | R | doc/ADR/spec prose — blob:750f43e4f268 |
| docs/ADR/0003-foundation-implementation.md | docs | R | doc/ADR/spec prose — blob:c2747a881b8d |
| docs/ADR/0010-resumable-exploration.md | docs | R | doc/ADR/spec prose — blob:5b97fad2864d |
| docs/ADR/0011-campaign-executor-contract.md | docs | R | doc/ADR/spec prose — blob:2688a2912dd9 |
| docs/ADR/0012-campaign-repair-and-source-references.md | docs | R | doc/ADR/spec prose — blob:38306936a199 |
| docs/ADR/0013-model-runtime-and-budget-reservation.md | docs | R | doc/ADR/spec prose — blob:3807fe52719b |
| docs/ARCHITECTURE.md | docs | R | doc/ADR/spec prose — blob:f42d49b94833 |
| docs/AUTONOMOUS-IMPLEMENTATION.md | docs | R | doc/ADR/spec prose — blob:711b2abbf52d |
| docs/AUTONOMY-MODEL.md | docs | R | doc/ADR/spec prose — blob:32917aaafba1 |
| docs/COMPETITIVE-LANDSCAPE.md | docs | R | doc/ADR/spec prose — blob:8de8cda7772c |
| docs/DEVELOPMENT.md | docs | R | doc/ADR/spec prose — blob:ea1dfc96d897 |
| docs/DOGFOOD-RC1-REPORT.md | docs | R | doc/ADR/spec prose — blob:d16566d25864 |
| docs/EVIDENCE-MODEL.md | docs | R | doc/ADR/spec prose — blob:67f44a0fe0b1 |
| docs/EXPLORATION-ENGINE.md | docs | R | doc/ADR/spec prose — blob:5afd21c79633 |
| docs/GA-FIELD-VALIDATION-REPORT.md | docs | R | doc/ADR/spec prose — blob:fd2237d33765 |
| docs/HARDENING-CAMPAIGN.md | docs | R | doc/ADR/spec prose — blob:45e7f09eaa4d |
| docs/M11-ACCEPTANCE.md | docs | R | doc/ADR/spec prose — blob:bfab7b9285ec |
| docs/MODEL-ROUTING.md | docs | R | doc/ADR/spec prose — blob:44167520ee5c |
| docs/OBSERVABILITY.md | docs | R | doc/ADR/spec prose — blob:8c34193bac55 |
| docs/ORACLE-SYSTEM.md | docs | R | doc/ADR/spec prose — blob:cb21e6356f31 |
| docs/PLATFORM-ADAPTERS.md | docs | R | doc/ADR/spec prose — blob:a4f323d03550 |
| docs/PRODUCT.md | docs | R | doc/ADR/spec prose — blob:2d84bf063f8a |
| docs/RELEASE-NOTES-RC1.md | docs | R | doc/ADR/spec prose — blob:4e487737e436 |
| docs/ROADMAP.md | docs | R | doc/ADR/spec prose — blob:5389d9eef6fb |
| docs/SECURITY-MODEL.md | docs | R | doc/ADR/spec prose — blob:9d44e3b05303 |
| docs/STATUS.md | docs | R | doc/ADR/spec prose — blob:95c132909de5 |
| docs/WAYPOINTS.md | docs | R | doc/ADR/spec prose — blob:04df8561bbbe |
| dogfood/README.md | dogfood | R | repro/dogfood asset — blob:30391846502c |
| dogfood/bin/serve-static.mjs | dogfood | R | repro/dogfood asset — blob:c7b8cd6ee848 |
| dogfood/targets/android-settings.template.yaml | dogfood | R | repro/dogfood asset — blob:fa711ed319f2 |
| dogfood/targets/calc-uia.yaml | dogfood | R | repro/dogfood asset — blob:3100a0c7b506 |
| dogfood/targets/mspaint-uia.yaml | dogfood | R | repro/dogfood asset — blob:9243c4d0c14e |
| dogfood/targets/todomvc-backbone.yaml | dogfood | R | repro/dogfood asset — blob:9c9cb14cb532 |
| dogfood/targets/todomvc-react.yaml | dogfood | R | repro/dogfood asset — blob:37a51de666a0 |
| dogfood/targets/vim-scratch.yaml | dogfood | R | repro/dogfood asset — blob:b91ea5449822 |
| eslint.config.mjs | root-config | R | root config/manifest — blob:a3e69a1d4477 |
| openspec/changes/hardening-5-fleet-truth/AUDIT-ADDENDUM.md | openspec | R | OpenSpec change artifact — blob:0dfc429929a3 |
| openspec/changes/hardening-5-fleet-truth/design.md | openspec | R | OpenSpec change artifact — blob:d3182049d387 |
| openspec/changes/hardening-5-fleet-truth/proposal.md | openspec | R | OpenSpec change artifact — blob:a4e328eb6f86 |
| openspec/changes/hardening-5-fleet-truth/specs/audit-certification/spec.md | openspec | R | OpenSpec change artifact — blob:7b05e3e886f9 |
| openspec/changes/hardening-5-fleet-truth/specs/cross-platform-atomic-writes/spec.md | openspec | R | OpenSpec change artifact — blob:6a60a3e794a4 |
| openspec/changes/hardening-5-fleet-truth/specs/durable-history-integrity/spec.md | openspec | R | OpenSpec change artifact — blob:b919ac16d2b7 |
| openspec/changes/hardening-5-fleet-truth/specs/fleet-execution-truth/spec.md | openspec | R | OpenSpec change artifact — blob:6a73ca562803 |
| openspec/changes/hardening-5-fleet-truth/specs/replay-backend-provenance/spec.md | openspec | R | OpenSpec change artifact — blob:ecdf94e25dfe |
| openspec/changes/hardening-5-fleet-truth/specs/runtime-efficiency-proof/spec.md | openspec | R | OpenSpec change artifact — blob:72bb425d1aad |
| openspec/changes/hardening-5-fleet-truth/specs/verification-outcome-truth/spec.md | openspec | R | OpenSpec change artifact — blob:08cdb90634aa |
| openspec/changes/hardening-5-fleet-truth/tasks.md | openspec | R | OpenSpec change artifact — blob:2bc5c9726b8a |
| package.json | root-config | R | root config/manifest — blob:c183b8bf8102 |
| packages/adapter-fake/package.json | package-manifests | R | adapter-fake manifest/config — blob:76f8d7653ed2 — dependency resolution input |
| packages/adapter-fake/src/bin.ts | package-source | R | adapter-fake runtime source — blob:c96497622755 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-fake/src/conformance.integration.test.ts | package-tests | R | adapter-fake test/fixture — blob:0e40664662e5 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-fake/src/handler.ts | package-source | R | adapter-fake runtime source — blob:8d94b0e61f24 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-fake/src/index.ts | package-source | R | adapter-fake runtime source — blob:34fe53860bf3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-fake/src/state-machine.ts | package-source | R | adapter-fake runtime source — blob:9870ff9bb5fb — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/package.json | package-manifests | R | adapter-sdk manifest/config — blob:0d08c5dab5be — dependency resolution input |
| packages/adapter-sdk/src/bin-resolve.test.ts | package-tests | R | adapter-sdk test/fixture — blob:41105dd682fc — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-sdk/src/bin-resolve.ts | package-source | R | adapter-sdk runtime source — blob:74bceac27eee — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/channel-fuzz.test.ts | package-tests | R | adapter-sdk test/fixture — blob:82afc9408b31 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-sdk/src/client.ts | package-source | R | adapter-sdk runtime source — blob:1c9500200189 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/conformance.ts | package-source | R | adapter-sdk runtime source — blob:f2cdad1335da — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/index.ts | package-source | R | adapter-sdk runtime source — blob:9476bf3d1e9d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/jsonrpc.hardening.test.ts | package-tests | R | adapter-sdk test/fixture — blob:9e3ee4aa18ae — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-sdk/src/jsonrpc.ts | package-source | R | adapter-sdk runtime source — blob:0bd77261b80e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/redaction.test.ts | package-tests | R | adapter-sdk test/fixture — blob:0d26e1ec3db4 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-sdk/src/redaction.ts | package-source | R | adapter-sdk runtime source — blob:b5d0b87a18e5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/server.ts | package-source | R | adapter-sdk runtime source — blob:7d7ae33d36a1 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-sdk/src/transport.hardening.test.ts | package-tests | R | adapter-sdk test/fixture — blob:a5e4616ad93a — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/package.json | package-manifests | R | adapter-web manifest/config — blob:d994b9ee9bbc — dependency resolution input |
| packages/adapter-web/src/bin.ts | package-source | R | adapter-web runtime source — blob:635c6f04746f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-web/src/dom-shims.d.ts | package-source | R | adapter-web runtime source — blob:d05add951e16 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-web/src/index.ts | package-source | R | adapter-web runtime source — blob:6372208b4ea9 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-web/src/seeded-app.ts | package-source | R | adapter-web runtime source — blob:5274a0dbb770 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-web/src/web-adapter.ts | package-source | R | adapter-web runtime source — blob:2ac388261035 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/adapter-web/src/web.conformance.integration.test.ts | package-tests | R | adapter-web test/fixture — blob:0bc13fbe7493 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/src/web.create-failure.test.ts | package-tests | R | adapter-web test/fixture — blob:b314f6b304ac — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/src/web.hardening.integration.test.ts | package-tests | R | adapter-web test/fixture — blob:1fa8e8e7ed96 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/src/web.hardening.test.ts | package-tests | R | adapter-web test/fixture — blob:1d4a78bb1560 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/src/web.target-url.integration.test.ts | package-tests | R | adapter-web test/fixture — blob:ba70d37dcd23 — reviewed: replay/backend/budget/cancellation maps |
| packages/adapter-web/src/web.window-classification.integration.test.ts | package-tests | R | adapter-web test/fixture — blob:a441051b8366 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/package.json | package-manifests | R | android manifest/config — blob:8c0d77c34541 — dependency resolution input |
| packages/android/src/adb-errors.ts | package-source | R | android runtime source — blob:8e81e33579bf — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/android-adapter.ts | package-source | R | android runtime source — blob:893882a55005 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/android.conformance.integration.test.ts | package-tests | R | android test/fixture — blob:2c0511f3a6ac — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/android.hardening.test.ts | package-tests | R | android test/fixture — blob:72fdc23a7fe5 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/android.lifecycle.test.ts | package-tests | R | android test/fixture — blob:b331076b2792 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/android.pidof.test.ts | package-tests | R | android test/fixture — blob:717f53523389 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/android.real-backend.integration.test.ts | package-tests | R | android test/fixture — blob:dc6b93233c0d — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/bin.ts | package-source | R | android runtime source — blob:1d42fc829e16 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/index.ts | package-source | R | android runtime source — blob:b3fd4e23025a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/mock-backend.ts | package-source | R | android runtime source — blob:e2ac7e02bed2 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/real-backend.ts | package-source | R | android runtime source — blob:4ef362a22a49 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/replay.test.ts | package-tests | R | android test/fixture — blob:7a5c8faaf900 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/replay.ts | package-source | R | android runtime source — blob:cbcdfe2f9ffc — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/types.ts | package-source | R | android runtime source — blob:19dd67746f91 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/src/uiautomator.test.ts | package-tests | R | android test/fixture — blob:d4ed1c1b5a60 — reviewed: replay/backend/budget/cancellation maps |
| packages/android/src/uiautomator.ts | package-source | R | android runtime source — blob:ea2a201de6ef — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/android/tsconfig.json | package-manifests | R | android manifest/config — blob:44b28d5436fd — dependency resolution input |
| packages/artifact-store/package.json | package-manifests | R | artifact-store manifest/config — blob:fab56aa6731f — dependency resolution input |
| packages/artifact-store/src/artifact-store.test.ts | package-tests | R | artifact-store test/fixture — blob:7cf2151c5ca4 — reviewed: replay/backend/budget/cancellation maps |
| packages/artifact-store/src/artifact-store.ts | package-source | R | artifact-store runtime source — blob:8ec1f0053e57 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/artifact-store/src/hardening.test.ts | package-tests | R | artifact-store test/fixture — blob:5c8895a01a06 — reviewed: replay/backend/budget/cancellation maps |
| packages/artifact-store/src/index.ts | package-source | R | artifact-store runtime source — blob:9c0af7707326 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/artifact-store/src/property.hardening.test.ts | package-tests | R | artifact-store test/fixture — blob:9adbfc5b3cf9 — reviewed: replay/backend/budget/cancellation maps |
| packages/artifact-store/src/soak.integration.test.ts | package-tests | R | artifact-store test/fixture — blob:f003737cffc4 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/package.json | package-manifests | R | cli-adapter manifest/config — blob:5a28040cd5fa — dependency resolution input |
| packages/cli-adapter/scripts/pty-exit-repro.mjs | package-source | R | cli-adapter runtime source — blob:1b156152a79b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/bin.ts | package-source | R | cli-adapter runtime source — blob:3da6f20c3a8f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/cli-adapter.ts | package-source | R | cli-adapter runtime source — blob:f077b85aefb6 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/cli.conformance.integration.test.ts | package-tests | R | cli-adapter test/fixture — blob:694cda5ed7ee — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/cli.hardening.test.ts | package-tests | R | cli-adapter test/fixture — blob:e7cd5ed44289 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/fixtures/fullscreen-tui.mjs | package-source | R | cli-adapter runtime source — blob:13437ec53277 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/index.ts | package-source | R | cli-adapter runtime source — blob:42a89ba656dc — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/mock-pty.ts | package-source | R | cli-adapter runtime source — blob:a62bea0ae068 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/node-pty-backend.integration.test.ts | package-tests | R | cli-adapter test/fixture — blob:7fbc63fb223d — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/node-pty-backend.ts | package-source | R | cli-adapter runtime source — blob:afd63d6a8e9c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/pty-exit-wedge.integration.test.ts | package-tests | R | cli-adapter test/fixture — blob:e9da8a426019 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/replay.integration.test.ts | package-tests | R | cli-adapter test/fixture — blob:2cb652212e6d — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/replay.ts | package-source | R | cli-adapter runtime source — blob:a7777d25d2d1 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/tui-screen.integration.test.ts | package-tests | R | cli-adapter test/fixture — blob:e0ee3da7b906 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/types.ts | package-source | R | cli-adapter runtime source — blob:3d1c5a3f36af — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/src/vt-screen.test.ts | package-tests | R | cli-adapter test/fixture — blob:23cfde60dbf6 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli-adapter/src/vt-screen.ts | package-source | R | cli-adapter runtime source — blob:ea8dd2e705e9 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli-adapter/tsconfig.json | package-manifests | R | cli-adapter manifest/config — blob:ee3edb61ed2b — dependency resolution input |
| packages/cli/package.json | package-manifests | R | cli manifest/config — blob:e441bd502bbf — dependency resolution input |
| packages/cli/src/args.test.ts | package-tests | R | cli test/fixture — blob:90104dfafa58 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/args.ts | package-source | R | cli runtime source — blob:338c46cb1905 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/atomic.ts | package-source | R | cli runtime source — blob:66ff60f4315b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/bin.ts | package-source | R | cli runtime source — blob:ec539a0770ce — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/campaign.integration.test.ts | package-tests | R | cli test/fixture — blob:42a2ba5d8b2f — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/campaign.ts | package-source | R | cli runtime source — blob:a6e6fc1f4dde — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/cli.integration.test.ts | package-tests | R | cli test/fixture — blob:2964f26ebbdd — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/cli.ts | package-source | R | cli runtime source — blob:329fe8c74338 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/doctor.ts | package-source | R | cli runtime source — blob:47986d21ec3b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/findings.ts | package-source | R | cli runtime source — blob:a46b21de86c8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/fixtures/m11-repair-provider.cjs | package-source | R | cli runtime source — blob:169a31422e44 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/help.ts | package-source | R | cli runtime source — blob:3a2d04a4a16d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/hunt.ts | package-source | R | cli runtime source — blob:a1d87188d9a5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/index.ts | package-source | R | cli runtime source — blob:8d638ba682a3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/m11-acceptance.integration.test.ts | package-tests | R | cli test/fixture — blob:a0495a7289ac — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/models.integration.test.ts | package-tests | R | cli test/fixture — blob:fea15084468b — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/models.ts | package-source | R | cli runtime source — blob:a8d85573185c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/regress.ts | package-source | R | cli runtime source — blob:5c264e329e7d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/repair-cli.integration.test.ts | package-tests | R | cli test/fixture — blob:1ab093ed7c86 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/repair.ts | package-source | R | cli runtime source — blob:b05e3654ff7d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/replay-workflow.ts | package-source | R | cli runtime source — blob:cd361bbfa3bb — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/runs.ts | package-source | R | cli runtime source — blob:d2fb81a21f98 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/verify-regress.integration.test.ts | package-tests | R | cli test/fixture — blob:68e277613a94 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/verify.ts | package-source | R | cli runtime source — blob:31d05305df94 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/version.test.ts | package-tests | R | cli test/fixture — blob:ac1e7ba66b19 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/version.ts | package-source | R | cli runtime source — blob:63c80fa66497 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/src/workspace.test.ts | package-tests | R | cli test/fixture — blob:39a0d8775002 — reviewed: replay/backend/budget/cancellation maps |
| packages/cli/src/workspace.ts | package-source | R | cli runtime source — blob:6ccc67b27d83 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/cli/tsconfig.json | package-manifests | R | cli manifest/config — blob:1a88d790502e — dependency resolution input |
| packages/core/package.json | package-manifests | R | core manifest/config — blob:116eb0a5ee1a — dependency resolution input |
| packages/core/src/fixtures/lifecycle-log-adapter.mjs | package-source | R | core runtime source — blob:b199dc20c88a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/fixtures/mini-adapter.mjs | package-source | R | core runtime source — blob:4efee327aed5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/fixtures/strict-lifecycle-adapter.mjs | package-source | R | core runtime source — blob:81e09ceec2f5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/hardening.test.ts | package-tests | R | core test/fixture — blob:759687048393 — reviewed: replay/backend/budget/cancellation maps |
| packages/core/src/index.ts | package-source | R | core runtime source — blob:18be3174ec07 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/policy.test.ts | package-tests | R | core test/fixture — blob:2fce1ffed63e — reviewed: replay/backend/budget/cancellation maps |
| packages/core/src/policy.ts | package-source | R | core runtime source — blob:b944ece9254f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/run-manager.create-options.integration.test.ts | package-tests | R | core test/fixture — blob:698dc635d01c — reviewed: replay/backend/budget/cancellation maps |
| packages/core/src/run-manager.integration.test.ts | package-tests | R | core test/fixture — blob:95e8c780cfc3 — reviewed: replay/backend/budget/cancellation maps |
| packages/core/src/run-manager.ts | package-source | R | core runtime source — blob:3071dec2472e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/core/src/validation.ts | package-source | R | core runtime source — blob:812b2a87524a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/package.json | package-manifests | R | electron-adapter manifest/config — blob:9c72b0b7f4af — dependency resolution input |
| packages/electron-adapter/src/bin.ts | package-source | R | electron-adapter runtime source — blob:622f24b439aa — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/capabilities.ts | package-source | R | electron-adapter runtime source — blob:0417840f309e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/electron-adapter.ts | package-source | R | electron-adapter runtime source — blob:2339470ce14e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/electron-production.integration.test.ts | package-tests | R | electron-adapter test/fixture — blob:2474ebd87269 — reviewed: replay/backend/budget/cancellation maps |
| packages/electron-adapter/src/electron.conformance.integration.test.ts | package-tests | R | electron-adapter test/fixture — blob:1ac8a5e30f91 — reviewed: replay/backend/budget/cancellation maps |
| packages/electron-adapter/src/electron.hardening.test.ts | package-tests | R | electron-adapter test/fixture — blob:25a70934f23c — reviewed: replay/backend/budget/cancellation maps |
| packages/electron-adapter/src/fixtures/main.cjs | package-source | R | electron-adapter runtime source — blob:a83e1db26a91 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/fixtures/renderer.html | package-other | R | electron-adapter other — blob:94563dd1dd83 |
| packages/electron-adapter/src/index.ts | package-source | R | electron-adapter runtime source — blob:07897120a34d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/real-electron.ts | package-source | R | electron-adapter runtime source — blob:d9470ce7f07e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/src/replay.ts | package-source | R | electron-adapter runtime source — blob:144b70894052 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/electron-adapter/tsconfig.json | package-manifests | R | electron-adapter manifest/config — blob:c4c240d341f9 — dependency resolution input |
| packages/explore/package.json | package-manifests | R | explore manifest/config — blob:362a07707f16 — dependency resolution input |
| packages/explore/src/anomaly.ts | package-source | R | explore runtime source — blob:0b60c4b9265c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/autonomy.ts | package-source | R | explore runtime source — blob:2ee1f55f2fe6 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/campaign.ts | package-source | R | explore runtime source — blob:269c0418efcb — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/checkpoint.ts | package-source | R | explore runtime source — blob:c1f31d43c25f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/control.ts | package-source | R | explore runtime source — blob:858dfef89d9a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/explore.hardening.test.ts | package-tests | R | explore test/fixture — blob:1342ef906dec — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/explore.test.ts | package-tests | R | explore test/fixture — blob:75261e62600e — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/faults.ts | package-source | R | explore runtime source — blob:42e76ffce7c3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/fingerprint-property.test.ts | package-tests | R | explore test/fixture — blob:8ff172ff102b — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/index.ts | package-source | R | explore runtime source — blob:3bbc869670e7 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/inputs.ts | package-source | R | explore runtime source — blob:fac8696c21e4 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/inventory.ts | package-source | R | explore runtime source — blob:25f950801522 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/model-context.test.ts | package-tests | R | explore test/fixture — blob:99aabb7b2a72 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/model-context.ts | package-source | R | explore runtime source — blob:a3ed6e65dcaf — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/model-planner.fuzz.test.ts | package-tests | R | explore test/fixture — blob:eb6154e13dfa — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/model-planner.integration.test.ts | package-tests | R | explore test/fixture — blob:561f414faff5 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/model-planner.test.ts | package-tests | R | explore test/fixture — blob:645080f88025 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/model-planner.ts | package-source | R | explore runtime source — blob:7f638684a904 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/native-inventory.test.ts | package-tests | R | explore test/fixture — blob:1c8cc79ac4c3 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/native-inventory.ts | package-source | R | explore runtime source — blob:974eedb73085 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/native-session.integration.test.ts | package-tests | R | explore test/fixture — blob:d0595eec0984 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/native-session.ts | package-source | R | explore runtime source — blob:2ffe4aa3bb22 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/native-vocab.test.ts | package-tests | R | explore test/fixture — blob:25930d1f62cd — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/planner.ts | package-source | R | explore runtime source — blob:75d832103993 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/resumable-exploration.integration.test.ts | package-tests | R | explore test/fixture — blob:fa7b09299edf — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/resumable-native.integration.test.ts | package-tests | R | explore test/fixture — blob:97e8e6468a2f — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/rng.ts | package-source | R | explore runtime source — blob:996a2b3c05ae — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/scoring.ts | package-source | R | explore runtime source — blob:f8a2a8535f49 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/session-memory.test.ts | package-tests | R | explore test/fixture — blob:8c8886d63b3d — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/session-memory.ts | package-source | R | explore runtime source — blob:d0a5a89120e8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/state.ts | package-source | R | explore runtime source — blob:db22f0e34472 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/web-replay.target-url.integration.test.ts | package-tests | R | explore test/fixture — blob:c38a97109ab6 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/web-replay.ts | package-source | R | explore runtime source — blob:f31353006097 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/explore/src/web.explore.integration.test.ts | package-tests | R | explore test/fixture — blob:033707641e52 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/src/web.generic-dom.integration.test.ts | package-tests | R | explore test/fixture — blob:d3d4724de801 — reviewed: replay/backend/budget/cancellation maps |
| packages/explore/tsconfig.json | package-manifests | R | explore manifest/config — blob:0423fdca62e4 — dependency resolution input |
| packages/finding/package.json | package-manifests | R | finding manifest/config — blob:0445c79e4cd3 — dependency resolution input |
| packages/finding/src/drivers.ts | package-source | R | finding runtime source — blob:3b68f5694e3b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/finding/src/engine.ts | package-source | R | finding runtime source — blob:04fda06e10f2 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/finding/src/finding-engine.ts | package-source | R | finding runtime source — blob:9b13a009531d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/finding/src/finding.test.ts | package-tests | R | finding test/fixture — blob:a17195e5754c — reviewed: replay/backend/budget/cancellation maps |
| packages/finding/src/index.ts | package-source | R | finding runtime source — blob:bdaa40edebe5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/finding/src/minimize-property.test.ts | package-tests | R | finding test/fixture — blob:b827c3b1ec5f — reviewed: replay/backend/budget/cancellation maps |
| packages/finding/src/oracle-automation-failure.test.ts | package-tests | R | finding test/fixture — blob:db4aec8f5058 — reviewed: replay/backend/budget/cancellation maps |
| packages/finding/src/oracle-fpfn.hardening.test.ts | package-tests | R | finding test/fixture — blob:71f04486c934 — reviewed: replay/backend/budget/cancellation maps |
| packages/finding/src/statemachine-matrix.test.ts | package-tests | R | finding test/fixture — blob:d305a94e8f26 — reviewed: replay/backend/budget/cancellation maps |
| packages/finding/src/types.ts | package-source | R | finding runtime source — blob:8414f31f8fcc — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/package.json | package-manifests | R | model-runtime manifest/config — blob:b9a134dc928f — dependency resolution input |
| packages/model-runtime/src/index.ts | package-source | R | model-runtime runtime source — blob:07517246c6b3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/src/legacy.ts | package-source | R | model-runtime runtime source — blob:4cd4a25a064c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/src/load-module.ts | package-source | R | model-runtime runtime source — blob:b98174452c82 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/src/model-runtime.test.ts | package-tests | R | model-runtime test/fixture — blob:76bf82318b96 — reviewed: replay/backend/budget/cancellation maps |
| packages/model-runtime/src/router.ts | package-source | R | model-runtime runtime source — blob:9ee5c1121d87 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/src/scripted.ts | package-source | R | model-runtime runtime source — blob:18501b5d0774 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/model-runtime/src/types.ts | package-source | R | model-runtime runtime source — blob:6a9cdd29c74c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/package.json | package-manifests | R | oracle manifest/config — blob:7cecd2e8eeeb — dependency resolution input |
| packages/oracle/src/index.ts | package-source | R | oracle runtime source — blob:4f2c7746ca17 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/src/invariant.ts | package-source | R | oracle runtime source — blob:d39fb5035475 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/src/oracle.test.ts | package-tests | R | oracle test/fixture — blob:c24fe7926244 — reviewed: replay/backend/budget/cancellation maps |
| packages/oracle/src/semantic.test.ts | package-tests | R | oracle test/fixture — blob:a7c21ceb839f — reviewed: replay/backend/budget/cancellation maps |
| packages/oracle/src/semantic.ts | package-source | R | oracle runtime source — blob:e2a0113a6677 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/src/suite.ts | package-source | R | oracle runtime source — blob:641c40372cae — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/src/suspicion.ts | package-source | R | oracle runtime source — blob:4b65c9a3da98 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/src/types.ts | package-source | R | oracle runtime source — blob:b3376ef41a9e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/oracle/tsconfig.json | package-manifests | R | oracle manifest/config — blob:bcc5e843b969 — dependency resolution input |
| packages/protocol/package.json | package-manifests | R | protocol manifest/config — blob:e173c51be56f — dependency resolution input |
| packages/protocol/src/capabilities.ts | package-source | R | protocol runtime source — blob:aa33df975262 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/errors.ts | package-source | R | protocol runtime source — blob:c78d2fe48c12 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/ids.ts | package-source | R | protocol runtime source — blob:4e47e1d30d79 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/index.ts | package-source | R | protocol runtime source — blob:20087999dd43 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/messages.ts | package-source | R | protocol runtime source — blob:fa773cc17e66 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/protocol.test.ts | package-tests | R | protocol test/fixture — blob:6091757a1a1c — reviewed: replay/backend/budget/cancellation maps |
| packages/protocol/src/schema.ts | package-source | R | protocol runtime source — blob:e802fd478b3b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/protocol/src/version.ts | package-source | R | protocol runtime source — blob:3fad0691b6d6 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/package.json | package-manifests | R | repair manifest/config — blob:dccb4c0ff5e0 — dependency resolution input |
| packages/repair/src/context.ts | package-source | R | repair runtime source — blob:9e07d2f4f1aa — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/dogfood.integration.test.ts | package-tests | R | repair test/fixture — blob:4e5e016107fc — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/engine.ts | package-source | R | repair runtime source — blob:98870e61a532 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/index.ts | package-source | R | repair runtime source — blob:93b56837b03d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/model-patcher.test.ts | package-tests | R | repair test/fixture — blob:bb5d8e8afa90 — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/model-patcher.ts | package-source | R | repair runtime source — blob:603c8def4cf5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/model-repair.e2e.integration.test.ts | package-tests | R | repair test/fixture — blob:70758dcfe08c — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/patcher.ts | package-source | R | repair runtime source — blob:e4bdb70d7b51 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/path-policy-property.test.ts | package-tests | R | repair test/fixture — blob:65543347db5d — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/regression.test.ts | package-tests | R | repair test/fixture — blob:5e7955c51fae — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/regression.ts | package-source | R | repair runtime source — blob:318ffb201fcc — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/repair.e2e.integration.test.ts | package-tests | R | repair test/fixture — blob:e97c5b99777d — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/repair.hardening.integration.test.ts | package-tests | R | repair test/fixture — blob:c0d199e6dd6d — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/source-intel.test.ts | package-tests | R | repair test/fixture — blob:903518ac81d1 — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/source-intel.ts | package-source | R | repair runtime source — blob:a9cc7f05f192 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/types.ts | package-source | R | repair runtime source — blob:e2e700b7d0a0 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/src/worktree.hardening.test.ts | package-tests | R | repair test/fixture — blob:6865a014f68c — reviewed: replay/backend/budget/cancellation maps |
| packages/repair/src/worktree.ts | package-source | R | repair runtime source — blob:f235456a0c19 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/repair/tsconfig.json | package-manifests | R | repair manifest/config — blob:5e039955702c — dependency resolution input |
| packages/repo-contract/package.json | package-manifests | R | repo-contract manifest/config — blob:2356560314e7 — dependency resolution input |
| packages/repo-contract/src/campaign-state.test.ts | package-tests | R | repo-contract test/fixture — blob:fb73f0c01178 — reviewed: replay/backend/budget/cancellation maps |
| packages/repo-contract/src/ci-workflow.test.ts | package-tests | R | repo-contract test/fixture — blob:a3293f5fc1d7 — reviewed: replay/backend/budget/cancellation maps |
| packages/repo-contract/src/index.ts | package-source | R | repo-contract runtime source — blob:956b13aa795e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/package.json | package-manifests | R | scale manifest/config — blob:a57d70078737 — dependency resolution input |
| packages/scale/src/aggregation.test.ts | package-tests | R | scale test/fixture — blob:7567a24de3cf — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/campaign.integration.test.ts | package-tests | R | scale test/fixture — blob:2ebf9636ad45 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/campaign.ts | package-source | R | scale runtime source — blob:b2f019bd6409 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/cluster.ts | package-source | R | scale runtime source — blob:0634028c8537 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/discovery.ts | package-source | R | scale runtime source — blob:77e0895c47fe — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/executor.ts | package-source | R | scale runtime source — blob:18de91f4ee56 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/facade.ts | package-source | R | scale runtime source — blob:1732b38460cf — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/fake-executor.ts | package-source | R | scale runtime source — blob:e39152ed5154 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/fleet-harness.ts | package-source | R | scale runtime source — blob:3b2e7959187b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/fleet.integration.test.ts | package-tests | R | scale test/fixture — blob:51bf646ffec8 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/h2-fleet-hardening.test.ts | package-tests | R | scale test/fixture — blob:03e74987fd80 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/index.ts | package-source | R | scale runtime source — blob:a50c3b2d8008 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/lease-store.ts | package-source | R | scale runtime source — blob:582c8d9ec56c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/leases.ts | package-source | R | scale runtime source — blob:4b329e67b66e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/ledger.ts | package-source | R | scale runtime source — blob:572d6f466333 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/lock.hardening.test.ts | package-tests | R | scale test/fixture — blob:2dfdd7c46dc5 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/lock.ts | package-source | R | scale runtime source — blob:399eb13985d6 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/manifest.ts | package-source | R | scale runtime source — blob:8a9b16bce17a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/model-budget.test.ts | package-tests | R | scale test/fixture — blob:f92560848966 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/model-budget.ts | package-source | R | scale runtime source — blob:7c13170b7a07 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/model-campaign.integration.test.ts | package-tests | R | scale test/fixture — blob:0ed2003e4591 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/router.ts | package-source | R | scale runtime source — blob:f9ef280bab6b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/routing.test.ts | package-tests | R | scale test/fixture — blob:752057a7894a — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/scale.hardening.test.ts | package-tests | R | scale test/fixture — blob:de9338c63b45 — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/scale.test.ts | package-tests | R | scale test/fixture — blob:702c8149fa9a — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/settlement.ts | package-source | R | scale runtime source — blob:10454955fe08 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/soak.integration.test.ts | package-tests | R | scale test/fixture — blob:c22ad6c53a7a — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/state-file.hardening.test.ts | package-tests | R | scale test/fixture — blob:84f29107661b — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/state-file.ts | package-source | R | scale runtime source — blob:bf74e5b7d3b9 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/state-validation.ts | package-source | R | scale runtime source — blob:b77ad29bea2e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/types.ts | package-source | R | scale runtime source — blob:3c5b09ae2e12 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/src/work-item.test.ts | package-tests | R | scale test/fixture — blob:29063678d05a — reviewed: replay/backend/budget/cancellation maps |
| packages/scale/src/work-item.ts | package-source | R | scale runtime source — blob:e2a6454bbfc8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/scale/tsconfig.json | package-manifests | R | scale manifest/config — blob:48f706231e63 — dependency resolution input |
| packages/store-sqlite/package.json | package-manifests | R | store-sqlite manifest/config — blob:02ebc66ee3ae — dependency resolution input |
| packages/store-sqlite/src/index.ts | package-source | R | store-sqlite runtime source — blob:db1bb929b5c8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/store-sqlite/src/migrations.ts | package-source | R | store-sqlite runtime source — blob:53718c378945 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/store-sqlite/src/model-calls.integration.test.ts | package-tests | R | store-sqlite test/fixture — blob:cd715be3f5ec — reviewed: replay/backend/budget/cancellation maps |
| packages/store-sqlite/src/soak.integration.test.ts | package-tests | R | store-sqlite test/fixture — blob:515b6517ae52 — reviewed: replay/backend/budget/cancellation maps |
| packages/store-sqlite/src/store.integration.test.ts | package-tests | R | store-sqlite test/fixture — blob:b25093b71baf — reviewed: replay/backend/budget/cancellation maps |
| packages/store-sqlite/src/store.ts | package-source | R | store-sqlite runtime source — blob:9a6bf2f87349 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/package.json | package-manifests | R | windows-adapter manifest/config — blob:536f04a92ec0 — dependency resolution input |
| packages/windows-adapter/src/backend-selection.test.ts | package-tests | R | windows-adapter test/fixture — blob:89b2cb00eb6f — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/bin.ts | package-source | R | windows-adapter runtime source — blob:a7ab59aa12c3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/index.ts | package-source | R | windows-adapter runtime source — blob:673cb7a8206a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/mock-uia.ts | package-source | R | windows-adapter runtime source — blob:32d4ed688a8a — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/real-uia.ts | package-source | R | windows-adapter runtime source — blob:a2feddbd675c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/replay.test.ts | package-tests | R | windows-adapter test/fixture — blob:4ba4d9c5a372 — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/replay.ts | package-source | R | windows-adapter runtime source — blob:9a39ae22d59b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/selection.ts | package-source | R | windows-adapter runtime source — blob:c26ddd0b54a5 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/types.ts | package-source | R | windows-adapter runtime source — blob:fa5b2d2ae9e8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/uia-bridge.ts | package-source | R | windows-adapter runtime source — blob:4bdb3884474f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/windows-adapter.ts | package-source | R | windows-adapter runtime source — blob:e503bc0d00f2 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/windows-adapter/src/windows.conformance.integration.test.ts | package-tests | R | windows-adapter test/fixture — blob:fda3ee3a5130 — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/windows.hardening.test.ts | package-tests | R | windows-adapter test/fixture — blob:8c72b2925f6a — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/windows.liveness.test.ts | package-tests | R | windows-adapter test/fixture — blob:7deea813397e — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/windows.real-uia.integration.test.ts | package-tests | R | windows-adapter test/fixture — blob:667ebf7d6d20 — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/windows.rehost.test.ts | package-tests | R | windows-adapter test/fixture — blob:d9a51a937a9b — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/src/windows.stale-window.test.ts | package-tests | R | windows-adapter test/fixture — blob:3a4b9f918451 — reviewed: replay/backend/budget/cancellation maps |
| packages/windows-adapter/tsconfig.json | package-manifests | R | windows-adapter manifest/config — blob:444c93decf9f — dependency resolution input |
| packages/workflows/package.json | package-manifests | R | workflows manifest/config — blob:e618d7f0ca67 — dependency resolution input |
| packages/workflows/src/adapter-family-matrix.test.ts | package-tests | R | workflows test/fixture — blob:6e177e2eb41b — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/atomic.ts | package-source | R | workflows runtime source — blob:92c9af425f1b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/campaign-executor.integration.test.ts | package-tests | R | workflows test/fixture — blob:68af269889a5 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/campaign-executor.ts | package-source | R | workflows runtime source — blob:d85c95f2978f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/campaign-pty.integration.test.ts | package-tests | R | workflows test/fixture — blob:ee01aec70070 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/campaign-restart.integration.test.ts | package-tests | R | workflows test/fixture — blob:7ddb57c3bb73 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/capabilities.ts | package-source | R | workflows runtime source — blob:53339b14add8 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/configs.ts | package-source | R | workflows runtime source — blob:0b6e5342c11c — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/electron-fleet.integration.test.ts | package-tests | R | workflows test/fixture — blob:5f136d394106 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/electron-hunt.ts | package-source | R | workflows runtime source — blob:b1e08b86371e — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/electron-replay.integration.test.ts | package-tests | R | workflows test/fixture — blob:336efa72da48 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/errors.ts | package-source | R | workflows runtime source — blob:affd12963837 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/evidence.ts | package-source | R | workflows runtime source — blob:6107de9223ad — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/exploration.ts | package-source | R | workflows runtime source — blob:dddc4102cb0f — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/fake-hunt.ts | package-source | R | workflows runtime source — blob:3eb01f8824bb — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/families.ts | package-source | R | workflows runtime source — blob:b76fde3ee684 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/h2-control.integration.test.ts | package-tests | R | workflows test/fixture — blob:29c957ffac07 — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/index.ts | package-source | R | workflows runtime source — blob:ad46619036ce — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/meta.ts | package-source | R | workflows runtime source — blob:5ac7c6fb20cc — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/model-support.ts | package-source | R | workflows runtime source — blob:c4e1f902b8cd — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/native-hunt.ts | package-source | R | workflows runtime source — blob:138dbc0b3226 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/replay-subject.ts | package-source | R | workflows runtime source — blob:616c21d74c70 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/types.ts | package-source | R | workflows runtime source — blob:8110f171827b — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/web-hunt.ts | package-source | R | workflows runtime source — blob:20f777b2979d — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| packages/workflows/src/windows-campaign.integration.test.ts | package-tests | R | workflows test/fixture — blob:e8d26e729e4f — reviewed: replay/backend/budget/cancellation maps |
| packages/workflows/src/workspace.ts | package-source | R | workflows runtime source — blob:ee3a986f45d3 — reviewed: protocol/adapters/workflow/finding/replay/budget paths |
| pnpm-lock.yaml | root-lockfile | R | tracked dependency lockfile — blob:7c63721d3593 — configuration/dependency surface, not untracked output |
| pnpm-workspace.yaml | root-config | R | root config/manifest — blob:e7eb69ed56d3 |
| scripts/build-release.mjs | scripts | R | build/release script — blob:e27f6dc7ac40 |
| scripts/gen_audit_census.py | scripts | R | build/release script — blob:e3446fabca12 |
| scripts/perf-bench.ts | scripts | R | build/release script — blob:798282e88f0d |
| scripts/release-smoke.mjs | scripts | R | build/release script — blob:a35dd9d5a1c8 |
| specs/000-foundation/SPEC.md | specs | R | spec artifact — blob:cfe9b6947a14 |
| specs/000-foundation/TASKS.md | specs | R | spec artifact — blob:f95f2cae965d |
| specs/001-web-adapter/SPEC.md | specs | R | spec artifact — blob:4de153b61137 |
| specs/001-web-adapter/TASKS.md | specs | R | spec artifact — blob:4bae13f6f593 |
| specs/002-finding-reproduction/SPEC.md | specs | R | spec artifact — blob:5a1cbf638b8d |
| specs/002-finding-reproduction/TASKS.md | specs | R | spec artifact — blob:e014ab1fb454 |
| specs/003-autonomous-exploration/SPEC.md | specs | R | spec artifact — blob:4dd0ec1e5fd4 |
| specs/003-autonomous-exploration/TASKS.md | specs | R | spec artifact — blob:573e5aae5c63 |
| specs/004-oracle-repair/SPEC.md | specs | R | spec artifact — blob:a241daedcaa0 |
| specs/004-oracle-repair/TASKS.md | specs | R | spec artifact — blob:193a1769312a |
| specs/005-android/SPEC.md | specs | R | spec artifact — blob:864a3415e4fa |
| specs/005-android/TASKS.md | specs | R | spec artifact — blob:28dc411b0977 |
| specs/006-cross-platform/SPEC.md | specs | R | spec artifact — blob:53c160fa90e7 |
| specs/006-cross-platform/TASKS.md | specs | R | spec artifact — blob:984d63013da7 |
| specs/007-scale-integrations/SPEC.md | specs | R | spec artifact — blob:245fe2f60e14 |
| specs/007-scale-integrations/TASKS.md | specs | R | spec artifact — blob:fae5c21465be |
| specs/008-ios/SPEC.md | specs | R | spec artifact — blob:5e29bb7b9313 |
| specs/009-native-autonomous-exploration/SPEC.md | specs | R | spec artifact — blob:f64e42a5981c |
| specs/010-resumable-exploration/SPEC.md | specs | R | spec artifact — blob:4b9ab0d26923 |
| specs/010-resumable-exploration/TASKS.md | specs | R | spec artifact — blob:a41d8e57d437 |
| specs/011-operator-product-workflows/SPEC.md | specs | R | spec artifact — blob:4e74dccfe13c |
| specs/011-operator-product-workflows/TASKS.md | specs | R | spec artifact — blob:2679fe69c557 |
| specs/012-real-target-fleet-campaigns/SPEC.md | specs | R | spec artifact — blob:81fd240ec03b |
| specs/012-real-target-fleet-campaigns/TASKS.md | specs | R | spec artifact — blob:eadaaf701106 |
| specs/013-intelligence-guided-autonomy/SPEC.md | specs | R | spec artifact — blob:a6d31db5bd32 |
| specs/013-intelligence-guided-autonomy/TASKS.md | specs | R | spec artifact — blob:b20ab8dcbc0a |
| specs/README.md | specs | R | spec artifact — blob:2814690a72c8 |
| tsconfig.json | root-config | R | root config/manifest — blob:d369119ae3ab |
| vitest.config.ts | root-config | R | root config/manifest — blob:3001f62a138f |
| vitest.integration.config.ts | root-config | R | root config/manifest — blob:7ad85fec46f6 |

## Reconciliation

- tracked (git ls-files): 534
- reviewed (R): 534
- excluded (E): 0
- R + E = 534 == tracked 534: True

## System maps (referenced)

- Adapter family contract: `packages/workflows/src/families.ts` (FAMILY_CONTRACT, exhaustive over @inspector/scale AdapterFamily).
- Workflow fleet truth resolution: `packages/workflows/src/workspace.ts`, `exploration.ts`, `campaign-executor.ts`, `replay-subject.ts`.
- Electron durable lane: `packages/electron-adapter/src/{index,replay}.ts`.
- Windows/UIA durable lane: `packages/windows-adapter/src/{index,replay,mock-uia,real-uia,native-hunt}.ts`.
- Durable control-plane state: `packages/core/src/{state,run-manager}.ts`, `packages/workflows/src/meta.ts`.
- Replay routing: `packages/workflows/src/replay-subject.ts` (REPLAY_DRIVER_FACTORIES / REPLAY_SUPPORTED_DURABLE_ADAPTERS).
