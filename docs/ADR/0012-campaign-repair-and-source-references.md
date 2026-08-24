# ADR 0012 — Campaign repair is operator-only; verify/regress source references

Date: 2026-08-24
Status: Accepted (HARDENING_2)
Supersedes: none (clarifies ADR-0011 and SPEC-012)

## Context

M12 left two campaign-surface contracts contradictory or incomplete:

1. **Repair**: manifest validation REQUIRED `repairAuthorized: true` for
   repair items, and then `InspectorWorkflowExecutor` policy-refused every
   repair item at runtime anyway. Configuration was accepted that could never
   execute. M11 P3 established the authoritative product repair path:
   operator-supervised `inspector repair <findingId>` with an explicitly
   configured provider, exact revision, detached worktree, and regression-first
   gates. No fleet-runtime provider plumbing exists, and building one is
   feature work, not hardening.
2. **Verify/regress provenance**: every campaign attempt receives a FRESH,
   isolated workspace. A verify or regress item therefore opened an empty item
   store with no mechanism to reach the durable finding/reproducer its producer
   committed — cross-item verification was structurally impossible despite
   being a declared M12 workflow.

## Decision

1. **Campaign repair is UNSUPPORTED — deliberately.** Repair remains
   operator-only. `validateWorkItem` now rejects any `workflow: repair` item at
   preflight with the stable issue code `repair-unsupported`, regardless of
   `repairAuthorized`. The legacy `repairAuthorized` field stays accepted in
   the work-item schema for compatibility but grants nothing. The executor's
   runtime policy-refusal remains as defense in depth. Discovery never implies
   repair; authorization is not weakened — it is made coherent.

2. **Narrow source references for verify/regress.** Items may declare
   `targetConfig.sourceItemId: <sibling item id>` (plus optional explicit
   `targetConfig.findingId`). Semantics:
   - Preflight (`validateCampaignManifest`) validates existence, self-reference,
     producer workflow (`hunt|explore` only), acyclicity, and requires
     `keepWorkspaces: true` so the referenced workspace actually persists.
   - The scheduler gates claiming on dependency truth: downstream items are
     claimed only after their source has a DURABLE execution record; if the
     source failed or was refused, downstream is refused durably with
     `target-incompatible`. No race can start downstream work early.
   - The executor resolves the source inside the campaign artifacts root only
     (sanitized id + resolved-prefix containment), deterministically selecting
     the newest attempt whose `.inspector/runs.db` exists. With a source
     reference and no explicit findingId, exactly one CONFIRMED finding is
     selected automatically; ambiguity is a deterministic configuration error.
   - Provenance records the resolved `sourceItemId` in result notes.

No DAG/dependency-graph system is introduced: single-parent references cover
the product need.

## Consequences

- Manifests fail fast on impossible configurations instead of accepting them.
- Cross-item verify/regress through campaigns works end-to-end with explicit,
  contained, validated provenance (deterministic tests prove hunt → verify).
- Terminal/refusal semantics distinguish all-refused campaigns from success;
  externally-held campaigns report blocked rather than false running.
- Settlement, lease liveness, budget permission, cancellation, wall-clock
  durability, and semantic state validation invariants introduced by
  HARDENING_2 are recorded in the hardening checkpoint ledger, not here.
