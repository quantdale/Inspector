# AGENTS.md

This file defines the operating contract for coding agents working on Inspector.

## Source of truth

Read, in order:

1. `README.md`
2. `docs/PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. the active specification under `specs/`
5. `specs/000-foundation/TASKS.md` for the current task graph

Architecture Decision Records under `docs/ADR/` override older prose when they conflict.

## Working rules

- Do not implement platform-specific shortcuts in the core when they belong in an adapter.
- Do not let an LLM action directly bypass the capability/policy layer.
- Every externally visible action must be represented as a typed action with an ID, deadline, budget attribution, and outcome.
- Every observation that influences a finding must be persistable and attributable to a run/step.
- A candidate bug is not a confirmed bug until the reproduction policy is satisfied.
- Prefer deterministic semantics over natural-language-only state.
- Prefer semantic selectors and stable IDs over screen coordinates.
- Pixels/vision are fallback or corroborating sensors, not the only source of truth when structured state exists.
- Repair work must happen in an isolated Git worktree or equivalent disposable checkout.
- Do not commit generated run artifacts, screenshots, traces, videos, databases, or model transcripts unless a spec explicitly marks them as fixtures.
- Redact secrets before persisting logs, network bodies, screenshots metadata, or model context.

## Implementation baseline

Unless superseded by an ADR:

- Node.js 22+
- TypeScript, strict mode
- pnpm workspace
- Vitest for core/unit tests
- Playwright for the first platform adapter and end-to-end proving ground
- SQLite for durable local control-plane state
- JSON Schema plus runtime validation for protocol payloads
- OpenTelemetry conventions for Inspector telemetry
- JSON-RPC 2.0 framing over stdio/local IPC for adapter subprocesses
- MCP only as an optional external facade

Python, Kotlin, C#, Swift, Rust, or Go are allowed in platform helpers when they are the best native fit. Do not rewrite the TypeScript core merely to make the stack uniform.

## Quality gates

Every implementation change should leave the repository in a resumable, testable state.

Minimum expected gates once bootstrapped:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Platform adapters add their own smoke gates.

A change that modifies a protocol schema must include compatibility tests or a version bump.

A change that modifies autonomous exploration, oracle scoring, finding confirmation, or repair policy must include deterministic fixture scenarios.

## Finding semantics

Do not collapse these states:

```text
OBSERVED -> CANDIDATE -> REPRODUCING -> MINIMIZED -> CONFIRMED
          -> REJECTED
CONFIRMED -> PATCHING -> VERIFYING -> RESOLVED
                              -> REGRESSED
CANDIDATE/CONFIRMED -> FLAKY
```

A weak visual or LLM-only suspicion should normally remain `CANDIDATE` until corroborated.

## Git discipline

Implementation agents should use feature branches/worktrees. Keep commits scoped. Do not push or merge unless the invoking workflow explicitly authorizes it.

## Documentation discipline

When behavior changes, update the specification or ADR in the same change. Avoid documentation that merely restates code; document invariants, contracts, failure modes, and decisions.
