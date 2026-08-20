# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `implementation/autonomous-campaign`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

M0.F0.workspace completed. The repository now contains a bootstrapped pnpm workspace with root TypeScript config (strict, NodeNext), ESLint flat config, Vitest unit + integration configs, a Node 22+ GitHub Actions CI workflow, and seven package skeletons (protocol, store-sqlite, artifact-store, adapter-sdk, adapter-fake, core, cli).

Verified implementation gates: **F0** (lint/typecheck/test/test:integration all green on empty packages).

## Active waypoint

- Milestone: M0 Foundation kernel
- Spec: `specs/000-foundation/SPEC.md`
- Task group: F1 Protocol package
- Waypoint: `M0.F1.protocol`
- State: READY

## Exact next action

Implement the protocol package (envelope, IDs, error model, deadlines, version 0.1; JSON Schema validation; capability negotiation; observe/action/lifecycle messages; ordered adapter event envelope; fixture tests). Run the F1 gate: schemas reject malformed IDs, missing deadlines, invalid capabilities and out-of-version messages.

After the gate passes:

1. mark F1 complete in the task graph;
2. add `M0.F1.protocol` to completed waypoints in `campaign.yaml`;
3. set active task group/waypoint to F2 SQLite store;
4. record the actual gate commands/results and verified commit;
5. checkpoint commit if authorized;
6. continue immediately into F2.

## Known blockers

None.

## Do not do yet

- Do not begin Playwright adapter work before M0 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
