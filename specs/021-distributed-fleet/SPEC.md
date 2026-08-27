# SPEC-021 — Distributed Fleet: Lease Backend Abstraction

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M21
Depends on: M12, M13

## Objective

Abstract the campaign/fleet lease and coordination backend behind a pluggable interface so that `memory`, `SQLite`, and `file` backends are interchangeable with proven parity, and an optional `Redis` backend can be added later without requiring any external service for single-host operation. Prepare the codebase for future multi-host distribution without mandating it.

Core principle: **single-host stays simple; distribution stays optional.** No new external dependency is required to run, test, or ship Inspector after this milestone.

## Invariants

- Single-host operation remains the default with zero external services required. A fresh install with no configuration runs entirely on local backends.
- Generation fencing is preserved across all backends: stale workers/completions remain fenced; fencing semantics are identical regardless of backend selection.
- Lease semantics are backend-agnostic: TTL, renewal, expiration, and ownership behave identically across `memory`, `SQLite`, and `file` backends.
- No external service (Redis or otherwise) is required to pass any gate, test, or smoke check. Redis, when introduced, is strictly optional and off by default.
- Existing campaign/lease/budget/restart guarantees from M12 are not weakened: queueing, priorities, budgets, cancellation, resume, and durable accounting remain correct on every backend.
- Configuration is explicit and validated before any work starts; invalid backend selection fails closed with a stable, actionable error.

## Workstreams

### F0 — Lease backend abstraction

Introduce a `LeaseBackend` (or equivalent) interface in `@inspector/scale` (or the owning scale/fleet package) that captures the current lease store contract: acquire, renew, release, expire, generation check, and fencing. Extract the existing inline lease logic behind the interface. Provide three first-class implementations:

- `memory` — in-process, for tests and ephemeral use.
- `SQLite` — durable local store (existing SQLite path, now behind the interface).
- `file` — file-system-backed coordination suitable for single-host multi-process without a database server.

Each backend is selectable via configuration; default remains the current single-host durable path (SQLite or equivalent — document the chosen default and keep it stable). No Redis implementation is required in this milestone; the interface must be shaped so a future Redis backend is additive.

### F1 — Parity test suite

Add a backend-parity test harness that runs the same lease/fencing/renewal/expiration/budget/restart behavioral suite against all three backends. Coverage includes:

- Lease acquire/renew/release lifecycle and TTL expiration.
- Generation fencing: stale completion fencing, fencing after worker loss, fencing across backend restarts.
- Concurrent workers under leases (at least two workers) with deterministic outcomes per backend.
- Restart/recovery: controller restart while leases are held, stale lease reclamation, no duplicate completions.
- Budget and cancellation interaction with leased work (no silent budget reset across backends).

Parity tests are deterministic and credential-free; they run in CI on every backend without external services.

### F2 — Configuration and selection

Add explicit configuration for backend selection (CLI flag and/or campaign manifest/config file — choose one canonical surface and document it). Requirements:

- Valid values: `memory`, `sqlite`, `file` (names finalized in implementation; aliases are not required). `redis` may be accepted as a forward-compatible value that currently fails with a clear "not yet implemented — no external service required" message, or be rejected as invalid — either is acceptable if documented and tested.
- Validation is deterministic and fails before any work starts; invalid backend values produce a stable error classification.
- Effective backend is observable (e.g., `campaign show`, doctor/status, or startup log) without leaking secrets/paths beyond what is already exposed.
- No environment variable or config is required for the default path; default is documented and stable.

### F3 — Documentation and interface readiness for Redis

- Document the backend abstraction, the three supported backends, their intended use cases, and the non-requirement of Redis/external services.
- Record an ADR (or extension) describing the interface shape, why Redis is optional, and what a future Redis backend must implement to satisfy the contract (including fencing and TTL guarantees).
- Update `ARCHITECTURE.md` / `DEVELOPMENT.md` / relevant operator docs to reflect the pluggable backend and configuration surface.
- Ensure the interface is exercised enough that a future Redis backend is a new implementation file plus wiring — no refactoring of call sites.

## Exit gate

On the exact final tree:

- Parity tests are green on all three backends (`memory`, `SQLite`, `file`); no backend-specific skip except where explicitly justified and documented.
- No regression in existing campaign/fleet gates: queueing, leases, budgets, fencing, restart matrix, and `release:smoke` remain green.
- `lint` (0 errors), `typecheck` PASS, `unit` PASS, `integration` PASS (or the subset that covers fleet/campaign/lease paths if full integration is environment-gated — truthfully recorded).
- No external service required to achieve the gate; CI passes without Redis.
- Docs and durable state (spec status, roadmap/STATUS if applicable) are consistent with the implementation.

## Non-goals

- Implementing the Redis backend itself — interface readiness only; Redis remains optional and out of scope for this milestone's implementation.
- Multi-host deployment, service discovery, or distributed consensus beyond lease fencing.
- Cloud control plane, hosted SaaS, dashboard redesign, or scheduler/queue rewrite beyond the backend abstraction.
- Performance optimization beyond parity correctness; no new performance budgets in this milestone.
- Publication, tag, release, or deployment.

## Durable-state transition on completion

When the exit gate passes at a known revision, mark M21 COMPLETE in durable state (campaign.yaml / checkpoint) with evidence (parity suite revision, gate results), and activate the next roadmap spec per the next-spec rule.
