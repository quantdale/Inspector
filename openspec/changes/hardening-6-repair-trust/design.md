# HARDENING_6 Design — Repair and Evidence Trust Boundaries

## 1. Positive execution evidence
Repair verification must not use boolean “oracle fired / did not fire” as a proxy for execution truth. Use a typed disposition (or equivalent) that distinguishes at least `reproduced`, `clean-executed`, `operational-failure`, `cancelled`, `incompatible`, and `not-executed`.

Only `clean-executed` may support “fixed”, “clean”, or masking-probe survival. `adapter-crash`, `cancelled`, `deadline-exceeded`, `unknown`, unresolved automation, driver exception, or zero-work are never clean evidence.

## 2. Repair state/evidence ordering
A finding must not become durably RESOLVED until required repair and regression evidence is durably committed outside the disposable worktree. Equivalent crash recovery is acceptable, but restart must never expose RESOLVED without its proof.

Best-effort persistence is allowed only for optional diagnostics, not evidence authorizing RESOLVED.

## 3. Accepted patch application
Before the first target write:
- target must be an authorized Git checkout (except a clearly separate test-only helper);
- target must satisfy cleanliness/preimage policy;
- target HEAD must equal the certified repair revision/worktree commit;
- all paths must pass lexical + realpath/reparse containment;
- the whole patch must be preflighted.

Application must be all-or-nothing. On failure, restore every touched/created path and record the rollback result.

## 4. Attempt isolation
Every attempt starts from the exact certified base. Current `git clean -fd` is insufficient because ignored files survive. In the disposable worktree, remove ignored/untracked state introduced by rejected attempts or use a fresh worktree per attempt. Never run destructive cleanup on the operator checkout.

## 5. Regression provenance
Regression artifacts must derive adapter/backend/target identity from the actual finding/provider. Remove the hard-coded `adapter-web` identity. Do not infer historical backend from current-host capability.

## 6. Core adapter correlation
Before accepting an outcome:
- outcome.actionId == submitted action.id;
- outcome.runId == controller run;
- outcome.environmentId == controller environment.

Before accepting an observation:
- observation.runId/environmentId match controller;
- controller-owned sequence/step attribution remains authoritative.

Mismatch is a protocol violation and creates no successful durable step.

## 7. Artifact integrity
Declared artifact refs must be syntactically valid, owned by the current run, resolvable, and integrity-checked where required before evidence is accepted. Missing/corrupt refs are evidence failures, not zero-byte artifacts.

## 8. Adapter server boundary
Validate the JSON-RPC invariants and params for initialize, observe, act, lifecycle, health, and cancel before handler invocation. Malformed notifications must not invoke handlers with fabricated defaults.

## 9. Audit certification
Separate:
- inventory: path/blob/category/exclusion;
- semantic review: exact blob + system map + findings/no-finding rationale;
- certification: mechanical 100% final-tree coverage and stale-hash rejection.

A generator may create UNREVIEWED rows. Reading/hashing/categorizing a file is not semantic review.

## 10. Governing invariant
Inability to execute, correlate, or preserve evidence is not evidence that software is correct.
