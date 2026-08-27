# Repair Durability and Application Safety — Spec Delta

## ADDED Requirements

### Requirement: Resolution requires durable evidence
Inspector SHALL NOT make a finding durably RESOLVED until all required repair and regression evidence has been materialized outside the disposable worktree and persisted successfully.

#### Scenario: evidence persistence fails
When a candidate patch verifies but a required evidence copy/write/atomic commit fails, repair SHALL NOT expose a durable RESOLVED conclusion.

#### Scenario: crash between verification and state commit
After restart, state SHALL be consistent with durable evidence. RESOLVED without the required proof record is forbidden.

### Requirement: Accepted-patch application is provenance-bound
Before modifying a target checkout, Inspector SHALL prove that the target is an authorized Git checkout at the certified repair revision and satisfies cleanliness/preimage policy. Wrong-revision, dirty, non-Git, or provenance-ambiguous targets SHALL be refused before the first write.

### Requirement: Accepted-patch application is atomic
A multi-file accepted patch SHALL apply all-or-nothing. If any write fails, every earlier modification/creation from that application SHALL be rolled back and the application result SHALL record rollback truth.

### Requirement: Rejected attempts leave no hidden filesystem state
Every repair attempt SHALL start from the exact certified base plus intentional fixtures only. Rejected attempts SHALL NOT leave untracked or ignored files that influence a later attempt. Destructive cleanup is confined to Inspector's disposable repair worktree.
