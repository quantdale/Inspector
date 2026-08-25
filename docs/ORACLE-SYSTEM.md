# Oracle System

The hardest part of autonomous bug discovery is not acting; it is deciding **what counts as wrong**.

Inspector therefore models oracles explicitly and assigns evidence strength. The LLM is one oracle source, not the oracle.

## Oracle hierarchy

### Class A — Hard executable oracles

Highest confidence:

- process crash or unhandled exception
- assertion/test failure
- HTTP contract violation
- schema violation
- impossible database constraint/state
- explicit app invariant
- accessibility rule violation from a deterministic checker
- memory/resource threshold with defined budget
- target-specific error event

### Class B — Metamorphic/invariant oracles

Check relationships rather than exact outputs:

- save then reload preserves value
- adding then deleting returns to equivalent state
- sorting does not change item multiset
- retrying an idempotent action does not duplicate data
- offline failure must not report success
- switching tabs must not mutate unrelated state

### Class C — Differential oracles

Compare:

- old revision vs new revision
- browser/platform A vs B where behavior should match
- API result vs UI representation
- reference implementation vs target

Differences are candidates until expected divergence is ruled out.

### Class D — Historical/baseline oracles

Visual snapshot, performance baseline, accessibility tree snapshot, previously observed stable behavior. Useful but vulnerable to intentional product changes.

### Class E — Heuristic/semantic oracles

LLM or vision judgments such as clipped content, suspicious navigation, contradictory copy, likely dead controls, or unexpected layout. These generate candidates and investigation tasks, not automatic source changes by default.

M13 implements this class as an OPTIONAL model-backed evaluator
(`SemanticSuspector` in `@inspector/oracle`): a bounded evidence packet in,
a strict verdict out, disposition always through `classifySuspicion`.
Model-only suspicion stays `NEEDS_HUMAN_ORACLE` with confidence soft-capped
at 0.5 regardless of the model's claimed certainty; fabricated evidence refs
are dropped; malformed/deadline/denied evaluations degrade to UNEVALUATED.
Only hard-oracle corroboration can promote a suspicion to CANDIDATE — and
even then through the unchanged deterministic confirmation policy below.

## Oracle evaluation record

Every evaluation stores:

```text
oracle_id
oracle_class
subject
expected
observed
confidence
severity_hint
artifacts
explanation
version
```

## Confirmation policy

A candidate may become `CONFIRMED` when at least one configured rule succeeds. Example default:

- one Class A failure reproduced from clean state twice, or
- one Class B/C failure reproduced twice with stable state reset, or
- two independent weaker signals plus successful deterministic reproduction, or
- explicit developer-defined invariant fails once with no environment error.

LLM-only Class E claims remain candidates unless policy explicitly allows otherwise.

## Expected-behavior disambiguation

Before confirming surprising behavior, Inspector should search for evidence that it is intentional:

- existing tests/specs
- accessibility labels/tooltips
- route/schema definitions
- feature flags
- nearby source comments/docs
- previous baseline behavior
- product fixtures

If ambiguity remains, classify as `NEEDS_HUMAN_ORACLE` rather than inventing a product requirement.

## Oracle inference

Inspector can infer *proposed* invariants from repeated behavior, source code, schemas, and natural-language docs, but inferred invariants carry provenance and lower confidence until adopted.

Example:

```text
Observed 24 successful edits where save -> reload preserved field X.
Proposed invariant: persisted field X survives reload.
```

The proposal may guide exploration immediately but should not be treated identically to a developer-declared invariant.

## Flakiness

A failure that does not meet reproduction thresholds moves to `FLAKY` with a reproduction ratio and environment-correlation data. Flaky findings remain valuable; they are not silently discarded.
