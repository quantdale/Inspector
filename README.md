# Inspector

Inspector is an autonomous software reliability agent: a system that can **observe real running software, explore it, discover defects, collect evidence, reproduce failures deterministically, repair them in isolation, and verify the fix**.

Inspector is not intended to be another scripted UI-test runner. Its core problem is autonomous exploratory QA.

```text
observe -> explore -> suspect -> reproduce -> minimize -> confirm
        -> diagnose -> patch -> rebuild -> replay -> regress -> continue
```

## Thesis

Coding agents already have strong hands inside a repository. Inspector gives them better **senses**, a disciplined **evidence loop**, and a safe way to act on live software.

Sensors include screenshots, accessibility/UI trees, DOM, logs, crashes, traces, network events, persisted state, database snapshots, coverage, process/device state, and source-code structure.

Actuators include clicks/taps/typing/swipes, browser/device control, launch/kill/restart, state reset and fixture injection, command execution, build/test, source edits, worktree management, reinstall/relaunch, and deterministic replay.

## Initial target

The first executable proof was **web applications through Playwright**. That
proof is complete, and the platform order below has been followed through
CLI/PTY, Android/ADB, Windows/UIA, and the Electron production binding (see
the capability summary above). Platform order:

1. Web / Playwright
2. CLI / PTY
3. Android / ADB + UI Automator/Appium
4. Electron
5. Windows native / UI Automation + Appium Windows driver
6. iOS simulator / XCUITest-Appium on macOS

## Architecture at a glance

```text
                         +-------------------+
                         |   Inspector Core  |
                         +---------+---------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
        Exploration           Evidence/Oracle        Repair
              |                    |                    |
              +--------------------+--------------------+
                                   |
                        Inspector Adapter Protocol
                                   |
         +-----------+-------------+-------------+-----------+
         |           |             |             |           |
     Playwright     CLI          Android       Windows      iOS
      adapter      adapter        adapter       adapter     adapter
```

The core uses a typed, versioned internal adapter protocol. MCP is an **external interoperability surface**, not the internal control plane.

## Repository status

The implementation campaign **M0–M7 is complete and hardened** (HARDENING_1 closed
66 defects), and the **RC1 dogfood campaign** ran six unscripted hunts against real
production backends (web/Playwright, CLI/ConPTY PTY, Windows UIA via PowerShell
bridge, Android ADB on a headless emulator). The independent finding audit found
zero unresolved Critical/High defects after the fixes landed. M8 (iOS) is deferred
for lack of a macOS/Xcode runtime. See `docs/STATUS.md` for gates and numbers,
and `.inspector/rc-work/audit/FINDING-AUDIT.md` for the audit ledger.

Current status: **M13 — Intelligence-Guided Autonomous QA complete; M14-M23 ten-campaign series COMPLETE (2026-08-27); HARDENING_5 — Fleet Execution Truth remains certified (run 33034546691 SUCCESS on `e1e0864`)**. M9 platform-neutral exploration, M10 resumable exploration, M11 operator workflows/distribution, M12 real-target fleet campaigns, M13 model-runtime / semantic planner / source-intelligence / safe-repair assistance, plus M14 replay-performance (StateFile bench), M15 release-provenance, M16 OTel observability, M17 operator dashboard, M18 supply-chain security, M19 platform fidelity, M20 visual oracle, M21 distributed fleet, M22 property-mutation, and M23 GA re-certification (rc.3) are all COMPLETE with gates green on the exact final tree (install --frozen-lockfile OK; lint 0 errors/4 warnings; typecheck PASS; unit 784 passed/3 skipped across 79 files; integration 211 passed/2 skipped across 51 files incl. real web/PTY/AVD/UIA/Electron + fleet chaos + new suites; release:smoke PASS). Separately invoked hardening campaigns HARDENING_2, HARDENING_3, HARDENING_4, and HARDENING_5 are all COMPLETE with deterministic regression coverage and hosted certification (f687ef1, e1e0864). RC1 field validation GO_WITH_DOCUMENTED_DEBT for rc.2; rc.3 candidate 0.1.0-rc.3 @ 22a6766 recorded GO_WITH_DOCUMENTED_DEBT, NOT_PUBLISHED, no tag. No release, tag, or publish has been performed.
## Quickstart

Prerequisites: Node.js 22+, pnpm 9+. See `docs/DEVELOPMENT.md` for details,
optional backends, and troubleshooting.

```bash
git clone <repo-url> inspector && cd inspector
pnpm install --frozen-lockfile

# Probe platform capabilities and workspace health
pnpm cli doctor

# Unscripted exploration against any localhost web target you serve, e.g.
# a vendored todomvc target unpacked from its npm tarball:
#   node dogfood/bin/serve-static.mjs --port 8123 --dir <target-root>
pnpm cli hunt --url http://127.0.0.1:8123/ --max-actions 100 --max-minutes 5

# No target handy? The deterministic fake adapter exercises the same
# explore -> reproduce -> confirm -> bundle pipeline offline:
pnpm cli hunt --adapter fake --max-actions 60 --json

# Inspect results
pnpm cli findings list
pnpm cli findings show <findingId>

# Product workflows (durable; use --json for automation)
pnpm cli verify <findingId> --json
pnpm cli regress --json
pnpm cli explore --adapter fake --max-actions 60 --json
pnpm cli repair <findingId> --repo-root <checkout> --revision <sha> --provider <module> --json
pnpm cli campaign run --items id=fake --workers 2 --steps 4 --json
pnpm cli campaign list --json
```

Evidence bundles land under `<workspace>/.inspector/bundles/<runId>/`, where the
workspace resolves to `--workspace <dir>` > `$INSPECTOR_WORKSPACE` > the current
directory. Recorded runs live in `<workspace>/.inspector/runs.db`; inspect them
with `pnpm cli runs list` and `runs show <runId>`.

Autonomous exploration is available through the same hunt contract for web,
fake, CLI/PTTY, Windows/UIA, and Android targets. A hunt records a durable
exploration campaign; after an abrupt controller death, continue it with:

```bash
pnpm cli hunt --resume <runId> --json
```

The original adapter, target provenance, explorer configuration, action graph,
decision stream, findings, and consumed budgets are restored. In contrast,
`pnpm cli runs resume <runId>` is intentionally diagnostic: it reattaches and
re-observes an environment without continuing autonomous exploration.

## Platform capability summary

| Tier | Platforms |
| --- | --- |
| Proven real on dev machine | Web (Playwright + Chromium); CLI PTY (ConPTY via `@lydell/node-pty`); Windows UIA (PowerShell bridge); Android ADB (headless emulator); Electron (Playwright Electron API — proven real on Windows dev host with Electron 43.4.1 + Linux Xvfb fleet campaign proof; injectable fallback only when executable/display absent) |
| Proven via injectable backend only | iOS interfaces |
| Deferred | M8 iOS/Xcode |

Details and known limitations: `docs/PLATFORM-ADAPTERS.md`.

## Design principles

- Evidence before repair.
- Deterministic reproduction before declaring a bug confirmed.
- Weak oracles may create candidates; they must not silently justify destructive fixes.
- Prefer semantic structure over pixels; use vision when structure is insufficient.
- Never hijack the developer's physical mouse or keyboard by default.
- Isolate code repair in Git worktrees/branches.
- Persist enough state to resume after crashes or context loss.
- Treat every actuator as a capability subject to policy and budget.
- Keep platform-specific complexity behind adapters.
- Make failures auditable: every finding should have a replayable evidence package.
- Models propose; Inspector validates (M13): optional provider-neutral model
  assistance improves planning/suspicion/diagnosis/repair proposals, but
  evidence, policy, budgets-before-consumption, and verification stay
  authoritative. No model is required — offline behavior stays deterministic.

## Core documents

- `docs/PRODUCT.md` — scope and product contract
- `docs/ARCHITECTURE.md` — system architecture and technology choices
- `docs/EXPLORATION-ENGINE.md` — autonomous exploration strategy
- `docs/ORACLE-SYSTEM.md` — how Inspector decides something is wrong
- `docs/EVIDENCE-MODEL.md` — evidence bundle and finding lifecycle
- `docs/PLATFORM-ADAPTERS.md` — platform strategy
- `docs/AUTONOMY-MODEL.md` — permissions, budgets, recovery, and repair loop
- `docs/SECURITY-MODEL.md` — isolation and safety boundaries
- `docs/MODEL-ROUTING.md` — model usage policy
- `docs/OBSERVABILITY.md` — Inspector's own telemetry
- `docs/ROADMAP.md` — milestone plan
- `docs/COMPETITIVE-LANDSCAPE.md` — build-vs-buy and differentiation

## License

No open-source license has been selected. All rights are reserved by the
copyright holder; copying, distribution, and derivative use outside the
development team are therefore **not permitted** until a license is chosen.
Do not add a license file without an explicit project decision.
