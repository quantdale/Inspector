# SPEC-021 Task Graph — Distributed Fleet: Lease Backend Abstraction

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Lease backend abstraction — introduce `LeaseBackend` interface in `@inspector/scale` (acquire/renew/release/expire/generation/fencing), extract existing lease logic behind it, ship `memory`, `SQLite`, and `file` implementations; single-host default unchanged; generation fencing preserved.
- [x] F1 Backend parity test suite — deterministic parity harness exercising lease lifecycle, TTL, fencing, concurrent workers (≥2), restart/recovery, and budget/cancellation interactions identically across `memory`, `SQLite`, and `file`; green without external services.
- [x] F2 Backend configuration and selection — explicit `memory|sqlite|file` selection via CLI/manifest (documented canonical surface), deterministic validation before work starts, stable error for invalid/unsupported values, effective backend observable.
- [x] F3 Documentation and Redis readiness — document abstraction and backends, record ADR for interface shape and optional-Redis strategy, update ARCHITECTURE/DEVELOPMENT/operator docs; interface proven additive for a future Redis backend.

## Exit checklist

- Parity tests green on all three backends; no unjustified backend-specific skips.
- No regression: queueing, leases, budgets, fencing, restart matrix, and `release:smoke` remain green.
- Gates on final tree: `lint` 0 errors, `typecheck` PASS, `unit` PASS, `integration` PASS (or truthfully recorded subset); no external service required.
- Docs/state consistent; M21 marked COMPLETE only after gate truly passes.
