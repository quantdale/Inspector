# Repair Verification Truth — Spec Delta

## ADDED Requirements

### Requirement: Clean repair conclusions require positive execution evidence
A post-patch reproducer, masking probe, or regression is clean only when all required replay work executed successfully in a compatible environment and the expected hard defect oracle did not fire.

Adapter crash, cancellation, deadline, unknown outcome, unresolved automation, driver error, or zero-work SHALL NOT count as clean.

#### Scenario: operational failure after patch
Given a CONFIRMED finding and candidate patch, when post-patch replay is operationally indeterminate, the patch SHALL NOT be accepted and the finding SHALL NOT become RESOLVED.

### Requirement: Masking probe requires successful benign behavior
A masking probe survives only if every required action successfully executes and no disallowed hard oracle fires. Operational failure is not survival.

### Requirement: Pre-patch regression proof is execution-valid
Repair may proceed only when the expected defect is reproduced by a valid executed replay. Environment failure SHALL NOT be labeled “no failing regression”.

### Requirement: Regression provenance is truthful
Generated regression artifacts SHALL carry the actual adapter/backend/target provenance. Non-web repairs SHALL NOT be serialized as `adapter-web` by default.
