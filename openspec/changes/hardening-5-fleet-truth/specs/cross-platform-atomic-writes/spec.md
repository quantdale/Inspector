# Cross-Platform Atomic Writes — Delta Specification

## ADDED Requirements

### Requirement: Atomic writers have explicit failure semantics
Every tracked temp-plus-rename writer used by Inspector control state, workflow/CLI metadata, evidence/artifacts, or repair outputs MUST have a documented artifact-class durability contract and MUST fail loudly without exposing a partially written destination.

#### Scenario: Rename fails permanently
- GIVEN an atomic writer has completed its unique temporary file
- AND destination rename fails with a non-transient error or exhausts bounded retry
- WHEN the write returns
- THEN it MUST report the original/typed failure
- AND MUST NOT claim success
- AND the previous valid destination, if any, MUST not be silently truncated/corrupted.

### Requirement: Windows transient sharing conflicts are bounded
Where deterministic evidence shows Windows sharing violations can transiently block an otherwise valid rename, the writer MUST use a bounded retry policy restricted to the proven transient error class.

#### Scenario: Temporary Windows sharing violation clears
- GIVEN a destination rename receives a proven transient sharing error for a bounded interval
- WHEN the retry budget has not expired
- THEN the writer MAY retry with bounded backoff
- AND MUST eventually commit exactly once if the conflict clears
- AND MUST clean only its own temporary file.

#### Scenario: Permission/path error is not retried indefinitely
- GIVEN rename fails because of a semantic permission/path/configuration error outside the transient-sharing classification
- WHEN the writer handles the error
- THEN it MUST fail promptly
- AND MUST NOT disguise the defect as a sharing retry.

### Requirement: Temporary files have unique ownership
Concurrent writers MUST use uniquely owned temporary paths, and readers/orphan sweeps MUST NOT remove a live writer's temporary file.

#### Scenario: Reader races writer
- GIVEN a writer is staging a unique temporary file
- WHEN a concurrent reader or orphan cleanup runs
- THEN the live temp MUST remain owned by the writer
- AND the reader MUST observe either the previous committed value or the newly committed value, never an incomplete staged payload.

### Requirement: Durability claims match the implementation
Inspector MUST distinguish process-crash atomicity from stronger power-loss/filesystem durability. Parent-directory fsync or equivalent MUST be used where the declared artifact class requires it and the platform supports it; unsupported guarantees MUST be documented rather than implied.

#### Scenario: Durable control-plane state on POSIX
- GIVEN a control-plane state write is documented as durable across process crash and rename
- WHEN the implementation requires directory metadata persistence for that claim
- THEN the commit path MUST perform the required directory sync best-effort/required semantics defined by the contract
- AND tests/docs MUST describe any platform limitation honestly.
