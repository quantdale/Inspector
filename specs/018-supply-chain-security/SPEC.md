# SPEC-018 — Supply-Chain and Redaction Hardening

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M18
Depends on: M13

## Objective

Harden Inspector's supply chain and secret-redaction boundary without adding
runtime cost or new attack surface. Deliver a fail-closed **npm audit guard**,
**expanded secret-pattern redaction**, and a **taint-audit** proving that
target-controlled freeform text never reaches logs, persistence, or model
packets unredacted. This builds directly on the MODEL-ROUTING and SECURITY-MODEL
redaction guarantees established in M13 (F6, F20, F21).

## Invariants

- No new runtime dependencies. `dependencies` stays unchanged; only `devDependencies` or scripts may be touched.
- Audit findings fail closed: `high` or `critical` vulnerabilities block CI and `release:smoke`; `moderate` findings require an explicit allowlist with expiry and owner.
- Redaction is deterministic, bounded, and applied at the boundary — raw secrets never persist in SQLite, logs, artifacts, or `model_calls` metadata.
- Target-controlled freeform text is untrusted data everywhere (packets, logs, store, events) — injection-inert and redacted before any durable write.
- Offline deterministic operation unchanged: new guards add no network calls in normal operation.

## Workstreams

### F0 — npm audit guard script

Add `scripts/audit-guard.mjs` (or `pnpm audit` wrapper) that:
- runs `pnpm audit --json` (or `npm audit` equivalent) and parses advisories;
- fails closed on `high`/`critical`, warns on `moderate` unless explicitly allowlisted;
- supports `--allowlist audit-allowlist.json` with `{ id, reason, expiresAt, owner }` entries — expired or missing justification fails;
- is wired into CI (`ci.yml` / `release:smoke`) and `pnpm test` pre-check where feasible;
- produces machine-readable output (`audit-result.json`) for evidence without leaking advisory internals beyond severity/id.

### F1 — Expanded secret-pattern redaction

Extend the existing redaction layer (see `packages/core/src/redaction.ts` or equivalent established in M13 F6):
- new patterns: `aws_access_key`, `aws_secret_key`, `gh_token` (`ghp_`/`gho_`/`github_pat_`), `npm_token`, `slack_token` (`xox`), `private_key` (PEM header), `generic_api_key` (bearer/high-entropy), plus existing `password`/`secret`/`token` coverage;
- bounded single-pass replacement (`[REDACTED:<kind>]`), no catastrophic backtracking, no unbounded buffering;
- unit tests prove each new pattern redacts and that non-secrets (e.g. `ghp` absent valid length) do not false-positive beyond an acceptable threshold;
- redaction applied to: context packets, `model_calls` safe metadata, logs, and any artifact-bound freeform text.

### F2 — Taint audit test

Add a focused taint / flow test (no new runtime dep) that:
- seeds a synthetic observation containing every secret pattern plus an injection payload (`Ignore previous instructions...`);
- pumps it through packet builders, store write paths, and log formatters;
- asserts: no raw secret survives in persisted rows, packet hashes, or captured log output; injection payload remains data (no instruction following);
- runs in `pnpm test` (unit) and is credential-free.

### F3 — Documentation and campaign state

Update `docs/SECURITY-MODEL.md`, `docs/MODEL-ROUTING.md` (redaction section), `README.md` (security posture), and `.inspector/state/campaign.yaml` / `CHECKPOINT.md` to record M18 scope and audit-guard usage. No new durable-state migration required unless audit allowlist needs persistence (prefer file-based).

## Exit gate

- `scripts/audit-guard.mjs` exists, is executable via `pnpm audit:guard` (or `node scripts/audit-guard.mjs`), and correctly exits non-zero on `high`/`critical` and zero on clean.
- `pnpm test` includes expanded redaction unit tests — all new patterns covered, existing tests still green.
- Taint-audit test passes: synthetic secrets do not leak to store/packets/logs; injection inertness proven.
- `pnpm lint` (0 errors), `pnpm typecheck` PASS, `pnpm test` PASS, `release:smoke` PASS with audit guard wired.
- Docs and campaign state reconciled; no new runtime `dependencies` added.

## Non-goals

- Full SAST/DAST pipeline, container signing, or provenance attestation (deferred to broader hardening).
- Automatic `pnpm audit fix` or dependency upgrades — guard reports only; upgrades are explicit PRs.
- New secret-detection vendor integration or ML-based detection.
- Persisting raw audit JSON or raw secrets for debugging.
- Changing model runtime, provider, or budget semantics from M13.
