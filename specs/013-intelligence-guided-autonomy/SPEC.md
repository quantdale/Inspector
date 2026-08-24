# SPEC-013 — Intelligence-Guided Autonomous QA: Model Runtime, Deliberate Exploration, Semantic Reasoning, Source-Aware Diagnosis, and Safe Repair Assistance

Status: ACTIVE
Milestone: M13
Depends on: SPEC-003, SPEC-004, SPEC-007, SPEC-009, SPEC-010, SPEC-011, SPEC-012 (incl. HARDENING_2)

## Objective

Connect Inspector's intentionally incomplete intelligence seams into one
coherent, provider-neutral **model runtime** that can optionally improve
exploration decisions, weak semantic reasoning, context compression, source
diagnosis, and repair proposals — while every existing deterministic,
safety, policy, evidence, budget, replay, restart, and isolation guarantee
stays intact and authoritative.

Core principle: **models propose; Inspector validates.** Evidence and policy
remain more authoritative than model opinion. Offline/no-provider operation
remains first-class and byte-for-byte deterministic.

## Product contract

```text
exploration planner ─┐
semantic suspicion ──┤
summarization ───────┼── @inspector/model-runtime ── provider(s) ── usage/budget/attribution/persistence
source diagnosis ────┤
repair proposals ────┘
```

Every model-assisted path terminates in the SAME gates as deterministic work:

```text
model suggestion → schema validation → inventory/capability validation
→ policy check → budget admission → execution → evidence → reproduction
→ oracle confirmation
```

## Invariants

- A configured planner may select ONLY actions that already exist in the
  exact current legal action inventory; it can never synthesize coordinates,
  shell commands, URLs, or any actuator outside the adapter contract.
- Model-only suspicion can never confirm a defect or authorize repair;
  `classifySuspicion` semantics are unchanged (no hard-oracle corroboration ⇒
  NEEDS_HUMAN_ORACLE regardless of claimed confidence).
- Budget permission precedes model resource consumption. Token/cost ceilings
  use durable bounded reservations; concurrent workers cannot collectively
  oversubscribe a shared ceiling; unknown-outcome crash windows settle
  conservatively (never silently refunded to zero).
- Raw prompts/responses are never persisted by default: durable model-call
  records carry hashes, bounded redacted metadata, attribution, usage truth
  (unknown stays unknown), and failure classification.
- Target-controlled freeform text is untrusted data everywhere it flows:
  context packets are versioned, bounded, redacted, and injection-inert.
- No model provider is required for any existing command; with no provider
  configured there are zero external calls and negligible overhead.
- Discovery permission never becomes repair permission; campaign repair
  remains unsupported (ADR-0012); repair proposals are accepted only by the
  existing verification pipeline in an isolated worktree.
- The exploration RNG is never perturbed by model activity; deterministic
  fallback sequences for a fixed seed are unchanged when suggestions fail or
  are rejected.

## Workstreams

### F0 — Baseline audit and activation

Fresh code-level audit of the intelligence seams (router consumers, planner
seam, ledger admission, checkpoint persistence, provider loading, migration
pattern), baseline gates on the exact starting tree, this spec/task graph,
roadmap entry, durable-state activation, and the architecture ADR.

### F1/F2 — Model runtime boundary and invocation contract

New lowest-level package `@inspector/model-runtime` (zero workspace deps):
provider contracts with rich metadata (id, model id, roles, priority, health,
modalities, estimation capability), roles (`planner | oracle | summarizer |
repairer` plus a vision capability path), typed request/result records with
run/campaign/item/finding/repair attribution, deadline+cancellation, usage
reporting where providers truthfully supply it, stable failure
classification (`no-provider`, `provider-unhealthy`, `budget-denied`,
`deadline`, `cancelled`, `transport-error`, `provider-error`,
`malformed-response`, `schema-invalid`, `unsupported-role`,
`unknown-after-crash`), deterministic fallback ordering, and response
validation hooks. Legacy `ModelRouter`/`ModelProvider`/`ModelRole` exports
from `@inspector/scale` remain import-compatible (re-export/adapter).

### F3 — Durable `model_calls` control plane

Additive SQLite migration (#12) plus Store APIs recording logical requests
and attempts with status lifecycle (`started|completed|failed|cancelled|
denied|unknown-after-crash`), full attribution ids, role/request class,
provider/model identity, truthful nullable usage/cost/latency, retry/fallback
position, request/response hashes, schema version, error classification, and
redacted safe metadata. No raw prompt/response persistence. Migration,
insert/read/list, concurrency, and invalid-data tests.

### F4/F5 — Pre-consumption budgets and crash-safe invocation

Durable reservation/settlement gate (scale-backed): atomic admit of
`maxModelRequests`/`maxTokens`/`maxCostUsd` across global/worker/item scopes
BEFORE invocation, settlement with actuals after, conservative conversion of
abandoned/stale reservations (TTL) into consumed truth, denial ⇒ zero
provider invocation, retry/fallback counted as consumption. Stable
request/attempt ids; started rows persisted before external inference;
completed planner decisions reused after restart; fault-injection tests at
every boundary.

### F6 — Typed bounded context packets

Versioned deterministic packet builders (planner / oracle / repair-diagnosis)
with canonical opaque action ids, byte ceilings, truncation metadata, packet
hash, reuse of established freeform-text redaction, and prompt-injection
inertness (adversarial strings remain data, never instructions).

### F7 — Goal-directed model-assisted exploration

Optional semantic planner behind the existing `Planner` seam in
`ExploreController`: stall/near-tie/cadence activation policy (never per
action), strict structured output validated against the exact usable
inventory + autonomy eligibility + risk ceiling + rejection/toxic sets,
rejected-suggestion memory, deterministic fallback on every failure class,
checkpoint-persisted accepted decision + cadence state, resume without
duplicate calls or duplicated actions, no RNG contamination.

### F8 — Model-assisted semantic suspicion

Model-backed evaluator implementing the weak semantic-suspicion contract:
bounded evidence packet in, structured verdict out, disposition through
`classifySuspicion` (model-only ⇒ NEEDS_HUMAN_ORACLE), results recorded as
soft provenance without touching confirmation policy. Hallucination,
confidence-1.0, malformed, missing-evidence, injection, provider-loss, and
budget-exhaustion cases covered; false-positive safety outranks impressiveness.

### F9/F10 — Source/change intelligence and better repair context

Deterministic source-ranking layer over tracked files: error/log tokens,
UI selectors, evidence-referenced paths, explicit preferred paths, cheap
import-proximity, nearby-test candidates, workspace boundaries, optional
explicitly-known comparison base (never invented), prior attempts. Output:
ranked candidates with reasons, bounded slices, truncation metadata.
`SourceContextBuilder` upgraded onto it; repair packets stay bounded,
auditable, and containment-respecting.

### F11 + F22 — Provider-neutral PatchAgent and end-to-end repair proof

`ModelPatchAgent implements PatchAgent` around the existing RepairEngine:
bounded repair packet in, strict whole-file patch JSON out, structural
validation (repo-relative paths, no traversal/absolute/symlink escape via the
established containment resolver, file/byte caps, forbidden-path policy),
proposal-only semantics. Deterministic E2E fixture proves
confirmed-finding → isolated worktree → failing regression → model patch →
policy validation → rebuild/replay/regression → RESOLVED with untouched
primary checkout, plus rejection cases (incorrect/masking/out-of-scope).

### F12 — Bounded summarization memory

Session-scoped summarizer producing versioned, hashed, provenance-carrying
digests of older history/hypotheses/suspicions/attempts as derived cache only;
corrupt/absent summaries degrade to deterministic structured state.

### F13–F17 — CLI configuration, shared loading, workflow/campaign wiring

Operator flags (`--model-provider <module>`, `--planner`, `--semantic-oracle`,
`--model-max-requests|--model-max-tokens|--model-max-cost|--model-timeout`),
truthful `doctor` reporting, no credential storage/printing, stable additive
JSON. One reusable local-module loader (ESM/CJS, shape validation, redacted
errors, documented trust boundary). Both CLI and campaign execution flow
through the same shared exploration service with an optional model runtime;
campaign items attribute model calls (campaign/item/worker/run) and settle
through ExecutionContext budget admission; two-worker concurrency proofs.
Capability tags distinguish model-capable workers; required-model items
refuse honestly rather than fake assistance. Aggregate model observability in
machine outputs plus a bounded `models` inspection surface.

### F18–F21 — Deterministic test provider, acceptance fixture, adversarial and property coverage

Scripted provider simulating valid/invalid outputs, errors, timeouts,
cancellation, health flips, fallback, known/unknown usage, delay, and fault
boundaries — CI stays credential-free. Acceptance fixture proves a scripted
planner reaches a seeded anomaly through legal underexplored actions fewer
actions than deterministic fallback, while disabled-mode sequences stay
byte-stable. Adversarial suite: prompt injection, action fabrication, risk
escalation, context overflow, patch traversal/tamper, secret leakage,
confidence spoofing. Property/fault coverage: out-of-inventory impossibility,
nonnegative accounting, concurrency ceilings, deterministic fallback order,
unique ids, bounded packets, deterministic redaction, honest restart
settlement.

### F23 — Restart/resume integration matrix

Fault-injected boundaries: before admission, after admission before call,
during call, after result before persistence, after persistence before
decision, after decision before action, after action before checkpoint. At
least one fresh-controller persisted resume proves no duplicated target
action, no hidden overspend, no lost accepted decision, no duplicate findings,
no corrupt checkpoints.

### F24/F25 — Observability and cost discipline

Aggregate model statistics (requests, successes, failures, fallbacks,
accepted/rejected suggestions, tokens/cost where known, latency, denials,
suspicions) in machine views; detailed history stays queryable in the store;
`--json` remains additive/versioned. No-provider runs make zero external
calls with negligible overhead; planner cadence bounded; measured packet
bytes/calls-per-action in fixtures.

### F26 — Installed-artifact validation

Release smoke extended: no-model default commands launch, model help/config
present, a local deterministic provider module loads from the installed
prefix, malformed provider config fails with stable classification, no
workspace-path leakage, packaged content assertions hold.

### F27 — Documentation and durable state synchronization

MODEL-ROUTING, ARCHITECTURE, SECURITY-MODEL, AUTONOMY-MODEL, OBSERVABILITY,
EXPLORATION-ENGINE, ORACLE-SYSTEM, PRODUCT, DEVELOPMENT, README, STATUS,
ROADMAP, spec/tasks, campaign.yaml, CHECKPOINT.md reconciled with the final
implementation; ADR(s) recorded for material decisions.

## Exit gate

On the exact final tree: frozen install, lint (0 errors), typecheck PASS,
unit PASS, integration PASS, `release:smoke` PASS — with all new suites
credential-free and green, restart matrix proven, docs/state consistent, and
M13 marked COMPLETE in durable state only after the gate truly passes. No
tag/release/publication. Real external providers are NOT required; if one is
available and explicitly authorized, a bounded smoke may be recorded but is
not a prerequisite.

## Non-goals

Cloud control plane, distributed queues, hosted SaaS, dashboard redesign,
iOS runtime without macOS/Xcode, RL, bespoke/fine-tuned/vision models,
vector databases, generalized RAG, new browser engine, scheduler/lease
rewrite, campaign repair, auto-push after repair, deployment/publication,
unrelated broad fuzz campaigns, wholesale monorepo refactor.
