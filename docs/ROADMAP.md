# Roadmap

The roadmap is ordered to prove the difficult ideas before broad platform support.

## M0 — Foundation

Goal: executable repository skeleton and durable contracts.

Deliverables:

- TypeScript/pnpm workspace
- core package boundaries
- SQLite migrations/store
- protocol schemas and adapter SDK
- policy/budget engine skeleton
- artifact store
- run/checkpoint model
- fake adapter and conformance tests
- CLI skeleton

Exit gate: a fake environment can execute a typed observe/action loop, persist every event, crash, and resume without ambiguity.

## M1 — Web sensing and acting

Goal: one real target under Playwright.

Deliverables:

- Chromium adapter
- context launch/reset
- accessibility snapshot / interactive inventory
- screenshot
- console/page errors
- network event capture
- semantic click/fill/press/navigation
- trace artifact capture
- deterministic seeded sample app with known bugs

Exit gate: Inspector can autonomously traverse the seeded app without host mouse/keyboard and produce a replayable trace.

## M2 — Finding and reproduction kernel

Goal: turn anomalies into evidence.

Deliverables:

- finding state machine
- hard oracle detectors
- clean reset and replay
- reproduction threshold policy
- sequence minimizer
- evidence bundle writer
- deterministic regression scenario export

Exit gate: seeded crash/state-corruption bugs become confirmed findings with minimized reproducers and low false-positive rate.

## M3 — Autonomous exploration

Goal: meaningful discovery beyond predefined scenarios.

Deliverables:

- state/action graph
- novelty scoring
- cycle avoidance
- boundary-value generator
- stateful sequence generator
- change/coverage-guided prioritization
- network/lifecycle fault injection for web target
- LLM planner fallback

Exit gate: Inspector discovers at least several hidden seeded bugs not represented in hand-authored test paths.

## M4 — Oracle expansion and repair

Goal: prove the complete loop.

Deliverables:

- invariant/metamorphic oracle SDK
- weak semantic candidate path
- exact-revision Git worktrees
- source index integration
- repair-agent context builder
- failing regression test generation
- build/replay/regression verification

Exit gate: at least one seeded bug is discovered, confirmed, repaired in a worktree, replayed successfully, and protected by a regression test with no manual debugging.

## M5 — Android

Goal: validate cross-platform adapter design.

Deliverables:

- ADB environment lifecycle
- dedicated emulator worker
- package install/reset/launch
- logcat/process sensors
- modern UI Automator helper
- screenshot/UI tree/actions
- emulator snapshot fixtures
- lifecycle/network fault injection

Exit gate: the same core finding/reproduction pipeline works without Android logic leaking into the core.

## M6 — CLI, Electron, Windows

Order can change based on need.

- CLI/PTTY adapter
- Electron adapter
- Windows UI Automation/Appium adapter
- stronger desktop isolation

Exit gate: adapter conformance and evidence model remain stable across fundamentally different platforms.

## M7 — Scale/hardening

- parallel isolated workers
- persistent repository map
- impact analysis
- flaky-finding clustering
- visual regression
- accessibility campaigns
- performance campaigns
- mutation-testing campaigns
- distributed execution only if single-host limits are measured
- MCP server facade and integrations

## What not to build early

- cloud control plane
- custom vision model
- distributed microservices
- reinforcement learning policy
- generic desktop mouse/keyboard computer-use
- bespoke browser engine
- custom mobile automation framework replacing ADB/UI Automator/Appium
- elaborate UI dashboard before the evidence kernel works
