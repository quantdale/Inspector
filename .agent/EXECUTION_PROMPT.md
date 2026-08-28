# Inspector Execution Prompt — HARDENING_6 (post-M23 rebase)

**Status:** COMPLETE (2026-08-28; implementation SHA `8b00f69697596872073d490538e8722688ab41b1`, hosted run `33142638356` SUCCESS)
**Campaign:** HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity  
**Mode:** HARDENING  
**Target branch:** `main` only  
**Original H6 baseline:** `038550172866001ce8bfe44054b8146b3391af32`  
**Current planner baseline:** `8e6bdb0e7951505972fd59bce550d3ad330d0c22` (rebased onto `main@bcd2c91`)
**Current baseline hosted CI:** run `33092343085` SUCCESS on exact baseline SHA  
**OpenSpec change:** `openspec/changes/hardening-6-repair-trust/`  
**Current audit:** `.inspector/state/HARDENING_6-AUDIT.md` (candidate exact-blob inventory; semantic ledger `.inspector/state/HARDENING_6-SEMANTIC-REVIEW.json`)
**Execution envelope:** approximately 12 hours of productive autonomous work; do not stop at the first green patch.

## One-shot objective
Pull the latest `main`, rehydrate durable state, rebase the audit if HEAD advanced, then execute HARDENING_6 to closure. Preserve M0-M23 history (with M8 explicitly deferred), close the confirmed repair/core/protocol trust defects, prove or dismiss the remaining reproductions, perform a genuine exact-blob semantic review of every final authored file, run mutation/fault/soak proof, pass exact-tree local gates, push verified commits without force, and require exact-SHA hosted certification before declaring COMPLETE.

Do not ask for routine approval. Continue to the next unblocked task automatically. Do not create M24 while H6 is active.

## Read first
1. `.inspector/state/campaign.yaml`
2. `.inspector/state/CHECKPOINT.md`
3. `AGENTS.md`
4. `docs/HARDENING-CAMPAIGN.md`
5. `.agent/PLANNER_HANDOFF.md`
6. this file
7. `.inspector/state/HARDENING_6-AUDIT.md`
8. `openspec/changes/hardening-6-repair-trust/proposal.md`
9. `openspec/changes/hardening-6-repair-trust/design.md`
10. every H6 spec delta
11. `openspec/changes/hardening-6-repair-trust/AUDIT-BASELINE.md` (historical activation evidence)
12. `openspec/changes/hardening-6-repair-trust/tasks.md`
13. M14-M23 specs/tasks and current implementation delta

Also inspect the live implementation/tests and latest 30 meaningful commits. Never implement solely from planner prose.

## Highest-risk invariants
- No repair is `RESOLVED` unless reproducer + masking + regression have positive successful execution evidence.
- Adapter/environment/cancel/deadline/unknown/zero-work is never clean.
- Required repair evidence is durable before resolution.
- Accepted patch application is exact-revision, clean/preimage-validated, and all-or-nothing.
- Rejected patch attempts leave no ignored/untracked contamination.
- Returned adapter action/observation identity matches controller identity exactly.
- Declared artifact evidence cannot disappear through silent filtering.
- Audit inventory cannot self-promote files to REVIEWED.

Red-test confirmed behavior before production changes. For REPRO REQUIRED items, prove reachability/blast radius first.

## Work queue
H6.0-H6.8 are complete and evidenced on the implementation tree:
positive repair evidence, durable resolution/atomic application/isolation, core
correlation/artifact integrity, protocol validation, durable-corruption
negative space, exact-blob semantic review, and mutation/fault/soak proof.
H6.8 reconciliation and exact-tree certification passed. Hosted run
`33142638356` is SUCCESS for the exact implementation SHA; the final state-sync
commit is subject to the anti-circular hosted check described below.

Rebalance time when necessary, but do not spend campaign budget on cosmetic refactors while correctness/safety/audit/certification work remains.

## Every-file requirement
The original H5/H6 activation audit is not sufficient. The candidate ledger is
generated from the final tracked tree, including post-activation M14-M23
additions. Every final authored blob requires current exact hash + genuine
content/behavior review basis. A changed blob invalidates stale review evidence.
The repo-contract gate rejects missing, stale, generic, or extra review rows.

Review all systems, not only repair: protocol, SDK, fake/web/CLI/Android/Windows/Electron/iOS boundaries, core policy/run control, store/artifacts, explore/oracle/finding/reproduction/minimization/repair, workflows/fleet/scheduler/budgets/leases/settlement, model runtime, CLI, packaging, CI, dogfood, docs/specs/state/OpenSpec/tool configs.

## Verification rules
Never map execution failure to clean/fixed/success; accept zero executed work as proof; weaken/delete tests to close a defect; silently substitute real/mock/injectable provenance; overwrite historical ledgers; force-push; publish/tag/release; or claim hosted success from queued/skipped jobs.

On the exact final tree run:

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
After each coherent verified phase: update H6 tasks/defect ledger/campaign/checkpoint/audit evidence; commit complete evidence; fetch/reconcile origin without discarding concurrent work; push `main` without force; continue immediately.

At final implementation SHA, query Actions by exact SHA and inspect every required job/step. H6 stays ACTIVE if certification is pending, red, or required execution was skipped.

## Completion
Mark HARDENING_6 COMPLETE only when every release-blocking H6 defect is CLOSED with deterministic regression evidence; D8/D11 are fixed or dismissed with lower-layer proof; 100% of final authored tracked blobs have valid exact-blob semantic review evidence; full local gate passes; exact pushed SHA passes required Linux, Windows, Electron Xvfb, and installed-artifact hosted lanes; truth surfaces agree; M14-M23 remain COMPLETE; M8 remains `DEFERRED_ENVIRONMENT`; and no release/tag/publication occurred.
