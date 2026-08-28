# Planner Handoff — HARDENING_6 post-M23 rebase

## Active campaign
HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity.

Canonical OpenSpec: `openspec/changes/hardening-6-repair-trust/`.

Original activation baseline: `038550172866001ce8bfe44054b8146b3391af32`.
Current planner/execution baseline: `8e6bdb0e7951505972fd59bce550d3ad330d0c22`, rebased onto `main@bcd2c91` before implementation.
Current exact-SHA Actions run: `33092343085` SUCCESS across Linux quality/full integration, Windows path/native, Electron Xvfb, and installed-artifact smoke.

## What changed since H6 was first planned
M14-M23 were implemented and marked COMPLETE after H6 activation. They added performance, provenance, OTel, dashboard, security/redaction, platform-fidelity, visual-oracle, distributed-lease, property-test, and GA-recertification work. They did **not** modify the repair engine/regression/worktree, core RunController trust checks, or AdapterServer validation paths that contain H6-D1..D10.

Therefore: preserve M14-M23 as completed history, but do not treat them or green baseline CI as closure of H6. The candidate implementation has now closed the listed runtime trust defects; the final exact-tree local/hosted certification remains the only release-blocking gate.

## Candidate closure status
H6-D1/D2/D3/D4/D5/D6/D7/D8/D9/D10/D11 are closed on the candidate with
deterministic regression evidence; H6-D0 is replaced by the exact-blob semantic
review certificate. Final exact-tree local gates, source-vs-installed proofs,
and exact-SHA hosted certification remain pending.

Full current-tree audit/remediation map: `.inspector/state/HARDENING_6-AUDIT.md`.

## First implementation target
Completed: D1/D2 red tests cover adapter-crash, cancellation, deadline,
unknown, driver throw, zero-work, and mixed-action replay; D3-D6 cover durable
evidence, target provenance, atomic rollback, ignored contamination, and
non-web provenance; D7-D9 cover identity and artifact integrity; D10 covers
the full AdapterServer boundary; D8/D11 are dispositioned by executable tests.
Proceed to H6.8 reconciliation and exact-SHA certification.

## Operating rule
Use H6 tasks as the work queue and continue autonomously until completion gates are proved or every remaining item is genuinely environment/authority blocked. Rebase the audit if `main` moves. No M24, release, tag, publication, or force-push while H6 is active.
