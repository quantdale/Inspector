# HARDENING_5 — Fleet Execution Truth

## Why

Inspector's current fleet control plane declares Electron as a supported adapter family, validates Electron campaign items, and advertises Electron capability, while the shared workflow execution layer cannot represent or spawn Electron and falls through to the fake adapter. This is a trust-boundary defect: a configuration can be accepted as one platform yet execute through another. The current green CI does not cover that end-to-end contract.

The same audit also found adjacent cross-platform durability and runtime-efficiency debt that should be addressed only with deterministic evidence: Windows rename sharing violations outside StateFile, stale platform truth surfaces, expensive web replay, and an explicitly unlanded speculative H4 performance patch.

## What Changes

- Make adapter-family handling exhaustive from manifest validation through routing, workflow execution, adapter spawn, durable identity, replay, verify/regress, resume, and installed-artifact execution.
- Add real Electron fleet execution while preserving Electron identity even where its adapter reuses Chromium/web semantics internally.
- Prove the Windows/UIA campaign lane end-to-end and reconcile stale historical debt claims.
- Add Electron platform-faithful replay/verify/regress/resume behavior or fail at preflight with an explicit narrowed contract; never accept and silently substitute another adapter.
- Eliminate default-to-fake fallthrough for validated product configuration and add matrix/repo-contract coverage so future adapter additions cannot drift across layers.
- Complete evidence-backed Windows/POSIX atomic-write parity for remaining rename-based writers without broad blind retries.
- Profile expensive exploration/replay and other hot paths; land only independently measured optimizations that preserve crash/restart, cancellation, determinism, evidence, and clean-CI contracts.
- Produce a mechanically checkable every-tracked-file audit census and reconcile current docs/state/OpenSpec truth.

## Capabilities

### New Capabilities

- `fleet-execution-truth`: every accepted adapter family preserves identity and has exhaustive executable/refusal semantics across the entire fleet pipeline.
- `cross-platform-atomic-writes`: rename-based persistence paths have explicit, tested Windows/POSIX failure and durability semantics.
- `runtime-efficiency-proof`: performance changes require reproducible baselines and before/after evidence without correctness-gate weakening.
- `audit-certification`: a hardening completion claim includes an exact tracked-file audit census and exact-tree local/hosted certification.

### Modified Capabilities

This change hardens existing M12/M13 fleet, workflow, replay, evidence, platform-adapter, persistence, CI, and operator-truth behavior. It does not create M14 and does not change the release authorization model.

## Scope Boundaries

In scope: `packages/**`, fleet/workflow/adapter/replay/atomic-write boundaries, CLI/installed artifacts, tests/fixtures, CI/scripts, durable state, docs/ADRs/specs, and measured performance work justified by profiling.

Out of scope unless evidence forces a narrow change: new user-facing product features, autonomous campaign repair, new model providers, release/tag/publication, weakening security/policy boundaries, rewriting the TypeScript core, or declaring M8 iOS complete without macOS/Xcode/simulator evidence.

## Success Signal

A real Electron campaign can be accepted, routed, executed, persisted, replayed, verified/regressed, resumed, and reported without ever becoming fake/web by silent fallback; Windows fleet execution is similarly proven; unknown families fail closed; atomic writes are honest across supported OSes; measured optimizations improve relevant bottlenecks without enlarging unproven crash windows; and the final report proves every tracked authored file was accounted for.
