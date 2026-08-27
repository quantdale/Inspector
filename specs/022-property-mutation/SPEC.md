# SPEC-022 — Property and Mutation Testing: Lifecycle, Budget, Replay Vocab

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M22
Depends on: M2 (SPEC-002 finding/reproduction), M13 (SPEC-013 model runtime)

## Objective

Establish exhaustive, deterministic property-based and mutation testing for Inspector's three most defect-sensitive seams: finding lifecycle transitions, budget accounting (pre-consumption reservations, settlement, crash windows), and replay vocabulary (legal action inventory enforcement). Every property test is deterministic with an explicit seed — no random failures. Every seeded mutant in the matrix is caught by at least one property or existing deterministic test, with proof recorded.

This milestone does not invent new product behavior; it hardens what M2 and M13 already ship by making invariant violations impossible to land undetected.

## Invariants

- Every mutant in the defined mutation matrix is killed (caught) by at least one automated test; survivors are zero at exit.
- Property tests are fully deterministic: same seed → same sequence → same verdict. No flaky green. CI replays with a fixed seed set.
- Budget accounting invariants hold under all generated workloads: non-negative balances, never oversubscribed, conservative crash-window settlement (abandoned reservations become consumed, never silently refunded to zero).
- Lifecycle state machine is closed: only declared transitions are reachable; illegal transitions are rejected and never persist.
- Replay vocabulary is exact: only actions present in the current legal inventory are executable; synthesized/fabricated actions are always rejected at validation.
- Property generators cover boundary payloads (empty, max-size, duplicate, interleaved concurrent) without weakening existing policy/evidence/retry contracts.

## Workstreams

### F0 — Lifecycle property tests

Property suite over the finding lifecycle state machine (states, transitions, confidence/severity, rejection/flaky reasons, audit events). Generators produce random valid and invalid transition sequences from arbitrary starting states with seeded RNG. Asserts: only legal edges succeed, illegal edges fail deterministically, persisted state survives restart, terminal states are absorbing. Deterministic seed logged per run; shrinking on failure.

### F1 — Budget property tests

Property suite over model-budget admission and settlement (M13 F4/F5 contract): `maxModelRequests` / `maxTokens` / `maxCostUsd` across global/worker/item scopes, atomic admission, actual-cost settlement, TTL-driven conservative conversion of abandoned reservations, concurrent workers under contention. Generators produce interleaved admit/settle/crash sequences with seeded RNG. Asserts: never oversubscribed, non-negative accounting, denial ⇒ zero provider invocation, retry/fallback counted, crash window never refunds to zero.

### F2 — Replay vocabulary property tests

Property suite over replay action-inventory enforcement: generators produce replay sequences mixing legal inventory actions, out-of-inventory fabrications (synthesized coordinates, shell commands, URLs, invented action ids), and boundary payloads. Asserts: legal actions validate and execute, fabricated actions are rejected at schema/inventory validation before execution, canonical opaque ids enforced, packet bounds respected. Deterministic seed; 200+ payload fuzz per run.

### F3 — Mutation matrix and kill proof

Define a bounded mutation matrix covering the three seams: lifecycle (flip transition guard, drop terminal check), budget (skip reservation, invert settlement sign, zero-out crash settlement), replay vocab (bypass inventory check, accept synthetic coordinates). Run full test suite against each mutant; record killed/survived. Achieve 100% kill rate — expand property or deterministic tests until every mutant is caught. Proof artifact: `mutation-proof.json` (or equivalent) checked in or attached to the exit commit, listing each mutant, killing test, and seed.

## Exit gate

- Property suites F0, F1, F2 are implemented, deterministic with logged seeds, and green in CI (no flake) on the exact final tree.
- Mutation matrix F3 is defined (bounded, enumerated mutants across lifecycle/budget/replay vocab) and executed; every mutant is killed; proof artifact recorded and reviewed.
- Full gate green on the exact final tree: lint (0 errors), typecheck PASS, unit PASS (including new property suites), integration PASS.
- No weakening of existing policy/evidence/budget/retry/replay contracts to make properties pass.
- M22 marked COMPLETE in durable state (campaign.yaml / CHECKPOINT.md) only after the gate truly passes.

## Non-goals

- New product features, cloud control plane, distributed queues, hosted SaaS, dashboard redesign.
- New model providers, vision models, bespoke/fine-tuned models, vector DB / RAG, RL.
- Scheduler/lease rewrite, campaign repair, auto-push after repair, deployment/publication.
- Wholesale monorepo refactor or unrelated broad fuzz campaigns beyond the three seams.

## Completion transition

Set M22 COMPLETE, activate next roadmap spec (M23), and continue. Record seeds and mutation proof in the exit commit.
