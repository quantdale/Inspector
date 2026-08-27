# HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity

## Status
ACTIVE planning contract. Baseline: `main@038550172866001ce8bfe44054b8146b3391af32` (2026-08-27).

## Why a new campaign
HARDENING_5 remains historically complete. Its runtime implementation was hosted-certified on `e1e0864`, and the current state-synchronized HEAD has exact-SHA Actions run `33038479136` SUCCESS. A fresh post-H5 semantic audit found a separate cluster of repair/evidence/audit defects, so these must not be hidden inside completed H5 history.

## Baseline invariants
- M13 remains COMPLETE.
- M8 remains DEFERRED_ENVIRONMENT.
- No M14.
- No release/tag/publication.
- Work on `main`; never force-push.
- H1-H5 ledgers are append-only historical truth.

## Defect ledger

| ID | Priority | State | Planner evidence |
| --- | --- | --- | --- |
| H6-D0 | HIGH | CONFIRMED | Exact baseline tree has 536 tracked blobs, but H5 audit has 534 rows. Missing `packages/workflows/src/replay-subject.hardening.test.ts` and `packages/workflows/src/verify-regress-truth.integration.test.ts`. `scripts/gen_audit_census.py` hashes bytes but assigns REVIEWED by path/category rather than semantic evidence. |
| H6-D1 | HIGH | CONFIRMED | `packages/repair/src/regression.ts::passes` treats absence of a hard-oracle match as pass without requiring successful execution. Operational outcomes/zero-work can collapse to clean. |
| H6-D2 | HIGH | CONFIRMED | `RepairEngine.probeSurvives` rejects target-failure/signals but not adapter-crash/cancelled/deadline-exceeded/unknown; broken verification can satisfy the masking gate. |
| H6-D3 | HIGH | CONFIRMED | Repair transitions a finding to RESOLVED before `finish()`; required regression copy and repair-record persistence are caught as best-effort, so RESOLVED can outlive its proof. |
| H6-D4 | HIGH | CONFIRMED | `applyAcceptedPatch` lacks exact target revision/cleanliness proof and all-or-nothing rollback. |
| H6-D5 | HIGH | CONFIRMED | rejected-attempt rollback uses `git clean -fd`, preserving ignored files that can contaminate later attempts. |
| H6-D6 | MEDIUM | CONFIRMED | generated regression scenarios hard-code `adapter-web` although repair providers are generic. |
| H6-D7 | HIGH | CONFIRMED | action outcome shape is validated but returned actionId/runId/environmentId are not explicitly correlated to the submitted action/current controller before acceptance. |
| H6-D8 | HIGH | REPRO REQUIRED | observation shape is validated but explicit returned runId/environmentId correlation is absent in controller code. Prove blast radius before final disposition. |
| H6-D9 | MEDIUM | CONFIRMED | declared artifact refs with no metadata are silently filtered and charged as zero, weakening evidence truth. |
| H6-D10 | MEDIUM | CONFIRMED | AdapterServer validates act/observe payloads but not the complete JSON-RPC envelope nor initialize/lifecycle/health/cancel parameter contracts. |
| H6-D11 | MEDIUM | REPRO REQUIRED | malformed durable action `error_json` is silently omitted by outcome reconstruction; establish whether lower-layer constraints make this unreachable. |

## Goals
1. Require positive successful execution evidence for repair clean/fixed conclusions.
2. Make repair completion/evidence/application crash-safe, provenance-bound, and atomic.
3. Enforce adapter result identity and artifact integrity at the core trust boundary.
4. Complete malformed-protocol/durable-corruption negative-space proof.
5. Replace self-attesting audit bookkeeping with exact-blob semantic review evidence.
6. Re-review every final tracked authored blob and all system maps.
7. Finish with exact-tree local gates and exact-SHA hosted certification.

## Non-goals
No product milestone, release, tag, publishing, aesthetic rewrite, silent real/mock substitution, test weakening, or fake “reviewed” status derived from reading/hashing bytes.

## Completion rule
H6 is COMPLETE only when every Critical/High defect is CLOSED with deterministic regression evidence, every final authored blob has exact-current-blob semantic review evidence, exact-tree local gates pass, and required hosted jobs pass on the exact pushed implementation SHA. Pending/skipped required evidence keeps H6 ACTIVE.
