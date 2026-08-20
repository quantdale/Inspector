# Platform Adapters

Adapters translate Inspector's semantic sensor/action vocabulary into platform-native automation.

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
