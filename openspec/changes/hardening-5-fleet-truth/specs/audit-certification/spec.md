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

### Requirement: Reviewed means content-reviewed, not path-classified
A repository-wide review certificate MUST distinguish path inventory from content review. Tooling MAY mechanically enumerate tracked paths and classify file kinds, but MUST NOT mark authored content `reviewed` solely from pathname, extension, directory, or file existence.

#### Scenario: Census generator sees a new authored file
- GIVEN a newly tracked source, test, specification, configuration, lockfile, or documentation blob
- WHEN the inventory generator runs
- THEN the file MUST enter the inventory with its exact blob/content hash
- AND its review state MUST remain UNREVIEWED until a content-aware review operation records evidence
- AND changing the blob MUST invalidate review evidence bound to the older blob.

#### Scenario: Path-only self-attestation
- GIVEN a generator whose classification function returns `R` without reading/reviewing file content
- WHEN audit certification is validated
- THEN certification MUST fail
- AND a balanced tracked/reviewed arithmetic count alone MUST NOT satisfy the every-file requirement.

### Requirement: Dependency resolution inputs are authored audit surfaces
Tracked lockfiles and package/workspace manifests affect executable dependency resolution and MUST be inventoried and reviewed as configuration/dependency inputs; they are not silently treated as untracked build output.

#### Scenario: pnpm lockfile is tracked
- GIVEN `pnpm-lock.yaml` appears in `git ls-files`
- WHEN the H5 audit is generated
- THEN it MUST be accounted for explicitly
- AND audit prose MUST NOT claim lockfiles are untracked.

### Requirement: Audit evidence is reproducible on the final tree
The final H5 report MUST permit another executor to verify which exact blobs were reviewed and which findings/system-map conclusions came from that review. At minimum each authored inventory entry MUST bind review status to its blob/content hash and a content-aware review basis; runtime-significant files MUST additionally map to the relevant behavior/system review.

#### Scenario: Planner or executor changes an already-reviewed file
- GIVEN file `X` was reviewed at blob A
- WHEN a later commit changes `X` to blob B before certification
- THEN blob A's review record MUST NOT certify blob B
- AND blob B MUST be reviewed or explicitly justified before the final every-file gate can pass.

