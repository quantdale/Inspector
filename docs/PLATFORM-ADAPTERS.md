# Platform Adapters

Adapters translate Inspector's semantic sensor/action vocabulary into platform-native automation.

## Capability status (RC1)

Three honest tiers. Claims below are true of the current tree; see
`docs/STATUS.md`, `.inspector/rc-work/INVENTORY.md`,
`.inspector/rc-work/audit/FINDING-AUDIT.md`, and `audit/METRICS.md` for evidence.

| Tier | Platform / backend | Evidence |
| --- | --- | --- |
| **Proven real on dev machine** | Web — Playwright + Chromium | End-to-end launch/navigation/DOM verified; two real todomvc targets hunted unscripted (250 actions each); seeded control hunt confirmed 3/3 planted defects through the full explore → reproduce → confirm → bundle pipeline |
| **Proven real on dev machine** | CLI — real PTY via `@lydell/node-pty` (ConPTY) | Real ConPTY round-trip integration green; unscripted vim session driven over a live PTY (69 interactions, kill/liveness probes honest) |
| **Proven real on dev machine** | Windows UIA — PowerShell bridge (`RealUiaBackend`) | Tree enumeration/invoke/value round-trip exercised on Calculator and Store Paint end-to-end; dead-window detection and `waitForWindow` landed after dogfood findings |
| **Proven real on dev machine** | Android ADB — `RealAdbBackend` | Headless AVD booted (~42 s) and `com.android.settings` driven end-to-end (~65 s); liveness-verified devices, uiautomator dump with retries, screencap validation, logcat |
| **Proven via injectable backend only** | Electron runtime binding | Adapter interfaces proven against injectable backends; no real Electron runtime exercised in RC1 |
| **Proven via injectable backend only** | iOS interfaces | Interfaces and remote-worker contract fully specified and conformance-tested against fakes; no macOS/Xcode runtime available |
| **Deferred** | M8 iOS/Xcode | Deferred for lack of a macOS/Xcode/simulator runtime; resumption requirements in `specs/008-ios/SPEC.md` |

### Backend selection

| Variable | Values | Default behavior |
| --- | --- | --- |
| `INSPECTOR_PTY` | `real` \| `mock` | `mock`; `INSPECTOR_PTY=real` opts into native node-pty explicitly (no auto mode) |
| `INSPECTOR_WINDOWS_BACKEND` | `real` \| `mock` \| `auto` | `auto`: probe PowerShell/UIA availability; real when the probe succeeds, otherwise mock with a logged warning |
| `INSPECTOR_ANDROID_BACKEND` | `real` \| `mock` \| `auto` | `auto`: probe adb; fall back to mock with a logged warning when unavailable |

Any other value is an error, never a silent fallback.

### Known limitations per platform

- **Web**: external targets are localhost-only by policy in RC1 (`--url` is
  validated and forwarded via `WEB_TARGET_URL`; non-local origins are rejected).
  Firefox/WebKit projects not yet exercised.
- **CLI/TUI**: `readScreen` returns a scrollback-tail model, not a cell grid;
  full-screen TUI redraws can leave stale fragments and degrade state detection
  for full-screen apps (documented in `NodePtyBackend`). No resize operation.
  Windows CreateProcess semantics require fully qualified program paths for
  some msys tools.
- **Windows/UIA**: packaged (Store) apps can linger as processes after their
  window dies; dead-process tree reads are now gated (`DEAD_WINDOW`), but a
  silent 1-node subtree after UWP content rehosting remains an open finding
  (C-F2 in the audit). No global mouse/keyboard injection by design.
- **Android**: emulator lifecycle seeding (APK install/launch) is now opt-in
  via `AndroidLifecycleOptions.seedApk` rather than unconditional, so the
  production create path works against preinstalled apps. Stale adb entries
  can report dead emulators as `device`; liveness must be shell-verified.

## Common adapter responsibilities

Every adapter should expose:

- capability negotiation
- target discovery/launch/close/reset
- stable target identity
- structured UI/interaction tree when available
- screenshot capture when available
- semantic actions
- logs/events
- environment health
- artifact export
- deterministic reset hooks
- fault injection hooks where safe

## Web — first implementation

**Primary technology:** Playwright.

Use isolated browser contexts and, initially, Chromium. Add Firefox/WebKit projects after the core loop works.

Sensors:

- accessibility/ARIA snapshot
- DOM-derived semantic inventory
- screenshot
- console/page errors
- request/response lifecycle
- trace
- cookies/localStorage/sessionStorage/IndexedDB summaries
- URL/navigation history
- optional JS coverage

Actuators:

- semantic locator click/fill/press/select
- navigation/reload/back/forward
- viewport/device emulation
- permissions/geolocation
- network abort/latency/offline via routing/context controls
- storage fixture injection

Use Playwright locators and actionability checks instead of arbitrary coordinates whenever possible.

## CLI/TUI

**Primary technology:** PTY subprocess adapter.

Each environment receives a disposable working directory and optional isolated HOME. Sensors include stdout/stderr, ANSI-normalized screen buffer, exit state, file tree diff, and process tree. Actuators include stdin, signals, terminal resize, process kill, and filesystem fixture setup.

TUI semantic understanding can start from terminal cells/ANSI and later add accessibility/protocol-specific hooks.

## Android

Host side:

- ADB for install/uninstall, package lifecycle, logcat, screenshots, process/device state, port forwarding, file transfer, emulator snapshots
- modern UI Automator 2.4 helper for accessibility-node inspection and structured actions
- Appium UiAutomator2/Espresso driver as an interoperability option

Recommended split:

```text
TypeScript Android adapter
   +-- ADB controller
   +-- Appium client (optional)
   +-- Kotlin instrumentation helper for modern UI Automator features
```

Avoid requiring physical mouse/keyboard input. Prefer a dedicated emulator per worker. Snapshot/fixture reset policy must be explicit.

## Electron

Use Playwright's Electron support where appropriate, plus Chromium/CDP instrumentation for renderer observability. Add main-process logs and IPC-aware hooks when the app under test opts in.

Electron can also be exercised through the Windows adapter for true black-box validation; both paths are useful and should be distinguishable.

## Windows native

Microsoft UI Automation is the primary semantic tree. The recommended automation route is Appium's Windows driver or a small C# UI Automation sidecar when direct access gives stronger events/control.

Isolation options, from cheapest to strongest:

1. dedicated Windows user/desktop/session
2. Windows Sandbox where compatible
3. Hyper-V/VM worker

Do not fall back to global mouse/keyboard injection by default.

## iOS

Requires macOS for simulator/device tooling. Use XCUITest/XCUIAutomation, commonly through Appium XCUITest, with xcrun/simctl for simulator lifecycle and state.

Because infrastructure cost is high and the architecture adds little that cannot first be proven on Android/web, iOS is a later milestone.

## Adapter SDK

The SDK should include:

- protocol types/schema validators
- base lifecycle implementation
- structured error classes
- artifact writer
- heartbeat/health channel
- action deadline/cancellation helpers
- redaction helpers
- conformance test suite

A new adapter is considered viable only after passing adapter conformance tests against a fake core.
