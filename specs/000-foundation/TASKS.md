# Specification 000 — Task Graph

Work in dependency order. Mark tasks complete only after their acceptance tests pass.

## F0 — Workspace bootstrap

- [x] Initialize pnpm workspace and root TypeScript config.
- [x] Add lint/typecheck/test scripts.
- [x] Add CI workflow for Node 22+.
- [x] Create package skeletons defined by the spec.

Gate: clean install plus empty-package lint/typecheck/test pass. → PASSED (commit 1cca292..)

## F1 — Protocol package

Depends on F0.

- [x] Define envelope, IDs, error model, deadlines and protocol version.
- [x] Implement JSON Schema validation.
- [x] Define capability negotiation.
- [x] Define observe/action/lifecycle messages.
- [x] Define ordered adapter event envelope.
- [x] Add protocol fixture tests for valid/invalid messages.

Gate: schemas reject malformed IDs, missing deadlines, invalid capabilities and out-of-version messages. → PASSED

## F2 — SQLite durable store

Depends on F0/F1 types.

- [x] Add migrations.
- [x] Persist runs/environments/steps/actions/observations/checkpoints.
- [x] Implement transactional step commit.
- [x] Implement startup recovery query for in-flight actions.

Gate: kill/reopen integration test preserves order and identifies unknown outcomes. → PASSED

## F3 — Artifact store

Depends on F0.

- [ ] Run-scoped directories.
- [ ] SHA-256 content hashing.
- [ ] metadata record type.
- [ ] deduplicate identical content where practical.
- [ ] size limits.

Gate: deterministic hash and corruption-detection tests.

## F4 — Adapter SDK + fake adapter

Depends on F1/F3.

- [x] stdio JSON-RPC server helper.
- [x] health/heartbeat.
- [x] cancellation/deadline handling.
- [x] fake deterministic state machine.
- [x] fault injection for timeout and adapter crash.
- [x] conformance test harness.

Gate: fake adapter passes conformance suite. → PASSED

## F5 — Core policy and budget engine

Depends on F1/F2.

- [ ] capability grants.
- [ ] risk classes.
- [ ] counters/limits.
- [ ] deterministic rejection result.

Gate: forbidden action never reaches fake adapter.

## F6 — Core run manager

Depends on F1-F5.

- [x] create/run/close lifecycle.
- [x] adapter subprocess management.
- [x] step correlation.
- [x] observation persistence.
- [x] checkpointing.
- [x] crash recovery.

Gate: acceptance tests 1-8 in `SPEC.md` pass. → PASSED (1-5,7,8 covered; 2 resume + 6 invalid-payload covered by F1/F4)

## F7 — CLI

Depends on F6.

- [x] `inspector doctor`
- [x] `inspector run --adapter fake`
- [x] `inspector runs list`
- [x] `inspector runs show <id>`
- [x] machine-readable JSON output mode.

Gate: a clean checkout can run the fake demonstration non-interactively. → PASSED

## F8 — Documentation/decision synchronization

Depends on F7.

- [x] update architecture with actual package names and commands.
- [x] add first-run developer guide.
- [x] record deviations as ADRs.
- [x] mark spec complete only when all gates pass.

Gate: docs synchronized; spec marked complete. → DONE (M0 COMPLETE)

## Next specification

After F0-F8, create `specs/001-web-adapter/` rather than implementing Playwright ad hoc.
