# Fresh-machine onboarding

This is the canonical bootstrap entry point for a new workstation or a fresh coding-agent environment. Complete this document before implementation work. The objective is a reproducible machine that can build, test, inspect, and operate this repository without rediscovering tooling mid-campaign.

## 1. Preflight rule

1. Clone the repository and enter its root.
2. Confirm the intended repository/branch and fetch current `origin/main`.
3. Read the repository control-plane documents before changing code: `AGENTS.md`, `README.md`, `docs/DEVELOPMENT.md`, `docs/STATUS.md`, `.inspector/state/`, active OpenSpec state.
4. Install/verify the machine prerequisites below.
5. Enable the committed agent integrations and repository-local skills.
6. Restore dependencies from lockfiles/pins; do not casually upgrade them during bootstrap.
7. Run the baseline validation commands.
8. Only then begin a development campaign. If a prerequisite cannot be satisfied, record it as an environment blocker rather than weakening a gate.

Credentials, API keys, signing material, account logins, licensed models/assets, and other secrets are machine/user responsibilities. Never commit them.

## 2. Supported host and prerequisites

**Primary host:** Node-based cross-platform core; Windows is required for real UIA/ConPTY proof, Android SDK for real ADB proof, macOS/Xcode for deferred iOS proof.

**Required machine tools**
- Git
- Node.js >= 22
- pnpm 9.15.9 (packageManager pin)
- Playwright browsers for web/Electron adapters
- platform tools required by the adapter being exercised

**Task-dependent / optional tools**
- Android SDK/ADB + emulator
- Windows UI Automation/PowerShell environment
- Electron/Xvfb dependencies on Linux
- macOS/Xcode/Appium for future iOS tier


## 3. Agent setup

- Load repository instructions before acting. Prefer committed repository state over chat history.
- Repository-local skills: `goal`.
- Agent adapter/config directories present in this repository should be discovered and used in-place; do not duplicate them globally unless the harness cannot load repository-local configuration.
- Relevant committed agent surfaces: `.agent/`, `.agents/`, `.claude/`, `.kimi-code/`, `.opencode/`, `.inspector/`.
- MCP policy: MCP is an external interoperability surface, not Inspector's internal control plane. No root `.mcp.json` is committed; do not redesign the adapter architecture around an MCP during bootstrap.
- Keep MCP/plugin authority narrow. Documentation/diagnostic MCPs are not permission to change architecture, bypass tests, or publish.
- Authentication for GitHub and coding-agent CLIs is configured separately on the machine. Never write tokens into tracked files.

## 4. Bootstrap

Run the repository's pinned bootstrap, not an improvised dependency upgrade:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm cli doctor
```

Only install platform backends needed by the active campaign. Missing macOS/iOS capability must remain `DEFERRED_ENVIRONMENT`, not simulated as real proof.


## 5. Editor/LSP baseline

Use the local TypeScript 5.7 server and ESLint. Keep typed adapter protocol diagnostics active across the monorepo/workspace.

The editor is optional; the language servers are not. Agents should have diagnostics/type information available before editing non-trivial code.

## 6. Baseline verification

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:integration
pnpm cli doctor
pnpm cli hunt --adapter fake --max-actions 20 --json
```

A fresh machine is considered **development-ready** only when the applicable non-external gates above pass. Hardware/device/signing/account gates may remain explicitly blocked if the repository already classifies them that way.

## 7. Fresh-agent instruction

Use this exact operating rule when handing the repository to a new agent:

> Read `ONBOARDING.md` first. Set up every applicable prerequisite, repository-local skill, MCP/plugin, dependency, browser/device/runtime tool, and validation gate described there. Then read the repository's durable agent state and only start implementation after preflight is green or a genuine environment blocker is recorded. Do not replace pinned tooling, skip gates, or invent work to compensate for a missing machine capability.
