# Specification 004 — Task Graph

## O0 — Oracle SDK

- [x] Composable `OracleSuite` aggregating single-result oracles and metamorphic relations into weighted, auditable verdicts (`@inspector/oracle`).
- [x] Invariant/persistence/structural candidate oracles with strength ("hard"/"soft") and confidence metadata.

## O1 — Weak-signal handling

- [x] Suspicion signals (llm/vision/heuristic) classified by `classifySuspicion`: without hard-oracle corroboration they are held at NEEDS_HUMAN_ORACLE regardless of self-reported confidence.
- [x] Suspicion-derived oracle entries capped at soft strength / ≤0.5 confidence; repair engine policy-blocks non-CONFIRMED findings from source mutation.

## P0 — Repair workspace

- [x] `RepairWorkspace`: detached git worktree at the exact finding revision, created outside the primary checkout; refuses dirty repositories; rollback restores the exact revision; dispose removes the worktree.

## P1 — Source context

- [x] `SourceContextBuilder`: ranks tracked files by error-text/selector hint overlap and packs a byte-bounded context packet for the patch agent.

## P2 — Regression-first repair

- [x] `RegressionGenerator`: materializes a deterministic regression scenario from the minimized reproducer, persists it as an artifact in the workspace, and proves it FAILS pre-patch before any modification is allowed.

## P3 — Patch agent contract

- [x] `PatchAgent` interface with bounded context (`PatchContext`), whole-file patches, and `PatchBudget` limiting attempts.
- [x] `ScriptedPatchAgent` provides the deterministic M4 proof loop; model-driven agents implement the same contract under the same gates. Patch attempts are persisted separately from findings as repair-record JSON artifacts.

## P4 — Verification

- [x] Exact replay of the minimized reproducer against the patched target must NOT fire the oracle suite.
- [x] Masking probe: a benign action flow must keep working post-patch (catches patches that "fix" bugs by destroying functionality).
- [x] Post-patch regression gate: the materialized scenario must PASS.

## P5 — Resolution

- [x] RESOLVED only when replay + masking probe + regression all pass; rejected patches are rolled back to the exact revision and preserved in the audit trail with reasons; budget exhaustion leaves the finding CONFIRMED (unpatched).

## Acceptance (all passing)

- weak semantic suspicion alone cannot silently justify source mutation under default policy;
- repair occurs outside the primary checkout (fixture repo stays clean);
- failing seeded bug regression exists before/with patch;
- bad patch is automatically rejected and rolled back;
- good patch passes exact replay and targeted regression;
- at least one hidden seeded defect completes DISCOVERED -> CONFIRMED -> PATCHING -> VERIFYING -> RESOLVED without manual debugging.

Gate: M4 exit gate satisfied — seeded defect completes the full autonomous discover/reproduce/minimize/repair/retest loop with auditable evidence and no policy bypass.
