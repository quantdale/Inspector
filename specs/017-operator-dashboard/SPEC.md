# SPEC-017 — Operator Dashboard: Static HTML Evidence Report

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M17
Depends on: SPEC-011 (M11), SPEC-013 (M13)

## Objective

Provide a **static HTML evidence report generator** that renders a self-contained,
offline-viewable report from the durable Inspector data plane — `runs.db` (SQLite)
and evidence bundles — with no server, no runtime mutation, and no secret leakage.

The operator runs a single command and receives a portable `report.html` (plus
optional co-located assets) that summarizes runs, findings, evidence provenance,
and reproduction outcomes. The report is evidence-grade: every finding links to
its durable trace (run, steps, artifacts) and regenerated HTML never invents
state that is not present in the source DB/bundles.

Core principle: **read the truth, render the truth.** The generator is a pure
view over durable state; the state remains authoritative.

## Product contract

```text
runs.db (SQLite) ─┐
evidence bundles ─┼── report generator ── report.html (+ assets) ── file:// browser
finding records ──┘          │
                             └── no network, no server, no mutation
```

Input sources (all read-only):

- `runs.db` — runs, steps, actions, observations, findings, model_calls, checkpoints
- Evidence bundles / artifact store — screenshots, traces, logs referenced by runs
- Revision/provenance metadata already persisted alongside runs

Output:

- Single static `report.html` (self-contained or with a bounded `report_assets/` sibling)
- Deterministic for identical inputs; byte-stable ordering
- Opens via `file://` with no backend; no embedded server or JS fetch to localhost

## Invariants

- **Read-only.** The generator opens `runs.db` in read-only mode and never writes,
  migrates, or vacuums the database. Evidence bundles are read, never rewritten
  or moved. No durable state is mutated by report generation.
- **No mutation / no side effects.** Running the generator does not create runs,
  findings, checkpoints, or model-call rows; does not trigger exploration,
  replay, or repair; does not alter artifact staging.
- **No secrets in output.** Redaction applied at persistence time is preserved;
  raw prompts/responses, tokens, credentials, and unredacted freeform target
  text are never embedded. Report embeds only already-redacted fields, hashes,
  and bounded metadata. No credential flags or env values are printed.
- **Deterministic, bounded rendering.** Identical DB+bundle inputs yield
  identical HTML (stable sort, stable ids). Per-section caps (findings, steps,
  artifact links) prevent unbounded HTML growth; truncation is explicit and counted.
- **Offline, no server.** Output renders with `file://` and no network requests.
  No embedded HTTP server, no service worker, no remote fonts/scripts, no
  telemetry beacon.
- **Evidence fidelity.** Every rendered finding cites its durable identifiers
  (findingId, runId, revision, adapter family, oracle verdict) and links to
  its evidence bundle path. Missing or incompatible provenance is shown as such,
  never synthesized or hidden.
- **Safe paths.** Asset references are repo/workspace-relative and sanitized;
  no absolute host paths, no traversal (`..`), no symlink escape in emitted links.

## Workstreams

### F0 — Report schema and data contract

Define the report's logical schema: sections (summary, runs, findings,
reproduction/regression outcomes, evidence index), stable sort orders, caps and
truncation policy, redaction contract, and the JSON view-model that feeds the
HTML template. Version the schema (`inspector-report/1`) and document which
DB tables/columns and bundle files are read and which are explicitly excluded
(secrets, raw model prompts/responses). Include empty-state and large-input
behavior (e.g., >1k findings).

### F1 — Static HTML generator

Implement the pure generator: read-only SQLite queries + bundle index scan →
validated view-model → HTML emission. Features:

- Summary cards: run count, finding counts by disposition, adapter breakdown,
  time range, revision set
- Finding table/detail: id, oracle disposition, severity, minimized steps,
  provenance, linked artifacts (screenshots/traces) via relative paths
- Run/step drill-down with bounded step lists and explicit truncation notes
- Evidence index with bundle-path links and hash/size metadata where available
- Self-contained styling (inline or co-located CSS), no external dependencies,
  deterministic output, bounded memory even for large DBs
- Unit-tested HTML escaping, path sanitization, and truncation logic

Package location: new or existing `@inspector/*` utility (e.g.,
`@inspector/report` or `packages/report`) with zero runtime server deps.

### F2 — CLI flag and wiring

Expose the generator via the installed `inspector` CLI without mutating
existing commands:

- `inspector report --db <path> --out <path>` (or `inspector generate-report`);
  exact flag spelling finalized in F0, but must be additive and documented
- `--db` defaults to the workspace `runs.db`; `--out` defaults to
  `./inspector-report.html` (or `./report/report.html` with assets sibling)
- Stable exit codes: `0` success, `4` invalid args/missing DB, `1` internal error
- Machine-readable `--json` summary on stdout (schema `inspector-cli/report/1`)
  additive; human progress on stderr
- Read-only failure modes tested: missing DB, unreadable bundle, corrupt row,
  huge DB, empty DB

No new scheduler, no campaign mutation, no repair invocation.

### F3 — Documentation and acceptance fixture

Reconcile docs and provide the exit-gate proof:

- Update `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md` (or `docs/PRODUCT.md`),
  `README.md`, and `ROADMAP.md` with the report feature, its read-only and
  no-secrets guarantees, and usage examples
- Add a deterministic acceptance fixture that seeds a small `runs.db` + bundles
  (2 runs, 3 findings across dispositions, 1 reproduction outcome) and asserts
  the generator produces valid HTML containing expected finding ids, run ids,
  and artifact links, with no secret leakage and no DB mutation (mtime/hash
  unchanged)
- Document non-goals and durable-state transition (no migration)

## Acceptance tests

- Unit tests: schema validation, sort stability, HTML escaping, path
  sanitization, truncation caps, redaction preservation, empty/large DB handling.
- CLI tests: flag parsing, help text, `--json` shape (`schema: inspector-cli/report/1`),
  exit codes for missing/invalid DB, read-only open verified (no journal/mutation).
- Fixture test: seeded DB+bundles → HTML contains expected findings/runs/evidence
  links, is well-formed HTML, opens offline, and source DB file hash is unchanged
  after generation.
- Secret-leakage test: seeded redacted fields and fake credential strings in DB
  never appear verbatim in HTML; only redacted/hashed forms do.
- No-server test: generated HTML contains no `http://`, `https://`, `fetch(`,
  `XMLHttpRequest`, or `<script src="http` references.

## Exit gate

M17 is complete only when:

- `inspector report` (final flag name) generates a static `report.html` from a
  seeded `runs.db` + bundles that renders findings, run summaries, and evidence
  links correctly and opens via `file://` with no server
- Source DB and bundles are untouched (hash/mtime proof in fixture)
- No secrets appear in output (redaction test green)
- All new and existing relevant tests are green: lint (0 errors), typecheck
  PASS, unit PASS, integration PASS
- Docs, spec/tasks, and campaign state agree; no durable migration shipped

No tag, release, or publication. No server component shipped.

## Non-goals

- Live dashboard, polling, websockets, or any long-running server process
- Cloud hosting, auth/multi-tenancy, or hosted SaaS
- Editing, annotating, or triaging findings inside the report (read-only view)
- New exploration, replay, or repair workflows; campaign scheduler changes
- Vector search, RAG, or model-assisted summarization inside the report
- PDF generation, email delivery, or notification integrations
- Broad CSS/design system overhaul beyond the report's self-contained styling

## Completion transition

On exit-gate PASS at a known revision, mark M17 COMPLETE in
`.inspector/state/campaign.yaml` and `CHECKPOINT.md`. No schema migration is
required. Activate the next roadmap spec (M18) in the same change when practical.
