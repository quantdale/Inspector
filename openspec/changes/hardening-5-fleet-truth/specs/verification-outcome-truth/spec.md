# Delta — Verification Outcome Truth

## Purpose

Prevent Inspector from interpreting inability to execute/replay as evidence that a defect is fixed, clean, or rejected.

## Requirements

### Requirement: replay attempts have explicit dispositions

A replay-consuming workflow MUST preserve enough information to distinguish at least:

- target defect reproduced;
- valid clean replay completed;
- environment/adapter execution failure;
- invalid/incompatible provenance;
- cancellation or budget refusal.

A boolean `reproduced: false` MUST NOT represent all of these states.

#### Scenario: adapter crashes before oracle evaluation

Given a confirmed finding and a valid minimized reproducer, when the replay driver throws because the adapter/environment fails before a valid replay result exists, then the attempt is operationally indeterminate and MUST NOT be recorded as clean/fixed/rejected evidence.

### Requirement: resolving a confirmed finding requires positive clean verification

A `CONFIRMED` finding may transition to `RESOLVED` only when the configured verification policy receives sufficient successfully executed, environment-valid replay attempts whose oracle evaluation is clean.

#### Scenario: every verification attempt times out

When every verify attempt ends in timeout/environment failure, the workflow reports a typed environment/indeterminate result and the finding remains unresolved.

#### Scenario: valid clean verification

When the required number of attempts execute successfully against matching provenance and all required oracle checks are clean, the finding may transition to `RESOLVED` with a transition reason that names the verification evidence.

### Requirement: rejection requires valid non-reproduction evidence

A reproduction pipeline MUST NOT transition a candidate to `REJECTED` solely because successful reproductions equal zero if all attempts errored, timed out, were cancelled, or never executed.

#### Scenario: timeout-only reproduction

Given N configured attempts and a replay driver that times out on all N, then stats preserve N errors and the finding remains in a non-terminal/indeterminate lifecycle state permitted by the final design; it is not `REJECTED`.

#### Scenario: completed clean non-reproduction

Given valid completed attempts with clean oracle outcomes and no environment failures, the configured rejection policy may transition the candidate to `REJECTED`.

### Requirement: regression clean counts only executed clean scenarios

Regression aggregation MUST keep reproduced, clean, environment-failed, incompatible, cancelled, and not-executed counts distinct. A replay exception MUST NOT increment clean. A run with zero valid executed scenarios MUST NOT return a semantic clean-success result.

### Requirement: cancellation and budget refusal are non-evidence

Cancellation, lease loss, and budget refusal MUST NOT mutate finding lifecycle toward `RESOLVED`/`REJECTED` and MUST NOT increment clean regression counts.

### Requirement: budget permission precedes consumption

Campaign verify/regress MUST obtain scheduler permission through `ExecutionContext.admit` before each budgeted replay unit and MUST charge actual consumption through `ExecutionContext.charge` according to the existing execution contract. A denied admission invokes no replay driver.

## Test obligations

Use deterministic fixtures for all-error, all-clean, all-reproduced, mixed clean/error/reproduced, timeout, cancellation, provenance failure, and budget-denial matrices. Include mutation-sensitive tests proving that mapping an error to clean/fixed/rejected makes the suite fail.
