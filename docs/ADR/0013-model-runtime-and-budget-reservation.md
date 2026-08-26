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

## HARDENING_3 amendment (2026-08-25)

Two additive contract clarifications, applied together with their tests:

1. **Failure taxonomy additions.** `ModelFailureClass` gains
   `"budget-gate-error"` (the configured gate threw during admission —
   fail-closed, no invocation, no assumed reservation) and
   `"model-store-error"` (the durable sink could not persist the `started`
   row — fail-closed BEFORE external inference, reservation converted
   conservatively). Both are terminal for the request: infrastructure faults
   are not retried across providers and can never become unaccounted spend.
   `ModelRuntimeStats` gains `storeErrors` for terminal `finish()`
   persistence failures that cannot corrupt an already-decided outcome.

2. **Untrusted-number boundary.** Estimates and provider-reported usage are
   hostile input. Values that are not finite and non-negative (token counts:
   safe integers after ceiling) are treated as ABSENT, steering admission to
   conservative defaults and settlement to conservative conversion. NaN,
   ±Infinity, negative, and unsafe-magnitude values can therefore never
   poison holds, fabricate refunds, create headroom, fail a ceiling open, or
   produce unloadable durable state; the state validator's finite checks were
   aligned accordingly.

## Amendment (HARDENING_4, 2026-08-25): aggregate stat semantics pinned

H4.6's dependent audit found the aggregate `ModelRuntimeStats.fallbacksUsed`
counter counted every failed ATTEMPT, including terminal failures on the
last candidate where no fallback ever occurred (a cancelled single-provider
call reported `fallbacksUsed: 1`) — diverging from the per-attempt
`ModelAttemptInfo.fallbacksUsed` array, which correctly lists providers
fallen back FROM before the outcome.

Resolved by pinning exact per-field contracts in `types.ts` and the runtime:

- `requests` = logical invoke() calls; `attempts` = provider attempts begun
  (pre-invocation refusals — denials, gate/store errors, no-provider — are
  not attempts); `completed` = validated successes returned to the caller;
  `failed` = attempts that raced a provider and lost (terminal response
  validation failures are not here; they remain in `failuresByClass`).
- `fallbacksUsed` counts REAL transitions to the next candidate only.
- `denials`, `storeErrors`, `failuresByClass` unchanged in meaning but now
  documented at the type.

No counter consumer existed outside the runtime and its tests, so no call
sites changed; regression coverage pins the transition-only fallback count,
the zero-fallback terminal case, and exhaustion reporting.
