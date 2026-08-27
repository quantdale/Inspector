# SPEC-017 Task Graph — Operator Dashboard (Static HTML Evidence Report)

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Report schema and data contract — define `inspector-report/1` view-model, sections/sort/caps, redaction and input-exclusion contract, versioning, and empty/large-DB behavior; document DB tables and bundle files read.
- [x] F1 Static HTML generator — implement read-only SQLite + bundle scan → validated view-model → deterministic bounded `report.html` (summary, findings, runs/steps, evidence index) with HTML escaping, path sanitization, truncation, and self-contained offline styling; no server, no mutation, no secrets.
- [x] F2 CLI flag and wiring — expose `inspector report --db <path> --out <path>` (additive, documented), default paths, stable `--json` (`inspector-cli/report/1`) and exit codes, read-only failure handling; no scheduler/repair side effects.
- [x] F3 Documentation and acceptance fixture — reconcile ARCHITECTURE/OBSERVABILITY/README/ROADMAP, add deterministic seeded-DB fixture proving HTML contains findings/runs/evidence links, file:// offline, DB untouched, and no secret leakage; exit gate green (lint/typecheck/unit/integration).

## Exit checklist

- Generator produces valid static HTML from `runs.db` + bundles with findings, run summaries, and evidence links; opens via `file://` with no server.
- Source DB/bundles untouched (hash/mtime unchanged); no secrets in output.
- Lint 0 errors, typecheck PASS, unit PASS, integration PASS; docs/state consistent.
