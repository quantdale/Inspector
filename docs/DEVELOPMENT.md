# First-run developer guide

Inspector is a pnpm workspace of TypeScript packages (17 under `packages/`).
This guide gets a clean checkout running the real CLI end to end, against the
fake adapter or a production backend.

## Prerequisites

Required:

- Node.js 22+ (`node --version`)
- pnpm 9 (`npm i -g pnpm@9` or corepack)

A warm pnpm content-addressable store makes `pnpm install` take seconds; a
cold-store first install will take minutes longer.

Optional, per backend:

- Playwright Chromium — used by the web adapter and its integration tests:
  `pnpm exec playwright install chromium`
- Android SDK/emulator + `adb` on PATH (`ANDROID_HOME` set) — required only for
  the android-real backend
- PowerShell 5.1+ (built into Windows) — required only for the windows-uia
  real UIA bridge

The CLI's `doctor` command probes all of these and reports which capabilities
are present:

```bash
pnpm cli doctor            # human-readable PASS/WARN per check
pnpm cli doctor --json     # machine-readable
```

Core checks (Node version, workspace writability, store openability, fake
adapter resolvable) must pass for exit code 0; missing optional capabilities
are reported as warnings.

## Install

```bash
pnpm install
```

## Quality gates

All gates run non-interactively:

```bash
pnpm lint             # ESLint (flat config)
pnpm typecheck        # tsc --noEmit over the whole workspace
pnpm test             # Vitest unit tests
pnpm test:integration # Vitest integration tests (adapter subprocesses, store,
                      # run manager, CLI; hookTimeout is raised to 30s in
                      # vitest.integration.config.ts because adapter subprocess
                      # startup can be slow on loaded Windows machines)
```

A clean checkout should pass all four. The integration suite spawns adapter
subprocesses with tight deadlines elsewhere; if it fails under heavy parallel
machine load, rerun once before investigating.

## Try the fake adapter

```bash
# Health/environment checks
pnpm cli doctor

# Run the scripted demonstration scenario
pnpm cli run --adapter fake

# Machine-readable output
pnpm cli run --adapter fake --json

# Unscripted exploration through the full pipeline
# (explore -> reproduce -> confirm -> evidence bundle)
pnpm cli hunt --adapter fake --max-actions 60 --json

# Inspect recorded runs and findings
pnpm cli runs list
pnpm cli runs show <runId> --json
pnpm cli findings list
pnpm cli findings show <findingId>
```

`pnpm cli` is a shorthand for `tsx packages/cli/src/bin.ts`.

## Workspace isolation

Every command resolves one **workspace directory**, in this order:

1. `--workspace <dir>` flag (preferred),
2. `$INSPECTOR_WORKSPACE`,
3. the process working directory.

The workspace holds `<workspace>/.inspector/runs.db`, `artifacts/`, and
evidence bundles under `<workspace>/.inspector/bundles/<runId>/`. Each isolated
directory therefore gets its own store and artifacts — use a fresh directory
per target or experiment.

Caveat: `pnpm run` re-cwd's into the package directory, so an ambient-cwd
workspace can silently resolve to somewhere unexpected. Prefer an explicit
`--workspace`. A warning is printed when the resolved workspace is the Inspector
repository root (sharing one `runs.db` across hunts causes lock/unique
conflicts; such failures are remapped to an actionable `workspace-conflict`
error).

## Running against real backends

Backend selection is controlled per adapter by environment variables. Any
other value is an error, never a silent fallback.

| Variable | Values | Default |
| --- | --- | --- |
| `INSPECTOR_PTY` | `real` \| `mock` | `mock` (real must be opted into explicitly) |
| `INSPECTOR_WINDOWS_BACKEND` | `real` \| `mock` \| `auto` | `auto`: probe PowerShell/UIA, use real when the probe succeeds, else mock with a warning |
| `INSPECTOR_ANDROID_BACKEND` | `real` \| `mock` \| `auto` | `auto`: probe adb, fall back to mock with a warning |

Web always uses Playwright + Chromium. See `docs/PLATFORM-ADAPTERS.md` for the
honest capability matrix and known per-platform limitations.

## Troubleshooting

- **Orphan processes after killed sessions** — externally killing PTY sessions
  or UIA targets can leave orphaned shells or bridge processes behind. Check
  with `ps` / Task Manager and kill leftover `powershell` UIA bridges or node
  adapter processes before retrying. The CLI arms a force-exit guard so a dead
  PTY session cannot wedge the host at exit, but manual cleanup may still be
  needed after hard kills.
- **Corrupted `runs.db`** — if the SQLite store fails to open or reports
  corruption, quarantine the file (move `runs.db` plus any `runs.db-shm` /
  `runs.db-wal` siblings aside rather than deleting them) and let the next run
  create a fresh store. Recorded runs from before the corruption are lost.
- **Port collisions** — static web targets served on fixed ports collide with
  stale servers from earlier sessions. Kill the stale listener or serve on a
  different port; `hunt --url http://127.0.0.1:<port>/` accepts any localhost
  port.
- **Emulator zombie entries** — `adb devices` can list a long-dead emulator as
  `device`; `adb shell` will hang against it. Run `adb kill-server` and boot
  your AVD fresh before android-real work. Device presence alone is not
  evidence of liveness.

## Layout

```
packages/
  protocol/        # IAP v0.1 types + ajv schemas
  store-sqlite/    # durable store
  artifact-store/  # content-addressed artifacts
  adapter-sdk/     # JSON-RPC stdio transport
  adapter-fake/    # deterministic fake adapter
  adapter-web/     # Playwright web adapter
  cli-adapter/     # CLI/PTY adapter (mock + @lydell/node-pty ConPTY)
  windows-adapter/ # Windows UIA adapter (mock + PowerShell bridge)
  electron-adapter/# Electron runtime binding (injectable backend)
  android/         # Android ADB adapter (mock + RealAdbBackend)
  core/            # policy/budget + run manager
  explore/         # autonomous exploration engine
  finding/         # finding lifecycle + reproduction policy
  oracle/          # oracle evaluation
  repair/          # isolated repair loop
  scale/           # lease/concurrency primitives (FileLock + SQLite lease store)
  cli/             # inspector command
dogfood/           # dogfood target manifests + static server helper
specs/             # milestone specifications and task lists
docs/              # architecture documents and ADRs
```

## Where to go next

- `docs/PLATFORM-ADAPTERS.md` — capability matrix, backend selection, limitations
- `docs/STATUS.md` — current campaign status and verified gate numbers
- `docs/ARCHITECTURE.md` and `docs/ADR/` — system contracts
- `AGENTS.md` — operating contract for autonomous agents working on this repo
