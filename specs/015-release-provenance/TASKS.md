# SPEC-015 Task Graph — Release Provenance

Checkboxes flip only when the task's gate actually passes.

- [x] F0 — Version coherence guard — implement `check:versions` (root vs workspace
      version equality, internal `@inspector/*` range satisfaction, no stale
      `workspace:*` in packed output) and land the version coherence test green
      on the current tree (plus a negative fixture proving mismatch fails);
      publish path invokes the guard and refuses on failure.

- [x] F1 — Tarball content assertion — define per-package allowlist and add a
      deterministic pack-and-inspect assertion (dry-run tar list) that proves
      no workspace litter, no secrets, no absolute path leakage, and no private
      package content in any publishable tarball; test fails on an injected
      extra file.

- [x] F2 — Manifest provenance — generate a canonical manifest binding each
      publishable tarball to `sha256`/`sha512` + integrity, source commit SHA,
      and lockfile fingerprint; add offline `verify:manifest` that re-hashes
      artifacts and detects tamper; tests prove shape, stability, and tamper
      refusal.

- [x] F3 — Docs and final gate — update README / DEVELOPMENT / releasing docs
      and provenance notes to describe version coherence, tarball content, and
      manifest verification plus `release:smoke` from a clean prefix; reconcile
      ROADMAP / STATUS / campaign.yaml / CHECKPOINT.md; prove `release:smoke`
      passes from a clean prefix and version coherence test green on the exact
      final tree.

## Exit checklist

- `release:smoke` passes from a clean prefix with no workspace path leakage,
  no secrets, and private packages not published.
- Version coherence test green (positive + negative fixture).
- Tarball content assertions green for all publishable packages.
- Manifest provenance generated, stable, and verifiable offline.
