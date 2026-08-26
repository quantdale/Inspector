# Delta — Replay Backend Provenance

## Purpose

Make durable replay reproduce the environment that produced the evidence rather than whichever backend happens to be available on the current host.

## Requirements

### Requirement: replay identity includes behavior-affecting backend provenance

For any adapter family with materially different real/mock/injectable execution modes, durable run/environment/evidence provenance MUST record the backend mode needed to reconstruct replay behavior.

At minimum audit Electron (`real`/`injectable`), Windows/UIA (`real`/`mock`), CLI/PTTY seams, and Android real/mock/injected seams.

### Requirement: durable replay never silently changes backend

Verify, regress, reproduction, minimization, and resume MUST NOT select a different backend from the durable producer provenance merely because the current machine has different capabilities.

#### Scenario: real Electron producer on host without Electron runtime

Given a finding produced with Electron backend `real`, when replay runs on a host that cannot execute that real backend, Inspector returns a typed environment/capability failure. It MUST NOT auto-fallback to `injectable` and MUST NOT use that fallback to classify the finding fixed/clean/rejected.

#### Scenario: injectable Electron fixture

Given durable provenance explicitly recording `injectable`, replay may use the injectable backend and must label resulting evidence as injectable, never as a real-runtime proof.

### Requirement: missing backend provenance fails closed unless migration is unambiguous

Older records that lack backend mode may be migrated only when the original backend can be derived from durable historical facts without consulting mutable current-host availability. Otherwise replay is rejected as incompatible/indeterminate with an operator-visible reason.

### Requirement: provenance disagreement is detected before semantic classification

Adapter id, backend mode, target/create options, revision, and evidence bundle provenance MUST be checked before replay results can affect finding lifecycle or regression cleanliness.

### Requirement: campaign/source references preserve producer identity

`sourceItemId` resolution may select a retained producer workspace only when its finding/run/environment/bundle provenance forms one internally consistent chain. A newer attempt does not automatically supersede an older producer if it does not contain the referenced finding or matching provenance.

## Test obligations

Create a family/backend matrix plus negative fixtures for missing mode, malformed mode, mode disagreement, changed host capabilities, missing executable/display/device, and stale source workspace. Include at least one real Electron/Xvfb campaign proof and one Windows campaign-level proof when hosted environments support them; otherwise record a precise environment deferral instead of substituting a mock as field proof.

### Requirement: backend mode parsing is exact and family-specific

For every family whose behavior changes by backend, replay construction MUST validate the durable mode against an explicit allowed-value set. Missing or unknown values MUST NOT silently map through truthy/default branches to mock, real, injectable, or auto.

#### Scenario: Electron backend mode missing
- GIVEN an Electron finding whose durable spawn provenance does not identify `real` or `injectable`
- WHEN replay/verify/regress is requested
- THEN the workflow MUST return a typed incompatible/indeterminate provenance result unless a historical migration proves the original backend
- AND MUST NOT instantiate Electron replay in `auto`.

#### Scenario: CLI backend mode missing
- GIVEN a CLI/PTTY finding whose durable backend mode is absent or malformed
- WHEN replay is requested
- THEN the workflow MUST NOT infer mock merely because the value is not exactly `real`.

#### Scenario: Android backend mode missing
- GIVEN an Android finding whose durable backend mode is absent or malformed
- WHEN replay is requested
- THEN the workflow MUST NOT infer real merely because the value is not exactly `mock`.

#### Scenario: Windows backend mode missing
- GIVEN a Windows/UIA finding whose durable backend mode is absent or malformed
- WHEN replay is requested
- THEN the workflow MUST NOT construct a default/auto backend whose behavior depends on current-host capability.

### Requirement: capability evidence strength and replay provenance agree

When mock/injectable execution is intentionally selected, durable provenance and campaign evidence MUST say so. Such evidence MAY prove deterministic workflow semantics but MUST NOT satisfy a requirement for real platform field execution. Real-backend findings MUST replay only with the corresponding real backend or fail with an honest environment/provenance result.

