# HARDENING_6 Planner Audit Baseline

Baseline: `main@038550172866001ce8bfe44054b8146b3391af32`, 2026-08-27.

## Exact repository census
GitHub recursive-tree enumeration is complete (`truncated=false`):
- 643 total tree entries
- 536 tracked blobs
- ~3.68 MB tracked content
- 319 files under `packages/`
- 120 under `.inspector/`
- 28 under `docs/`
- 27 historical `specs/`
- 11 H5 OpenSpec files

H5 audit contains 534 unique rows. Exact set comparison finds two missing tracked blobs:
1. `packages/workflows/src/replay-subject.hardening.test.ts`
2. `packages/workflows/src/verify-regress-truth.integration.test.ts`

Further, `scripts/gen_audit_census.py` reads bytes to compute a blob hash but `classify(path)` assigns R solely from pathname/category. It does not consume semantic-review evidence. This is H6-D0.

## Exact baseline CI
Actions run `33038479136` is SUCCESS for baseline HEAD:
- Linux quality gate `98406487228`
- Windows path/native gate `98406487028`
- Electron real-runtime proof (Xvfb) `98408140037`
- Linux installed-artifact smoke `98408140063`

H6 therefore targets semantic gaps despite a green baseline.

## Post-H5 delta
Comparison `e1e0864..0385501` contains only seven state/prompt/doc truth-surface files. Runtime source is unchanged since H5's certified implementation SHA.

## Fresh semantic hotspots
- Repair regression pass = no hard oracle, not positive execution.
- Masking probe ignores non-target operational outcomes.
- RESOLVED can precede required evidence persistence.
- Accepted patch application lacks target revision/cleanliness + atomic rollback.
- Rejected attempt cleanup preserves ignored files.
- Regression artifact hard-codes web adapter.
- Core validates result shape but not exact request/run/environment correlation.
- Missing declared artifact metadata is silently filtered/uncharged.
- AdapterServer validation is incomplete outside act/observe.

## Planner honesty rule
The planner validated the complete tree census, H5-ledger mismatch, post-H5 delta, current hosted CI, and high-risk repair/core/protocol/evidence paths. Because H5's mechanism is itself proven insufficient as a semantic-review certificate, this document does NOT falsely relabel all 536 files as newly reviewed. H6.6 requires a real final-tree exact-blob semantic review before certification.
