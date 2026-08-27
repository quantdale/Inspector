# Repair Attempt Isolation — Spec Delta

## ADDED Requirements

### Requirement: Each attempt starts from the certified base
Before a patch proposal is applied, its disposable workspace SHALL match the exact certified revision plus explicitly declared fixture state.

### Requirement: Rollback removes ignored contamination
Rejected/aborted attempts SHALL NOT leave ignored or untracked files, directories, generated config, or build inputs capable of changing a later attempt.

#### Scenario: rejected patch writes ignored config
Given a repository whose `.gitignore` ignores a behavior-affecting file, when attempt 1 creates that file and is rejected, attempt 2 SHALL observe the same baseline as attempt 1 did before modification.

### Requirement: Operator checkout is never cleaned destructively
Any aggressive cleanup needed to establish attempt isolation SHALL be restricted to Inspector-created disposable worktrees.
