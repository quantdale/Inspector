# Model Routing

Inspector exploits abundant inference without making every action an LLM decision — and without ever letting model opinion outrank evidence, policy, or budget truth (M13; ADR-0013).

## The model runtime boundary

All model access flows through `@inspector/model-runtime`, a provider-neutral
package with zero workspace dependencies:

- **Roles**: `planner | oracle | summarizer | repairer` plus a `vision`
  capability path. No vendor is hardcoded anywhere in product semantics.
- **Providers** declare metadata: id, model id, supported roles, priority
  (ties broken deterministically by id), health, modalities, estimation
  capability, timeout behavior, implementation version.
- **Invocation contract**: requests carry request ids, role, request class,
  attribution (`run/campaign/item/worker/finding/repair`), bounded context
  packets, expected response format (+ runtime schema validation hook),
  deadline, cancellation signal, and reservation references. Results carry
  text/structured output, truthful usage fields (unknown stays unknown —
  never zero-fabricated), latency, finish status, fallback position.
- **Failure taxonomy** (stable classifications): `no-provider`,
  `provider-unhealthy`, `budget-denied`, `deadline`, `cancelled`,
  `transport-error`, `provider-error`, `malformed-response`,
  `schema-invalid`, `unsupported-role`, `unknown-after-crash`.
- Transport/provider failures fall back down the priority list;
  malformed/schema-invalid responses are TERMINAL (retrying another provider
  cannot fix a contract violation and would only double-spend).
- Deadlines and cooperative cancellation are enforced by the runtime's own
  AbortController even against signal-ignoring providers; late resolutions
  after death are discarded and settled conservatively.

## Model roles

### Explorer planner

Consulted ONLY on ambiguity or stall by the web explorer
(`@inspector/explore`): near-tied top candidates or a novelty plateau, with a
cadence floor between calls and an absolute per-run cap. It may select ONLY
actions from the exact usable inventory offered in its packet — fabricated
keys are classified `unknown-action`, never executed. Every failure mode
falls back to deterministic selection without touching the exploration RNG:
with no provider configured, sequences are byte-for-byte identical to
pre-M13 runs for a fixed seed.

### Visual interpreter

Reserved as the `vision` role capability path. No built-in consumer requires
it; structured signals remain primary.

### Oracle reasoner

The optional `SemanticSuspector` evaluates bounded evidence packets for weak
semantic inconsistency. Its output flows through `classifySuspicion`
unchanged: **model-only suspicion is always NEEDS_HUMAN_ORACLE**, confidence
is soft-capped at 0.5 regardless of claimed values, fabricated evidence refs
are dropped, and only hard-oracle corroboration can produce CANDIDATE. It can
never confirm a defect or authorize repair.

### Diagnostician/repair model

`ModelPatchAgent` turns a bounded packet into whole-file patch PROPOSALS in
the existing Patch contract. Strict schema validation, repo-relative path
rules, forbidden segments (.git/.inspector/node_modules/dist/coverage), file
and byte caps apply before the RepairEngine sees anything — and the engine's
containment, test-tamper policy, masking probes, replay, and regression
verification remain the sole acceptance authority.

### Summarizer

`SessionSummarizer` compresses older session context into an advisory digest
on a refresh interval. A digest is a derived cache: failures keep the previous
value or null, and deterministic state always suffices alone.

## Budget-aware degradation (enforced, not advisory)

Budget permission precedes consumption. Every attempt reserves a conservative
upper bound through a durable gate (`ReservationModelBudgetGate`) against
global/worker/item `maxModelRequests|maxTokens|maxCostUsd` BEFORE invocation;
settlement replaces the hold with actuals afterwards. Unknown outcomes
(deadline/cancel/crash) convert holds to consumed truth — never silent
refunds. Cost-bounded gates without any estimate source refuse rather than
pretend the bound is enforceable. When budget runs out, optional planning and
suspicion degrade deterministically; confirmation and evidence integrity are
untouched.

## Durable provenance

Every attempt lands in the SQLite `model_calls` table (additive migration):
attribution ids, role/class, provider/model, status lifecycle including
`started` crash-window rows and `denied` admissions, nullable usage/cost/
latency, retry/fallback position, SHA-256 of packet and response, error
classification, redacted scalar metadata. Raw prompts/responses are NEVER
persisted. Inspect via `inspector models summary [--json]`.

## Context packets

Never feed the entire run transcript. Task-specific versioned packets are
deterministic JSON documents with byte ceilings enforced by shrinkage,
canonical opaque action ids, established freeform-text redaction applied to
target-controlled fields, and truncation metadata. Inspector instructions
live in a fixed preamble; all target-derived data stays inside the JSON DATA
BLOCK, so injection strings remain inert data by construction.

## Provider configuration

Providers are trusted operator configuration loaded from explicit local
modules (ESM/CJS) through one shared validated loader. A local module executes
inside the Inspector process — it is NOT sandboxed, and that is documented.
There is no path inference and no discovery of providers from target content.
Load errors are classified (`provider-load-failed`, `invalid-provider`) and
redacted.

CLI surface: `hunt/explore --model-provider <module> --planner
--semantic-oracle --summarize --model-max-requests --model-max-tokens
--model-timeout-ms --model-max-calls`. Campaign items receive model
assistance through executor configuration with scheduler-owned budget gates
and campaign/item/worker attribution. Without a provider configured there are
zero external calls, negligible overhead, and unchanged deterministic
behavior everywhere.

## Swarm design

Default to a single coordinator plus specialized workers, not many independent agents rediscovering the repo.

Good parallelism:

- isolated environments exploring different state regions
- independent reproducer confirmation
- static/source diagnosis parallel to runtime reproduction
- different repair candidates in separate worktrees

Bad parallelism:

- multiple agents mutating one worktree
- multiple planners clicking the same environment
- every worker rebuilding a full repository map from scratch
