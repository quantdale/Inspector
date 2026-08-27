# SPEC-016 — OpenTelemetry Observability: Trace and Metrics Export

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M16
Depends on: M13 (SPEC-013)

## Objective

Add an OpenTelemetry-compatible observability export for Inspector runs that
emits traces and metrics as local JSON files without requiring an external
collector or network access. Every run's lifecycle — exploration steps,
oracle evaluations, model invocations, budgets, and finding outcomes — is
projected into OTel trace spans and metric points that can be consumed by
standard OTel tooling offline.

The exporter is file-based and additive: existing run artifacts, evidence,
and SQLite durability remain authoritative and unchanged. OTel data is a
derived, best-effort projection for external analysis, not a second source
of truth.

## Invariants

- No external network required: the default and only required exporter writes
  to the local filesystem (JSON file exporter); no collector, OTLP endpoint,
  or outbound HTTP/gRPC is needed for the milestone to be complete.
- Traces are derived, not authoritative: OTel spans are a read-only
  projection of durable run state (steps, actions, oracle verdicts, model
  calls); replay, evidence, policy, budget, and finding provenance remain
  authoritative in SQLite/artifacts.
- No secret leakage: spans, attributes, metrics, and resource fields never
  contain raw secrets, credentials, tokens, or unredacted prompts/responses;
  existing redaction and safe-metadata rules apply end-to-end.
- Additive and off-by-default-safe: when OTel export is disabled or fails,
  run execution, determinism, budgets, and exit codes are unaffected; export
  errors are bounded, logged, and never fail the run.
- Deterministic redaction and bounded size: span attributes and metric
  labels are bounded, deterministically redacted, and stable for a fixed
  run; unbounded target-controlled text is truncated/hashed, never embedded
  verbatim.

## Workstreams

### F0 — Trace schema

Define the OTel trace schema for Inspector runs: resource attributes
(service.name, inspector version, run/campaign ids), span hierarchy
(run → exploration step / oracle evaluation / model call), status and
kind mapping, attribute naming and bounds, redaction rules, and JSON
serialization shape compatible with OTel JSON (traces). Document the
schema and its versioning policy. No exporter logic in this workstream
beyond the type/schema definition and serialization helpers.

### F1 — File exporter

Implement a JSON file exporter that writes OTel-compatible trace payloads
to a run-scoped file (e.g., `artifacts/otel/traces.json` or
`otel-traces.json` alongside the run directory). Covers lifecycle
(open/flush/close), atomic write/append, bounded buffering, error
handling (never fails the run), opt-in configuration (`--otel-traces`
or env/config flag), and validation that the written file is valid JSON
and structurally conforms to the expected OTel trace document. No
external collector or network path.

### F2 — Metrics

Define and export run-scoped metrics as OTel-compatible JSON (metrics):
counters/gauges/histograms for exploration actions, oracle verdicts,
model request/usage/cost (where known), budget denials, wall time, and
finding counts. Metrics share resource attributes and redaction/bounding
rules with traces, are written via the same file-exporter mechanism
(separate file or combined document), and are additive/derived only.
No authoritative accounting is moved off SQLite.

### F3 — Docs

Update docs to describe the OTel file export: what is exported, what is
not, file locations and format, how to consume the JSON with OTel tooling,
redaction/bounding guarantees, and that no network or collector is
required. Reconcile README / ARCHITECTURE / OBSERVABILITY / campaign.yaml
/ CHECKPOINT.md / ROADMAP as needed for M16 scope. No behavior change
beyond documentation.

## Exit gate

- File exporter writes valid JSON that conforms to the defined OTel trace
  (and metrics) schema for at least one real run (fake-adapter run is
  sufficient); the output file is parseable and schema-valid.
- Full gate green on the exact final tree: lint (0 errors), typecheck
  PASS, unit PASS, integration PASS, `release:smoke` PASS — new suites
  credential-free and deterministic.
- Docs updated (OTel export scope, file format/location, consumption,
  guarantees).
- M16 marked COMPLETE in durable state only after the gate truly passes.

## Non-goals

- External OTLP collector, OTLP/HTTP/gRPC transport, or hosted SaaS.
- Cloud control plane, distributed queues, dashboard redesign.
- Vision models, bespoke/fine-tuned models, vector DB / RAG, RL.
- Scheduler/lease rewrite, campaign repair, deployment/publication,
  wholesale refactor, new browser engine.
