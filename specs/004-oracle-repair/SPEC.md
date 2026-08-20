# Specification 004 — Oracle Expansion and Autonomous Repair

## Status

PENDING

## Objective

Prove the full Inspector loop from autonomous discovery through isolated source repair and regression verification.

## Dependencies

Specs 000–003 COMPLETE.

## Task groups

### O0 — Oracle SDK

Define composable invariant, metamorphic, differential, visual-structural, persistence, and semantic candidate oracles with strength/confidence metadata.

### O1 — Weak-signal handling

Allow vision/LLM semantic suspicion to create or enrich candidates, but require corroboration or explicitly configured human-oracle status before destructive repair.

### P0 — Repair workspace

Create exact-revision Git worktrees/disposable checkouts with provenance, cleanliness checks, rollback, and source-write policy enforcement.

### P1 — Source context

Build a compact repository map/context selector linking evidence, stack traces, UI semantics, changed code, tests, and likely ownership files.

### P2 — Regression-first repair

Generate or materialize a deterministic failing regression test/scenario from the minimized reproducer whenever feasible before source modification.

### P3 — Patch agent contract

Provide bounded repair context, allowed paths/capabilities, acceptance gate, and patch budget. Persist patch attempts separately from findings.

### P4 — Verification

Build/test, replay exact minimized reproducer, run relevant regression suite, reject patches that mask the oracle or weaken tests, and record before/after evidence.

### P5 — Resolution

Mark `RESOLVED` only when the original oracle no longer fails under replay and required regression gates pass. Preserve rejected attempts for audit.

## Acceptance tests

- weak semantic suspicion alone cannot silently justify source mutation under default policy;
- repair occurs outside the primary checkout;
- failing seeded bug regression exists before/with patch;
- bad patch is automatically rejected and rolled back;
- good patch passes exact replay and targeted regression;
- at least one hidden seeded defect completes DISCOVERED -> CONFIRMED -> PATCHING -> VERIFYING -> RESOLVED without manual debugging.

## Exit gate

One or more seeded defects complete the full autonomous discover/reproduce/minimize/repair/retest loop with auditable evidence and no policy bypass.

## Completion transition

Set M4 COMPLETE, activate Spec 005/M5, and continue.
