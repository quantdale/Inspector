# Planner Handoff — HARDENING_6

## Active campaign
HARDENING_6 — Repair Trust, Positive-Evidence Verification, and Audit Integrity.

Canonical OpenSpec: `openspec/changes/hardening-6-repair-trust/`.

Planner baseline: `038550172866001ce8bfe44054b8146b3391af32`.

## Planner findings

No production implementation was changed by this planning pass.

Current baseline exact-SHA Actions run `33038479136` is SUCCESS across Linux quality/full integration, Windows path/native, Electron Xvfb real-runtime/fleet, and Linux installed-artifact smoke. Runtime source is unchanged since H5's certified `e1e0864`.

The critical new discovery is that H5's every-file certificate is incomplete and still self-attesting:
- exact tree has 536 tracked blobs;
- H5 ledger has 534 rows;
- missing `packages/workflows/src/replay-subject.hardening.test.ts`;
- missing `packages/workflows/src/verify-regress-truth.integration.test.ts`;
- `scripts/gen_audit_census.py` computes hashes but assigns REVIEWED from pathname/category, not semantic review evidence.

Do not regenerate the same mechanism and call it fixed.

## First implementation target

Start with H6-D1/H6-D2 red tests:
1. post-patch replay returns adapter-crash/cancelled/deadline-exceeded/unknown/empty;
2. masking probe receives the same;
3. assert no path can transition the finding to RESOLVED without positive successful execution evidence.

Then execute H6-D3..D6 repair durability/application/isolation/provenance, H6-D7..D9 core correlation/artifacts, H6-D10 protocol boundary, and H6-D11 durable corruption.

## Operating rule

Use the OpenSpec tasks as the work queue and continue autonomously until completion gates are proved or every remaining item is genuinely environment/authority blocked.

No release/tag/publication. No force-push. Preserve all historical campaign records.
