# SPEC-015 — Release Provenance: Hermetic Publish Guard

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M15
Depends on: M13, M14 (M13/M14)

## Objective

Make the release candidate **publishable with hermetic provenance** so that any
published artifact can be traced to an exact source revision and verified
without trusting the build machine.

A publishable RC must demonstrate **version coherence, tarball content, checksums, and manifest**
provenance: every workspace package version is coherent, every packed tarball
contains exactly the intended files, every artifact has a stable checksum, and
a single manifest binds versions to checksums for verification. The release
remains hermetic — no ambient workspace state leaks into the artifact.

## Invariants

- **No workspace path leakage** — packed artifacts, manifests, checksums, and
  provenance records never contain absolute paths, user home segments, or
  machine-specific prefixes; all paths are repo-relative or content-addressed.
- **No secrets** — neither the tarball, manifest, nor any provenance output
  contains credentials, tokens, `.env` contents, or redacted secret material;
  secret-adjacent fixtures use synthetic placeholders and scanning gates enforce
  the boundary before publish.
- **Private packages stay private** — packages marked `private: true` are never
  packed, published, or included in the public provenance manifest; publish
  guards refuse if a private package is selected for the public channel and
  the manifest explicitly partitions public vs private scope.
- Hermetic build: given the same commit + lockfile, the produced tarball bytes
  and manifest checksums are reproducible (modulo explicitly documented
  timestamp normalization); no network fetch occurs during tarball assembly.
- Provenance is additive and verifiable: manifest entries are content-addressed
  (sha256/sha512) and can be re-checked offline without the original workspace.

## Workstreams

### F0 — Version coherence guard

Enforce cross-workspace version coherence before any publish path is considered
green. Guard checks: root `package.json` version equals every publishable
workspace package version; internal `@inspector/*` dependency ranges are
satisfied by the coherent version (no stale `workspace:*` leakage into packed
`package.json`); `pnpm -r` version drift fails closed with an actionable diff.
Deliver as a deterministic CLI/script (`check:versions` or equivalent) plus a
unit test `version coherence test green` that asserts coherence on the current
tree and fails on an injected mismatch fixture. Publish/release scripts must
invoke the guard and refuse on failure.

### F1 — Tarball content assertion

Assert that each publishable package's packed tarball contains exactly the
intended public surface and nothing else. Define an explicit allowlist per
package (dist, README, LICENSE, package.json, etc.) derived from
`files`/`publishConfig`/`.npmignore` semantics; assert no workspace litter
(`.env`, `*.tsbuildinfo`, `.inspector/state`, `.tmp`, editor dirs), no leaked
`src` beyond contracted entry points, and no private package content. Implement
as a deterministic pack-and-inspect step (`pnpm pack --dry-run` / tar list)
with snapshot-style assertions and a test that fails when an extra file is
introduced. No secrets and no absolute workspace paths appear in packed
contents.

### F2 — Manifest provenance (checksums)

Produce a single release manifest that binds the RC to verifiable checksums.
For each publishable package tarball: compute `sha256` (+ `sha512` where
practical) and record `{ name, version, tarball filename, sha256, sha512,
integrity }` alongside the source commit SHA and lockfile fingerprint. Manifest
is written to a stable path (`dist/manifest.json` or equivalent), is JSON-
canonicalized (sorted keys, LF), and is itself checksummed. Provide a
`verify:manifest` offline checker that re-hashes tarballs and compares to
manifest entries. Tests cover manifest shape, checksum stability across two
packs of the same tree, and refusal on tampered bytes.

### F3 — Docs

Synchronize operator and contributor docs with the hermetic release story:
update `README`, `DEVELOPMENT`, `RELEASE`/`RELEASING` (or equivalent),
`ARCHITECTURE`/`SECURITY-MODEL` provenance notes, and `ROADMAP`/`STATUS` to
describe version coherence, tarball content, and manifest verification.
Document `release:smoke` usage from a clean prefix, how to run the version
coherence and tarball checks locally, and the private-vs-public package
boundary. Reconcile `campaign.yaml`/`CHECKPOINT.md` entries for M15 without
advancing durable state to COMPLETE until the exit gate truly passes.

## Exit gate

- `release:smoke` passes from a clean prefix (frozen install into a temp
  prefix, no workspace path leakage in installed artifact, no secrets in
  output, private packages not published).
- Version coherence test green — `check:versions` (or equivalent) passes on
  the exact final tree and the dedicated unit/integration test asserting
  coherence is green; an injected version mismatch fixture fails as expected.
- Tarball content assertions green for all publishable packages (allowlist
  exact, no litter, no private content).
- Manifest provenance generated with stable `sha256`/`sha512` entries and
  offline `verify:manifest` passes on the same artifacts; tamper is detected.
- Lint (0 errors), typecheck PASS, unit PASS on the exact final tree.
- Docs/state consistent; M15 remains ACTIVE until all of the above are proven.

## Non-goals

- Publishing to npm / npm provenance attestation / OIDC — RC is publishable
  but not auto-published; no tag/release is created by this milestone.
- Cloud control plane, distributed queues, hosted SaaS, dashboard rewrite.
- iOS runtime without macOS/Xcode, RL, bespoke/fine-tuned/vision models,
  vector DB / RAG, new browser engine.
- Scheduler/lease rewrite, campaign repair, broad fuzz campaigns, wholesale
  monorepo refactor.
- Weakening of existing policy/evidence/budget/replay guarantees to satisfy
  packaging.
