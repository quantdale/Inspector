# ADR 0001: Use Playwright/Web as the First Real Adapter

- Status: Accepted
- Date: 2026-08-20

## Context

Inspector's novel risk is not whether software can be clicked. It is whether autonomous exploration, oracle evaluation, deterministic reproduction, evidence packaging, minimization, and repair verification can work reliably.

Starting with Android or Windows would introduce substantial environment-control complexity before these ideas are proven.

## Decision

Implement the first production-grade adapter with Playwright against a seeded web application.

## Consequences

Positive:

- headless, non-interfering execution
- cheap disposable browser contexts
- mature semantic locators/actionability
- screenshots, traces, console and network signals
- cross-browser expansion later
- deterministic fixture/state control is straightforward

Negative:

- web semantics are richer/easier than some native platforms, so adapter abstractions must be tested against Android soon after the core is stable
- browser-only success is not proof of desktop/mobile generality

## Guardrail

No web-specific type may appear in the core protocol unless it is namespaced as an optional adapter extension.
