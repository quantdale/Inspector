# First-run developer guide

Inspector is a pnpm workspace of TypeScript packages. This guide gets a clean
checkout running the M0 foundation kernel end to end.

## Prerequisites

- Node.js 22+
- pnpm 9+ (`npm i -g pnpm@9` or corepack)

## Install

```bash
pnpm install
```

This installs all workspace packages and their dev dependencies (TypeScript,
Vitest, ESLint, ajv, better-sqlite3, tsx).

## Quality gates

All gates run non-interactively:

```bash
pnpm lint            # ESLint (flat config)
pnpm typecheck       # tsc --noEmit over the whole workspace
pnpm test            # Vitest unit tests
pnpm test:integration # Vitest integration tests (adapter subprocess, store, run manager, CLI)
```

A clean checkout should pass all four.

## Try the fake adapter

The foundation ships a deterministic fake adapter so the full typed
observe/act loop can be exercised without a real browser.

```bash
# Health/environment checks
pnpm cli doctor

# Run a non-interactive demonstration scenario
pnpm cli run --adapter fake

# Machine-readable output
pnpm cli run --adapter fake --json

# Inspect recorded runs
pnpm cli runs list
pnpm cli runs show <runId> --json
```

`pnpm cli` is a shorthand for `tsx packages/cli/src/bin.ts`. Records are written
to `<cwd>/.inspector/runs.db` and artifacts to `<cwd>/.inspector/artifacts/`.
Override the workspace directory with `--workspace <dir>`.

## Layout

```
packages/
  protocol/        # IAP v0.1 types + ajv schemas
  store-sqlite/    # durable store
  artifact-store/  # content-addressed artifacts
  adapter-sdk/     # JSON-RPC stdio transport
  adapter-fake/    # deterministic fake adapter
  core/            # policy/budget + run manager
  cli/             # inspector command
```

## Next milestone

M0 proves durable typed interaction with a fake environment. M1 adds the real
Playwright/web adapter (see `specs/001-web-adapter/`).
