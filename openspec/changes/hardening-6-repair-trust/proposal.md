# HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity

## Status
ACTIVE, **rebased after M23**. Original activation baseline: `038550172866001ce8bfe44054b8146b3391af32` (2026-08-27). Current execution/audit baseline: `8e6bdb0e7951505972fd59bce550d3ad330d0c22` (2026-08-28 planning rebase).

Current exact-baseline Actions run `33092343085` is SUCCESS across Linux quality/full integration, Windows path/native, Electron Xvfb real-runtime/fleet, and Linux installed-artifact smoke.

## Why this campaign remains necessary after M14-M23
HARDENING_5 remains historically complete. M14-M23 are also implemented and recorded COMPLETE. A fresh current-code review confirms that the H6 repair/core/protocol defects were not closed by the M14-M23 series: the critical repair engine/regression/worktree, RunController correlation, and AdapterServer validation paths are unchanged from the H6 activation baseline.

Green existing tests therefore establish baseline stability, not repair-trust correctness. HARDENING_6 is the release-blocking next phase; no M24 should start until it closes.

## Baseline invariants
- M0-M7 and M9-M23 remain historical COMPLETE.
- M8 remains `DEFERRED_ENVIRONMENT` pending a real macOS/Xcode runtime.
- HARDENING_1 through HARDENING_5 remain historical COMPLETE.
- No M24 is implied or authorized.
- No release/tag/publication is authorized.
- Work on `main`; never force-push.
- Historical ledgers are append-only truth.

## Defect ledger

| ID | Priority | State | Current-tree evidence |
| --- | --- | --- | --- |
| H6-D0 | HIGH | CONFIRMED | Historical H5 audit had 534 rows vs 536 baseline blobs and its generator assigned REVIEWED by path/category. Current tree is now 584 blobs; a new exact-blob semantic ledger is still required. |
| H6-D1 | HIGH | CONFIRMED | `packages/repair/src/regression.ts::passes` treats no hard-oracle match as pass without proving successful execution. |
| H6-D2 | HIGH | CONFIRMED | `RepairEngine.probeSurvives` rejects target-failure/signals but not operational non-success such as cancellation/unknown/deadline/adapter failure. |
| H6-D3 | HIGH | CONFIRMED | Repair transitions to `RESOLVED` before `finish()`; required artifact copy and repair-record writes are caught as best-effort. |
| H6-D4 | HIGH | CONFIRMED | `applyAcceptedPatch` lacks exact target revision/cleanliness/preimage proof and all-or-nothing rollback. |
| H6-D5 | HIGH | CONFIRMED | Rejected-attempt rollback uses `git clean -fd`, preserving ignored contamination. |
| H6-D6 | MEDIUM | CONFIRMED | Regression scenarios hard-code `adapter-web` despite generic repair providers. |
| H6-D7 | HIGH | CONFIRMED | Action outcome shape is validated but returned action/run/environment identity is not explicitly correlated before durable acceptance. |
| H6-D8 | HIGH | REPRO REQUIRED | Observation identity/correlation requires an executable wrong-ID reproduction before final disposition. |
| H6-D9 | MEDIUM | CONFIRMED | Missing declared artifact refs are silently filtered and charged as zero. |
| H6-D10 | MEDIUM | CONFIRMED | AdapterServer validates act/observe params but not complete JSON-RPC envelope or initialize/lifecycle/health/cancel contracts. |
| H6-D11 | MEDIUM | REPRO REQUIRED | Malformed durable action error payload negative space requires raw-row reachability proof. |

Detailed current-tree evidence and remediation map: `.inspector/state/HARDENING_6-AUDIT.md`.

## Goals
1. Require positive successful execution evidence for repair clean/fixed conclusions.
2. Make repair completion/evidence/application crash-safe, provenance-bound, and atomic.
3. Enforce adapter result identity and artifact integrity at the core trust boundary.
4. Complete malformed-protocol/durable-corruption negative-space proof.
5. Replace self-attesting audit bookkeeping with exact-blob semantic review evidence.
6. Re-review every final tracked authored blob and all end-to-end system maps.
7. Finish with exact-tree local gates and exact-SHA hosted certification.

## Non-goals
No new product milestone, M24, release, tag, publishing, aesthetic rewrite, silent real/mock substitution, test weakening, or fake “reviewed” status derived from enumeration/hashing.

## Completion rule
H6 is COMPLETE only when every release-blocking H6 defect is CLOSED with deterministic regression evidence, every final authored blob has exact-current-blob semantic review evidence, exact-tree local gates pass, and required hosted jobs pass on the exact pushed implementation SHA. Pending/skipped required evidence keeps H6 ACTIVE.
