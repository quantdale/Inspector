# Inspector Execution Prompt — HARDENING_6

**Status:** ACTIVE  
**Campaign:** HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity  
**Mode:** HARDENING  
**Target branch:** `main` only  
**Planner baseline:** `038550172866001ce8bfe44054b8146b3391af32`  
**Baseline hosted CI:** run `33038479136` SUCCESS on exact baseline SHA  
**OpenSpec change:** `openspec/changes/hardening-6-repair-trust/`  
**Execution envelope:** approximately 12 hours of productive autonomous work; do not stop at the first green patch.

## One-shot objective

Pull the latest `main`, rehydrate durable state, then execute the entire HARDENING_6 OpenSpec to closure. Preserve H1-H5 and M0-M13 history. Find/fix confirmed defects, prove/reclassify suspicions with deterministic tests, perform a true semantic review of every final tracked authored blob, run mutation/fault/soak proof, pass exact-tree local gates, push verified commits without force, and require exact-SHA hosted certification before declaring COMPLETE.

Do not ask for routine approval. Continue to the next unblocked task automatically.

## Read first

1. `.inspector/state/campaign.yaml`
2. `.inspector/state/CHECKPOINT.md`
3. `AGENTS.md`
4. `docs/HARDENING-CAMPAIGN.md`
5. `.agent/PLANNER_HANDOFF.md`
6. this file
7. `openspec/changes/hardening-6-repair-trust/proposal.md`
8. `openspec/changes/hardening-6-repair-trust/design.md`
9. every H6 spec delta
10. `openspec/changes/hardening-6-repair-trust/AUDIT-BASELINE.md`
11. `openspec/changes/hardening-6-repair-trust/tasks.md`

Also inspect the live implementation/tests and latest 30 meaningful commits. Never implement solely from planner prose.

## Highest-risk invariants

- No repair is RESOLVED unless reproducer + masking + regression have positive successful execution evidence.
- Adapter/environment/cancel/deadline/unknown/zero-work is never clean.
- Required repair evidence is durable before resolution.
- Accepted patch application is exact-revision, clean-target, and all-or-nothing.
- Rejected patch attempts leave no ignored/untracked contamination.
- Returned adapter action/observation identity matches controller identity exactly.
- Declared artifact evidence cannot disappear through silent filtering.
- Audit inventory cannot self-promote files to REVIEWED.

Red-test confirmed behavior before production changes. For REPRO REQUIRED items, prove reachability/blast radius first.

## Work queue

Execute `tasks.md` in order:

- H6.0 baseline + audit mechanism correction
- H6.1 positive-evidence repair semantics
- H6.2 durable repair completion + safe atomic apply + attempt isolation
- H6.3 core correlation + artifact integrity
- H6.4 protocol boundary validation
- H6.5 durable corruption matrix
- H6.6 every-file semantic review + system maps
- H6.7 mutation/property/fault/soak
- H6.8 reconciliation + exact-tree local/hosted certification

Rebalance time when necessary, but do not spend campaign budget on cosmetic refactors while correctness/safety/audit/certification work remains.

## Every-file requirement

The H5 audit is not sufficient for H6. The planner proved:
- exact baseline tree = 536 tracked blobs;
- H5 audit = 534 rows;
- two H5 workflow tests are absent;
- the audit generator hashes content but marks R from pathname/category.

Build a replacement H6 ledger separating inventory from semantic review. Every final authored blob requires current exact hash + genuine content/behavior review basis. A changed blob invalidates stale review evidence. Add a mechanical repo-contract gate for missing/stale coverage.

Review all systems, not only repair: protocol, SDK, fake/web/CLI/Android/Windows/Electron/iOS boundaries, core policy/run control, store/artifacts, explore/oracle/finding/reproduction/minimization/repair, workflows/fleet/scheduler/budgets/leases/settlement, model runtime, CLI, packaging, CI, dogfood, docs/specs/state/OpenSpec/tool configs.

## Verification rules

Never:
- map execution failure to clean/fixed/success;
- accept zero executed work as proof;
- weaken/delete tests to close a defect;
- silently substitute real/mock/injectable provenance;
- overwrite historical H1-H5 ledgers;
- force-push;
- publish/tag/release;
- claim hosted success from queued/skipped required jobs.

Run targeted tests continuously, then on the exact final tree:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @inspector/adapter-web provision:browser
pnpm test:integration
pnpm release:smoke
```

Plus H6 mutation/property/fault tests and available real-platform/source-vs-installed proofs.

## Checkpoint and Git discipline

After each coherent verified phase:
1. update H6 tasks, defect ledger, campaign state, checkpoint, and audit evidence;
2. commit complete evidence;
3. fetch/reconcile origin without discarding concurrent work;
4. push `main` without force;
5. continue immediately.

At final implementation SHA, query Actions by exact SHA and inspect every required job/step. H6 stays ACTIVE if certification is pending, red, or required execution was skipped.

## Completion

Mark HARDENING_6 COMPLETE only when:
- every Critical/High H6 defect is CLOSED with deterministic regression evidence;
- suspicions are reproduced/fixed or explicitly resolved-not-reproducible with lower-layer proof;
- 100% of final authored tracked blobs have valid exact-blob semantic review evidence;
- full local gate passes on exact implementation tree;
- exact pushed SHA passes required Linux, Windows, Electron Xvfb, and installed-artifact hosted lanes;
- durable truth surfaces agree;
- M13 remains COMPLETE, M8 remains DEFERRED_ENVIRONMENT, and no release/tag/publication occurred.

Then commit the final detailed report and push it. If a gate remains unresolved, record it and continue every independent task rather than falsely completing.
