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
