# ADR 0013 — Provider-neutral model runtime, durable call ledger, and reservation-based model budgets

Date: 2026-08-24
Status: Accepted (M13)
Supersedes: none

## Context

M7 introduced a minimal `ModelRouter` inside `@inspector/scale`
(`complete(role, input: string)`) that is exercised only by test harnesses.
Architecture documents promise more: planner/oracle/summarizer/repairer
roles, structured context packets, request/token/cost accounting, and
durable routing provenance. The exploration engine hardcodes `NoopPlanner`;
the weak semantic-suspicion contract has no model-backed evaluator; repair
has a `PatchAgent` seam but only scripted/external implementations;
`Budget.maxModelRequests|maxTokens|maxCostUsd` fields exist in the resource
ledger but nothing ever consumes them.

HARDENING_2 (ADR-0012) established the invariant that budget permission is
obtained BEFORE budgeted resources are consumed, with exact incremental
accounting. Model calls strain that invariant because final token/cost usage
is unknown until after a provider responds — and a provider response may be
charged even if Inspector dies before recording it.

## Decision

1. **New lowest-level package `@inspector/model-runtime`.** Provider
   contracts, role definitions (`planner | oracle | summarizer | repairer`
   plus a vision capability path), typed invocation records with
   run/campaign/item/finding/repair attribution, deadline/cancellation,
   truthful usage reporting (unknown stays unknown), stable failure
   classification, deterministic fallback ordering, and response validation
   hooks live there. It has zero workspace dependencies. Exploration, oracle,
   repair, workflows, and CLI consume it directly; none of them gains a
   dependency on `@inspector/scale` for model access. The legacy scale
   exports remain import-compatible via re-export/adapter so existing
   consumers do not break.

2. **Structured invocation, not strings.** Requests carry ids, role, request
   class, attribution, bounded context packets, expected response format,
   deadline, cancellation signal, and reservation references. Results carry
   text/structured output plus usage fields the provider truthfully supplied
   (nullable; never fabricated), latency, finish status, and fallback
   position. Failures classify stably (`no-provider`, `provider-unhealthy`,
   `budget-denied`, `deadline`, `cancelled`, `transport-error`,
   `provider-error`, `malformed-response`, `schema-invalid`,
   `unsupported-role`, `unknown-after-crash`).

3. **Durable `model_calls` control plane (additive SQLite migration).** Each
   logical request and attempt is persisted with status lifecycle
   (`started|completed|failed|cancelled|denied|unknown-after-crash`),
   attribution ids, provider/model identity, nullable usage/cost/latency,
   retry/fallback position, request/response hashes, schema version, error
   classification, and redacted safe metadata. Raw prompts/responses are NOT
   persisted by default. Started rows are written BEFORE external inference
   is attempted and are never erased on restart.

4. **Reservation-before-consumption budgets.** A durable reservation gate
   atomically admits each model call against global/worker/item
   `maxModelRequests/maxTokens/maxCostUsd` ceilings BEFORE invocation by
   reserving a conservative upper bound (estimate when available, configured
   default bound when not). Settlement replaces the reservation with actuals.
   Abandoned reservations (controller death, TTL expiry) settle CONSERVATIVELY
   as consumed — never silently refunded to zero — and surface as
   `unknown-after-crash`. Denied admission means zero provider invocation.
   Retries/fallbacks are separate admissions. Campaign executions obtain
   reservations through the scheduler-owned ExecutionContext so per-item and
   campaign-global ceilings stay atomic across concurrent workers.

5. **Planner/suspicion integration stays behind existing seams.** The
   semantic planner plugs into the existing explore `Planner` boundary, may
   propose ONLY actions from the exact current usable inventory, and every
   failure class degrades to deterministic selection without perturbing the
   exploration RNG. Semantic suspicion flows through `classifySuspicion`
   unchanged: model-only suspicion can never confirm a defect or authorize
   repair. Repair proposals flow through the existing PatchAgent → policy →
   verification pipeline; verification, not model confidence, accepts.

6. **Trusted operator configuration.** Local provider modules execute inside
   the Inspector process; they are trusted operator configuration, loaded
   through one shared validated loader (ESM/CJS, explicit factory/object
   forms, shape validation, redacted load errors). This trust boundary is
   documented; providers are not sandboxed.

## Consequences

- Existing no-provider behavior remains byte-for-byte deterministic with
  zero external calls and negligible overhead.
- Token/cost ceilings are genuinely enforceable under concurrency at the
  cost of a small durable reservation journal per workspace.
- Crash windows produce honest conservative accounting instead of free calls.
- Vendor logic stays out of core product semantics; adding a provider is a
  configuration/local-module concern.
