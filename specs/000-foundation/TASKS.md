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

- [ ] Define envelope, IDs, error model, deadlines and protocol version.
- [ ] Implement JSON Schema validation.
- [ ] Define capability negotiation.
- [ ] Define observe/action/lifecycle messages.
- [ ] Define ordered adapter event envelope.
- [ ] Add protocol fixture tests for valid/invalid messages.

Gate: schemas reject malformed IDs, missing deadlines, invalid capabilities and out-of-version messages.

## F2 — SQLite durable store

Depends on F0/F1 types.

- [ ] Add migrations.
- [ ] Persist runs/environments/steps/actions/observations/checkpoints.
- [ ] Implement transactional step commit.
- [ ] Implement startup recovery query for in-flight actions.

Gate: kill/reopen integration test preserves order and identifies unknown outcomes.

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

- [ ] stdio JSON-RPC server helper.
- [ ] health/heartbeat.
- [ ] cancellation/deadline handling.
- [ ] fake deterministic state machine.
- [ ] fault injection for timeout and adapter crash.
- [ ] conformance test harness.

Gate: fake adapter passes conformance suite.

## F5 — Core policy and budget engine

Depends on F1/F2.

- [ ] capability grants.
- [ ] risk classes.
- [ ] counters/limits.
- [ ] deterministic rejection result.

Gate: forbidden action never reaches fake adapter.

## F6 — Core run manager

Depends on F1-F5.

- [ ] create/run/close lifecycle.
- [ ] adapter subprocess management.
- [ ] step correlation.
- [ ] observation persistence.
- [ ] checkpointing.
- [ ] crash recovery.

Gate: acceptance tests 1-8 in `SPEC.md` pass.

## F7 — CLI

Depends on F6.

- [ ] `inspector doctor`
- [ ] `inspector run --adapter fake`
- [ ] `inspector runs list`
- [ ] `inspector runs show <id>`
- [ ] machine-readable JSON output mode.

Gate: a clean checkout can run the fake demonstration non-interactively.

## F8 — Documentation/decision synchronization

Depends on F7.

- [ ] update architecture with actual package names and commands.
- [ ] add first-run developer guide.
- [ ] record deviations as ADRs.
- [ ] mark spec complete only when all gates pass.

## Next specification

After F0-F8, create `specs/001-web-adapter/` rather than implementing Playwright ad hoc.
