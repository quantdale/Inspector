# Specification 007 — Task Graph

## S0 — Worker isolation and concurrency

- [x] Bounded parallel workers (`UnattendedCampaign` worker pool) with exclusive durable leases per work item; two workers can never hold the same item.
- [x] Per-item isolated environments (own store/artifacts/fake-adapter state machine) — no cross-worker contamination.
- [x] Controller restart recovery: durable queue/lease/executions state re-read on restart; completed items never re-executed; in-flight items safely reclaimed.

## S1 — Repository map and impact signals

- [x] Covered by `@inspector/repair` SourceContextBuilder (hint-ranked file selection) from M4; campaign-level impact hints feed exploration scoring weights (extension point retained).

## S2 — Model abstraction/routing

- [x] Provider-neutral `ModelRouter`: roles (planner/summarizer/repairer), priority ordering, health filtering, fallback down the list, escalation when all fail. No core workflow depends on a vendor.

## S3 — Cost/resource accounting

- [x] `ResourceLedger`: model requests/tokens/cost/actions/resets/artifact bytes with deterministic global and per-worker budget projection; charges refused once budgets would be exceeded or after stop.

## S4 — Finding clustering

- [x] `FindingClusterer`: stable signature over oracle ids + normalized error text; first finding canonical; every member keeps run/worker provenance.

## S5 — Scheduling/campaign execution

- [x] Deterministic priority-ordered queue, bounded unattended modes (hunt/regression/repair item kinds), clean stop draining, checkpoint/restart via atomic state files.

## S6 — External integration facade

- [x] `InspectorFacade`: MCP-compatible request/response methods (campaign.status/findings.list/usage.summary/adapters.list/campaign.stop); read-only views plus cooperative stop; unknown/mutating methods rejected — external clients cannot bypass policy or mutate durable state.

## S7 — Plugin/adapter developer experience

- [x] `AdapterRegistry`: registration with version + conformance status, protocol-compatible discovery, incompatibility report (compatibility matrix).
- [x] Conformance runner published in `@inspector/adapter-sdk` (runCommonConformance, M6); example adapters are the platform packages themselves.

## S8 — Multi-worker proving campaign

- [x] Two isolated workers execute four bounded items against seeded fake targets; controller restart injected; no duplicate execution of completed items; consolidated report (executions, findings, clusters, usage, restarts).

## Acceptance (all passing)

- concurrent workers cannot mutate each other's environments/worktrees;
- controller restart resumes or safely classifies in-flight work;
- global and per-worker budgets are deterministic;
- model routing failure falls back/escalates according to policy;
- MCP/external calls map through the same policy/action contracts;
- duplicate findings cluster without losing evidence provenance;
- long bounded campaign terminates/restarts cleanly.

Gate: M7 exit gate satisfied — bounded multi-worker unattended campaign survives controller restart, preserves durable evidence/state, accounts for resources, and exposes a stable integration facade.
