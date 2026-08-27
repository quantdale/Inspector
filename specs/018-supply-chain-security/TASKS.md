# SPEC-018 Task Graph — Supply-Chain and Redaction Hardening

Checkboxes flip only when the task's gate actually passes.

- [x] F0 npm audit guard script — `scripts/audit-guard.mjs` with fail-closed `high`/`critical` check, allowlist with expiry/owner validation, CI wiring, and `audit:guard` npm script.
- [x] F1 Expanded secret-pattern redaction — new patterns (AWS keys, GitHub/NPM/Slack tokens, PEM, generic API key) in the established redaction layer; bounded deterministic replacement; unit tests for each pattern and false-positive bounds.
- [x] F2 Taint audit test — synthetic secret + injection payload flowed through packet builders, store, and log formatters; asserts no raw secret persists and injection remains inert; credential-free and in `pnpm test`.
- [x] F3 Documentation and campaign state — `docs/SECURITY-MODEL.md`, `docs/MODEL-ROUTING.md`, `README.md`, and `.inspector/state/campaign.yaml`/`CHECKPOINT.md` reconciled; `pnpm lint`/`typecheck`/`test`/`release:smoke` green with no new runtime deps.

## Exit checklist

- Audit guard exits non-zero on `high`/`critical`, zero on clean; allowlist expiry enforced.
- Redaction covers all new patterns; bounded single-pass; no catastrophic backtracking.
- Taint test green: no leakage to SQLite/packets/logs; injection inert.
- Full gate green (lint 0 errors, typecheck, test, smoke); docs/state agree; no new runtime dependencies.
