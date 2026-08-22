# Project Status

Last updated: RC1 finalization

## Campaign

- Mode: **RC1_FINALIZATION**
- Campaign status: **gates PASS; release candidate finalized and tagged**
  (`v0.1.0-rc.1`). Provenance: `.inspector/state/RC1-RELEASE-MANIFEST.md`;
  durable ledger: `.inspector/state/RELEASE-RC1.yaml`.
- Working branch: `main`
- Publication boundary respected: local artifacts + annotated tag only —
  no npm publish, no GitHub Release, no hosted uploads.

## Release candidate summary

RC1 is the first distributable (`inspector-cli-0.1.0-rc.1`): a Node 22 CLI
plus bundled adapter subprocesses, installable from the packed npm tarball,
with version coherence across CLI stamp, artifact metadata, filename, notes,
and tag. All completion gates ran on the exact tagged tree: lint/typecheck/
unit/integration suites green (474 unit passed / 132 integration tests incl.
real Chromium, ConPTY, UIA and AVD backends); dependency audit reviewed
(runtime graph: zero known vulnerabilities); license truth enforced
(UNLICENSED artifact metadata; permissive 48-package runtime tree);
install/doctor/real-web-hunt/resume/upgrade/uninstall proofs from the
installed artifact outside the source tree; reproducibility qualified
(byte-identical tarballs across clean clones). Both historical RC1 blockers
were root-caused and closed with regression coverage: web pageerror
action-window attribution (racy test made deterministic) and Windows real-UIA
Paint STALE_ELEMENT (bounded pid-gated reattach+retry in `RealUiaBackend`);
the CLI interrupt/resume sequence-reuse defect was fixed via a durable
step-sequence floor.

Prior state: implementation campaign M0–M7 complete and hardened
(HARDENING_1 closed 66 defects — 5 CRITICAL, 23 HIGH, 38 MEDIUM/LOW;
ledger in `.inspector/state/HARDENING-CHECKPOINT.md`). M8 (iOS) is
`DEFERRED_ENVIRONMENT`; resumption requirements in `specs/008-ios/SPEC.md`.

## RC1 dogfood summary

Six unscripted hunts ran against real production backends on the dev machine:
web todomvc-react and todomvc-backbone (Playwright + Chromium), vim over a real
ConPTY PTY, Calculator and Store Paint via the real PowerShell UIA bridge, and
`com.android.settings` on a freshly booted headless AVD. A seeded control hunt
confirmed 3/3 planted defects through the full pipeline.

The independent finding audit re-derived every classification from artifacts:
5 distinct TRUE_DEFECTs and 6 distinct actionable quality issues were confirmed
across ~755 actions (~69 actions per useful finding; FP rate 4.2%). Both HIGH
defects have verified fixes/mitigations in the tree:

- R1 nav-only explorer on class/placeholder-only DOM — fixed in
  `packages/explore/src/inventory.ts` with regression coverage.
- V2 node-pty host-exit wedge — mitigated (teardown path + exit guard + N=5
  regression test); upstream defect in `@lydell/node-pty` persists behind the
  guard and is tracked for retriage on dependency upgrade.

**Zero unresolved Critical/High defects.** Remaining open items are MEDIUM
(C-F2 silent UWP subtree collapse, D-A2 `pidof` exit-1 contract, M-A4 adapter
policy hook, W6 non-web exploration vocabularies) — see FINDING-AUDIT.md.

## Verified gates

| Gate | Result |
| --- | --- |
| lint | PASS |
| typecheck | PASS |
| test (unit) | PASS — 460 passed / 3 skipped, 37 files |
| test:integration | PASS — latest recorded run 120/120, 25 files (`integration-final.log`), including the scale fleet fix |

Unit numbers above were re-verified against the current tree on 2026-08-22.

## Known blockers

None. The final gate (full gates rerun, clean-install proof, RC1 report) is
pending and runs after this status update; RC1 completion is not declared yet.

## Milestone summary

| Milestone | State |
| --- | --- |
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | COMPLETE |
| M4 Oracle/repair | COMPLETE |
| M5 Android | COMPLETE |
| M6 Cross-platform adapters | COMPLETE |
| M7 Scale/integrations | COMPLETE |
| M8 iOS | DEFERRED_ENVIRONMENT |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
