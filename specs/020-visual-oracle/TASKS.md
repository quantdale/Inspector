# SPEC-020 Task Graph — Visual Oracle

Checkboxes flip only when the task's gate actually passes.

- [x] F0 pHash impl — pure-TypeScript perceptual hash (`perceptualHash`, `hammingDistance`, `isNearDuplicate`) with fixed-grid downscale + DCT/block-hash; deterministic hex/bigint output; unit tests green (determinism, near-duplicate tolerance, distinct separation, thresholds, corrupt/empty input).
- [x] F1 Visual oracle — `VisualOracle` implementing the oracle contract with `strength: soft`, `confidence ≤ 0.5`, distance/threshold provenance; never confirms alone; `classifySuspicion` keeps visual-only findings at `NEEDS_HUMAN_ORACLE`; repair policy-block preserved; tests green (soft-only, confidence cap, skipped on missing baseline, distance 0 idempotence).
- [x] F2 Integration with fingerprint/evidence — baseline hash captured alongside state fingerprint/evidence (additive, backward-compatible); comparison flow via oracle suite/suspicion pipeline with fixture PNG pairs; artifact provenance (hash/distance/threshold) recorded without new large-binary store; integration fixtures green (visual-only stays unconfirmed, hard+visual preserves confirmation).
- [x] F3 Docs — `ORACLE-SYSTEM`/`ARCHITECTURE`/`EXPLORATION-ENGINE` and operator docs updated (algorithm, hash format, thresholds, weak-oracle guarantee); `campaign.yaml`/`CHECKPOINT.md`/`ROADMAP` reconciled for M20.

## Exit checklist

- pHash tests green and deterministic across reruns.
- Visual oracle never confirms alone (`NEEDS_HUMAN_ORACLE` without hard corroboration; repair blocked).
- Full gate green on the exact final tree (lint/typecheck/unit/integration/release:smoke) with docs/state consistent.
- M20 marked COMPLETE in durable state only after the gate truly passes.
