# Durable Corruption and Repair-State Integrity — Spec Delta

## ADDED Requirements

### Requirement: Durable corruption cannot weaken evidence
Malformed durable fields that influence repair, replay, outcome reconstruction, artifact attribution, or finding lifecycle SHALL be rejected/quarantined or proven unreachable by a validated lower-layer invariant.

A catch-and-default path SHALL NOT erase evidence/provenance when the erasure could change a correctness or safety conclusion.

### Requirement: Corruption hypotheses are evidence-driven
Suspected corruption paths SHALL receive deterministic raw-row/file fault tests before behavior is changed. Non-reproducible suspicions SHALL be documented with the exact guard that prevents reachability rather than mislabeled as fixed.
