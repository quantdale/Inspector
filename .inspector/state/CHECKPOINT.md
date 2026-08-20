# Campaign Checkpoint

## Identity

- Campaign: IMPLEMENTATION
- Status: ACTIVE / READY
- Working branch: `implementation/autonomous-campaign`
- Initialized from: `main@ac74afbcc3824acee457a5cc5b26956ea5c98562`
- Hardening: NOT ACTIVE

## Last trusted implementation state

No implementation waypoint has been completed yet. The repository currently contains architecture/specification material but no bootstrapped TypeScript implementation workspace.

Verified implementation gates: **none**.

## Active waypoint

- Milestone: M0 Foundation kernel
- Spec: `specs/000-foundation/SPEC.md`
- Task group: F0 Workspace bootstrap
- Waypoint: `M0.F0.workspace`
- State: READY

## Exact next action

Create the pnpm workspace/root TypeScript configuration, repository scripts, Node 22+ CI scaffolding, and package skeletons required by Spec 000. Then execute the F0 gate: clean install plus empty-package lint/typecheck/test passing.

After the gate passes:

1. mark F0 complete in the task graph;
2. add `M0.F0.workspace` to completed waypoints in `campaign.yaml`;
3. set active task group/waypoint to the first F1 protocol slice;
4. record the actual gate commands/results and verified commit;
5. checkpoint commit if authorized;
6. continue immediately into F1.

## Known blockers

None.

## Do not do yet

- Do not begin Playwright adapter work before M0 completion.
- Do not start broad hardening/audit campaigns.
- Do not add a cloud control plane or dashboard.
- Do not bypass policy/capability semantics to make the demo easier.
