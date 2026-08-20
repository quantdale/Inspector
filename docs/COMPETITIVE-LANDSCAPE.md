# Competitive Landscape and Build-vs-Buy

Inspector should compose mature automation primitives rather than recreate them.

## Existing layers to use

### Playwright / Cypress / Selenium / WebDriver

Strong browser automation and test execution. Playwright is the recommended first substrate because it combines browser contexts, semantic locators, screenshots, traces, network control, and cross-browser support.

**Build:** autonomous exploration, evidence correlation, oracle policy, reproduction/minimization, repair lifecycle.

### Appium

Strong cross-platform WebDriver ecosystem with modular drivers/plugins for Android, iOS, Windows and browsers.

**Use:** platform driver interoperability.

**Do not make Appium the Inspector core:** Inspector's state graph, evidence model, budgets, repository repair, and cross-sensor reasoning are higher-level concerns.

### UI Automator / Espresso / XCUITest / Windows UI Automation

Use native semantics behind adapters. Do not replace platform accessibility/automation frameworks.

### Maestro / Detox

Useful scripted mobile E2E frameworks. They may become import/export targets for regression scenarios, but they do not replace Inspector's autonomous discovery kernel.

### Property-based/stateful testing tools

Hypothesis and similar systems demonstrate the value of generating **sequences** and shrinking failures. Inspector should borrow these principles and integrate existing libraries where language/domain boundaries make sense.

### Visual regression services

Use existing image-diff algorithms or external services where configured. Inspector's differentiation is linking visual anomalies to state/action evidence and confirmation policy.

### Coding agents

Use external coding agents/models for diagnosis and repair rather than building a new foundation model or IDE agent. Inspector's job is to prepare unusually strong runtime evidence and verification loops.

## Emerging overlap

AI computer-use and AI-assisted testing systems increasingly inspect UI hierarchies and operate applications. This validates the direction but does not remove the need for:

- deterministic environment reset
- explicit finding lifecycle
- oracle provenance/strength
- replay/minimization
- synchronized multi-sensor evidence
- exact-revision repair isolation
- adapter-neutral state/action graph

Those properties are Inspector's intended center of gravity.

## Differentiation

The product is not "LLM clicks app." It is:

```text
Autonomous exploration
+ explicit oracles
+ evidence kernel
+ deterministic reproduction
+ sequence minimization
+ source-aware diagnosis
+ isolated repair
+ exact replay verification
+ continuous hunting
```

## Build-vs-buy table

| Subsystem | Decision |
|---|---|
| Browser control | Buy/use Playwright |
| Android device control | Use ADB |
| Android semantic UI | Use UI Automator/Appium |
| Windows semantic UI | Use UI Automation/Appium |
| iOS semantic UI | Use XCUITest/Appium |
| Git isolation | Use Git worktrees |
| Telemetry conventions | Use OpenTelemetry |
| Property sequence generation | Integrate/borrow mature approaches |
| State graph | Build |
| Exploration policy | Build |
| Oracle engine | Build |
| Evidence bundle | Build |
| Reproducer/minimizer | Build |
| Finding lifecycle | Build |
| Model routing | Build thin provider abstraction |
| Coding model | Use providers/external agents |
| External agent protocol | Expose MCP |
| Internal adapter protocol | Build small typed IAP |

## Primary references

- Playwright docs: https://playwright.dev/docs/
- Playwright tracing: https://playwright.dev/docs/trace-viewer
- Playwright accessibility/ARIA snapshots: https://playwright.dev/docs/aria-snapshots
- Android UI Automator: https://developer.android.com/training/testing/other-components/ui-automator
- Appium drivers: https://appium.io/docs/en/latest/ecosystem/drivers/
- Windows UI Automation: https://learn.microsoft.com/windows/win32/winauto/uiauto-uiautomationoverview
- Windows app UI testing: https://learn.microsoft.com/windows/apps/develop/testing/
- XCTest/XCUIAutomation: https://developer.apple.com/documentation/xctest
- MCP architecture: https://modelcontextprotocol.io/specification/
- OpenTelemetry: https://opentelemetry.io/docs/
- Git worktree: https://git-scm.com/docs/git-worktree
- Hypothesis stateful testing: https://hypothesis.readthedocs.io/en/latest/stateful.html
- WebDriver BiDi: https://www.w3.org/TR/webdriver-bidi/
