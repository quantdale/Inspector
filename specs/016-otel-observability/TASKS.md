# SPEC-016 Task Graph — OpenTelemetry Observability

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Trace schema — OTel-compatible trace schema defined for runs (resource attributes, span hierarchy, status/kind mapping, bounded/redacted attributes, versioned JSON shape); serialization helpers and schema tests.
- [x] F1 File exporter — JSON file exporter writes valid OTel trace JSON to a run-scoped file (atomic/bounded, never fails the run, opt-in flag); output validated as parseable and schema-conformant.
- [x] F2 Metrics — OTel-compatible metrics (actions, oracle verdicts, model usage/cost, budgets, findings) defined and exported via file exporter with shared redaction/bounding; additive and derived only.
- [x] F3 Docs — OTel file export documented (scope, file locations/format, consumption, guarantees, no-network property); README/ARCHITECTURE/OBSERVABILITY/campaign.yaml/CHECKPOINT.md/ROADMAP reconciled.

## Exit checklist

- Exporter writes valid JSON conforming to the OTel trace/metrics schema on a real run.
- Full gate green on the exact final tree (lint/typecheck/test/test:integration/release:smoke).
- Docs/state agree; M16 COMPLETE recorded with exact evidence.
