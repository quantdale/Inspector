# Audit Certification — Delta Specification

## ADDED Requirements

### Requirement: Hardening every-file claims are mechanically accounted
A HARDENING_5 completion report that claims repository-wide review MUST derive an inventory from the exact Git tracked-file set and account for every tracked file as reviewed authored content or an explicitly justified non-authored/generated exclusion.

#### Scenario: Audit census closes
- GIVEN the final H5 commit tree
- WHEN the audit inventory is reconciled with `git ls-files`
- THEN the reported tracked count MUST equal reviewed authored files plus justified exclusions
- AND no tracked path may be silently omitted
- AND exclusions MUST state why code/content review is not applicable.

### Requirement: Major systems receive behavior-path review
For runtime-significant files, the audit MUST cover relevant happy path, invalid input, failure, cancellation/timeout, crash/restart, concurrency, corruption, environment loss, and installed-artifact behavior rather than only file names or superficial lint.

#### Scenario: Platform orchestration file is reviewed
- GIVEN a file maps campaign adapter families to runtime behavior
- WHEN it is audited
- THEN reviewers MUST trace its callers and downstream durable effects
- AND compare its vocabulary/semantics with validation, routing, spawn, replay, tests, and docs.

### Requirement: Completion is exact-tree certified
H5 MUST NOT be marked complete from local results or CI results belonging to an older commit. The exact pushed implementation SHA must pass the intended hosted lanes and those lanes must actually execute their critical steps.

#### Scenario: State-sync commit follows a certified implementation commit
- GIVEN a final implementation SHA has green hosted CI
- WHEN a later documentation/state-only commit records that result
- THEN the record MUST explicitly identify which SHA was certified
- AND MUST not imply the new documentation SHA is self-certified without querying its own run.

### Requirement: Current truth is reconciled without rewriting history
Current status/debt/agent/OpenSpec state MUST reflect the actual H5 result, while historical milestone/campaign evidence remains preserved as historical evidence.

#### Scenario: Electron availability statement is stale
- GIVEN an older report states real Electron proof was unavailable on its host
- AND a later hosted Xvfb run proves real Electron execution
- WHEN current status is updated
- THEN the historical report MUST remain intact
- AND current debt/status MUST distinguish the old host limitation from present hosted capability.
