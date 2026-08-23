# Architecture

## Decision summary

Inspector is a modular local-first orchestration system with a TypeScript core and platform adapters. The first implementation target is Playwright/web. Platform-specific automation lives behind a versioned Inspector Adapter Protocol (IAP).

### Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Core runtime | Node.js 22+ / TypeScript | Playwright/Appium/MCP ecosystem, strong async/process tooling, one language for first MVP |
| Package manager | pnpm workspaces | monorepo ergonomics and deterministic dependency graph |
| Durable state | SQLite | transactional, local, inspectable, no service dependency |
| Runtime validation | JSON Schema + TypeScript validation | language-neutral adapter contracts |
| Unit/integration tests | Vitest | fast TS feedback |
| Web automation | Playwright | headless isolation, contexts, traces, network, screenshots, accessibility semantics |
| CLI automation | node-pty or platform PTY adapter | independent terminal sessions without host input |
| Android | ADB + modern UI Automator; Appium bridge where useful | device lifecycle plus structured cross-app UI automation |
| Windows | UI Automation helper / Appium Windows driver | native automation tree and actions |
| Electron | Playwright/Electron APIs + CDP where needed | renderer + main-process-aware testing |
| iOS | XCUITest through Appium or native helper | platform-supported UI automation on simulator/device |
| Telemetry | OpenTelemetry conventions | traces/logs/metrics correlation and vendor neutrality |
| External agent interoperability | MCP facade | broad agent compatibility |
| Internal adapter transport | JSON-RPC 2.0 over stdio/local IPC | strict control, streaming events, easy subprocess isolation |

## Why TypeScript for the core

The first proof depends heavily on Playwright and likely Appium/MCP interoperability. TypeScript minimizes bridge code and makes the adapter SDK straightforward. Python remains valuable for scientific/property-testing helpers; Kotlin, C#, and Swift are appropriate for native automation helpers. Rust or Go should only be introduced when a measured performance, distribution, or isolation problem justifies them.

## Major components

```text
+------------------------------------------------------------------+
| Inspector Core                                                   |
|                                                                  |
|  Session/Run Manager                                             |
|  Capability + Policy Engine                                      |
|  Exploration Engine                                              |
|  Oracle Engine                                                   |
|  Evidence Kernel                                                 |
|  Reproduction + Minimization Engine                              |
|  Diagnosis/Repair Coordinator                                    |
|  Model Router                                                    |
|  Repository/Worktree Manager                                     |
|  Durable Store                                                   |
|  Scheduler/Budget Manager                                        |
+------------------------------+-----------------------------------+
                               |
                    Inspector Adapter Protocol
                               |
        +-----------------------+------------------------------+
        |             |             |          |          |       |
     Web adapter    CLI adapter   Android    Windows   Electron  iOS
        |             |             |          |          |       |
  Playwright         PTY        ADB/UIA2   UIA/Appium Playwright XCUITest
```

## Packages (implemented in M0)

The monorepo under `packages/` currently contains:

| Package | Responsibility |
|---|---|
| `@inspector/protocol` | Inspector Adapter Protocol v0.1: envelope, IDs, error model, ajv JSON-Schema validation, capability negotiation, observe/act/lifecycle messages, ordered adapter event envelope. |
| `@inspector/store-sqlite` | Durable SQLite store (better-sqlite3): runs/environments/steps/actions/observations/checkpoints, transactional step commit, in-flight recovery. |
| `@inspector/artifact-store` | Run-scoped content-addressed artifacts: SHA-256 hashing, dedup, size limits, corruption detection. |
| `@inspector/adapter-sdk` | Line-delimited JSON-RPC 2.0 over stdio transport, `AdapterServer`/`AdapterClient` with deadline enforcement, event notifications, subprocess spawning. |
| `@inspector/adapter-fake` | Deterministic 5-state / 8-action fake adapter with a deterministic failure oracle, reset, artifact stubs, and fault injection (timeout, crash). |
| `@inspector/core` | Policy/budget engine and `RunManager`/`RunController`: lifecycle, policy enforcement, durable step commit, checkpointing, crash recovery. |
| `@inspector/cli` | Installed operator CLI: `hunt`, `verify`, `regress`, `explore`, `repair`, bounded `campaign`, findings/runs inspection, doctor, and stable JSON contracts. |
| `@inspector/electron-adapter` | Production Playwright Electron handler plus explicit injectable contract backend, deterministic fixture, renderer/main evidence, and backend honesty probes. |

Runtime notes:

- Adapters speak JSON-RPC 2.0 over stdio (see `docs/ADR/0002-typed-adapter-protocol.md`).
- The core runs TypeScript directly via `tsx` in development; `pnpm test`/`test:integration` use Vitest with path aliases.
- Durable state lives in `<cwd>/.inspector/runs.db`; run artifacts under `<cwd>/.inspector/artifacts/`.

## Inspector Adapter Protocol (IAP)

The internal protocol is deliberately narrower and stricter than a general agent tool protocol.

### Required properties

- versioned schema
- capability negotiation
- request/response IDs
- monotonic event sequence numbers
- deadlines and cancellation
- idempotency keys for retryable actions
- explicit target/session identity
- structured errors
- action risk class
- artifact references instead of giant inline binary payloads
- streaming observation events
- deterministic replay metadata

### Example capability document

```json
{
  "protocolVersion": "0.1",
  "adapter": "web-playwright",
  "capabilities": {
    "observe": ["uiTree", "screenshot", "console", "network", "storage"],
    "act": ["click", "type", "navigate", "reload", "setViewport"],
    "lifecycle": ["reset", "launch", "close"],
    "faults": ["networkOffline", "abortRequest", "latency"],
    "coverage": ["js"]
  }
}
```

## Why not MCP internally

MCP is useful at the product boundary: it provides a standardized way for external coding agents to invoke Inspector capabilities. Internally, Inspector needs stronger guarantees around event ordering, replay identity, action budgets, capability risk classes, deterministic artifact references, and adapter lifecycle.

The design is therefore:

```text
External agent <-> MCP facade <-> Inspector Core <-> IAP <-> Adapter
```

MCP remains optional. The core must be fully usable without an MCP host.

## Durable state

SQLite stores control-plane facts, not massive artifacts.

Suggested tables:

- `runs`
- `environments`
- `steps`
- `observations`
- `actions`
- `states`
- `transitions`
- `findings`
- `reproductions`
- `oracle_evaluations`
- `repairs`
- `model_calls`
- `budgets`
- `checkpoints`

Screenshots, traces, videos, coverage files, database snapshots, and build logs live in a content-addressed artifact store under the run directory. SQLite stores hashes, metadata, and relative references.

## Event identity

Every meaningful event carries:

```text
run_id
environment_id
step_id
sequence
wall_time
monotonic_time
source
correlation_id
artifact_refs[]
```

This is essential for replay and postmortem reasoning.

## Environment abstraction

An environment owns the runnable target and reset semantics. Examples:

- fresh Playwright browser context + test backend fixture namespace
- Android emulator snapshot + app data reset
- disposable Windows VM/user session
- PTY + temporary filesystem/home directory

The exploration engine must never assume that `reset` means the same thing across platforms.

## Repository isolation

Any autonomous source modification happens in a linked Git worktree based on the exact revision that produced the finding. Worktree identity is stored in the repair record. Verification runs against the patched worktree, not an ambiguous current checkout.

## Scheduling

MVP: in-process scheduler with bounded concurrency.

Do not add Redis or a distributed queue before one machine genuinely becomes a bottleneck. The architecture may expose a queue interface, but local SQLite-backed leases are enough initially.

## Context/memory strategy

Models do not receive raw history indefinitely. Inspector builds compact, typed context packets:

- current state summary
- recent action window
- state graph neighborhood
- active invariants/oracles
- anomaly signals
- relevant source map
- previous failed hypotheses
- budgets remaining
- artifact handles

Large artifacts are fetched only when requested.

## Source intelligence

The repository layer should eventually expose:

- git diff/history
- symbol index through LSP/tree-sitter adapters
- static diagnostics
- dependency graph
- test inventory
- coverage mapping
- changed-file impact map

Source intelligence informs exploration prioritization and diagnosis but is not required for the earliest black-box web proof.
