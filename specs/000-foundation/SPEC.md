# Specification 000 — Foundation

## Status

ACTIVE

## Objective

Create the smallest executable Inspector kernel that proves durable typed interaction with an environment before adding real Playwright automation.

## Required repository structure

```text
packages/
  core/
  protocol/
  adapter-sdk/
  adapter-fake/
  cli/
  store-sqlite/
  artifact-store/
```

A single package may temporarily contain multiple modules during bootstrap, but public boundaries must match these responsibilities.

## Required behaviors

### Protocol

Implement version `0.1` covering:

- adapter initialize/capability negotiation
- environment create/reset/close
- observe
- act
- heartbeat/health
- cancel
- artifact reference
- observation event stream

All messages are schema validated.

### Core run state

The core can:

1. create a run
2. create an environment through an adapter
3. request observation
4. choose/submit a validated action
5. persist request/outcome/events
6. checkpoint
7. close environment/run

### Durability

Persist to SQLite:

- run
- environment
- action
- observation metadata
- step/event sequence
- checkpoint

Use transactions so a crash cannot create a silently half-committed step.

### Unknown-outcome recovery

Simulate adapter loss after an action request but before response. On restart, the core must mark the action outcome `UNKNOWN` and re-observe/reset according to action idempotency instead of blindly retrying.

### Fake adapter

The fake adapter models a small deterministic state machine with at least:

- 5 states
- 8 semantic actions
- one deterministic failure oracle signal
- reset support
- configurable injected timeout/crash
- artifact stub creation

### Policy/budget

Before executing an action, enforce:

- capability granted
- action risk class permitted
- action budget remaining
- deadline present

### Artifact store

Write artifacts under a run-scoped path and return content metadata including hash, MIME type, size, and relative location.

## Non-goals

- real browser automation
- LLM calls
- autonomous exploration
- source repair
- MCP facade
- distributed workers
- dashboard

## Acceptance tests

1. Happy-path fake run reaches terminal state and persists exact ordered events.
2. Process restart resumes from checkpoint.
3. Unknown-outcome action is not blindly duplicated.
4. Policy rejects a forbidden capability.
5. Budget exhaustion is deterministic.
6. Invalid protocol payload is rejected with structured error.
7. Adapter crash is classified separately from target failure.
8. Artifact hash/metadata round-trip succeeds.
9. Protocol conformance suite can be run against `adapter-fake`.

## Quality gates

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

All gates must be runnable non-interactively.
