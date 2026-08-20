# ADR 0003 — Foundation implementation choices

## Status

ACCEPTED (M0)

## Context

M0 required a smallest executable Inspector kernel proving durable typed
interaction with an environment before adding real Playwright automation. The
architecture (ADR 0002) already fixed the Inspector Adapter Protocol as a
narrow, versioned, schema-validated protocol over JSON-RPC 2.0/stdio.

## Decision

- **Monorepo**: pnpm workspace with seven packages under `packages/*`
  (`protocol`, `store-sqlite`, `artifact-store`, `adapter-sdk`, `adapter-fake`,
  `core`, `cli`). Boundaries match `specs/000-foundation/SPEC.md`.
- **Runtime**: TypeScript executed directly via `tsx` in development and tests;
  Vitest with path aliases resolves `@inspector/*` without a build step.
  `tsc --noEmit` provides the typecheck gate.
- **Validation**: `ajv` + `ajv-formats` for JSON-Schema validation of protocol
  messages; schemas live in `@inspector/protocol`.
- **Durable store**: `better-sqlite3` (synchronous, transactional, native
  prebuilt) rather than `node:sqlite` to avoid experimental-flag fragility on
  Node 22. Migrations create runs/environments/steps/actions/observations/
  checkpoints; a step (action + outcome + observations) commits in one
  transaction.
- **Adapter transport**: line-delimited JSON-RPC 2.0 over stdio, implemented in
  `@inspector/adapter-sdk`. The core spawns adapters as subprocesses and
  enforces per-request deadlines; adapter loss is classified as `adapter-crash`.

## Consequences

- No separate compile/build step is needed to run or test the kernel.
- Crash recovery is explicit: an action requested but not finalized stays
  `pending` in durable state; on restart it is marked `unknown` and the core
  re-observes instead of blindly resubmitting.
- Real browser/mobile adapters (M1+) plug in behind the same `AdapterHandler`
  interface with no core changes.

## Alternatives considered

- `node:sqlite` — rejected for M0 due to experimental-flag and typing churn on
  the pinned Node 22; can be revisited later.
- A bundled build (tsc/tshy/esbuild) — deferred; adds no value for the
  autonomous campaign and complicates path-alias testing.
