# Planner Handoff — HARDENING_6 post-M23 rebase

## Active campaign
HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity.

Canonical OpenSpec: `openspec/changes/hardening-6-repair-trust/`.

Original activation baseline: `038550172866001ce8bfe44054b8146b3391af32`.
Current planner/execution baseline: `8e6bdb0e7951505972fd59bce550d3ad330d0c22`.
Current exact-SHA Actions run: `33092343085` SUCCESS across Linux quality/full integration, Windows path/native, Electron Xvfb, and installed-artifact smoke.

## What changed since H6 was first planned
M14-M23 were implemented and marked COMPLETE after H6 activation. They added performance, provenance, OTel, dashboard, security/redaction, platform-fidelity, visual-oracle, distributed-lease, property-test, and GA-recertification work. They did **not** modify the repair engine/regression/worktree, core RunController trust checks, or AdapterServer validation paths that contain H6-D1..D10.

Therefore: preserve M14-M23 as completed history, but do not treat them or green baseline CI as closure of H6.

## Current verified release blockers
- D1/D2/D3: operational/non-execution can collapse into clean repair evidence, and `RESOLVED` can precede durable proof.
- D4: accepted patch application has no exact target revision/cleanliness/preimage transaction or rollback.
- D5: rejected-attempt rollback preserves ignored contamination.
- D7/D9: controller accepts uncorrelated outcome identity and silently drops missing artifact refs.
- D10: AdapterServer boundary validation is incomplete.
- D8 and D11 remain reproduce-first.
- D0 audit certification remains structurally unsound until exact-blob semantic evidence replaces self-attestation.

Full current-tree audit/remediation map: `.inspector/state/HARDENING_6-AUDIT.md`.

## First implementation target
Start with D1/D2 red tests for post-patch and masking replay under adapter-crash, cancellation, deadline, unknown, driver throw, and zero-work. No such case may transition a finding to `RESOLVED`. Then close D3-D6, D7-D9, D10, and prove D8/D11.

## Operating rule
Use H6 tasks as the work queue and continue autonomously until completion gates are proved or every remaining item is genuinely environment/authority blocked. Rebase the audit if `main` moves. No M24, release, tag, publication, or force-push while H6 is active.
