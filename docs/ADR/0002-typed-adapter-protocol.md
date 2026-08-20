# ADR 0002: Custom Typed Internal Adapter Protocol; MCP at the Boundary

- Status: Accepted
- Date: 2026-08-20

## Context

Inspector needs to support external AI agents and multiple platform automation backends.

MCP provides useful interoperability but Inspector's internal adapter boundary needs strict semantics for target identity, action deadlines, ordered observation events, idempotency, replay metadata, risk classes, artifact handles, and adapter health.

## Decision

Build a small versioned Inspector Adapter Protocol (IAP) using JSON-RPC 2.0 framing over stdio/local IPC. Define payloads with JSON Schema and generate/validate TypeScript types.

Expose an optional MCP server facade from the core for external agents.

## Consequences

- core semantics stay under project control
- adapters may be implemented in any language
- local subprocess isolation is straightforward
- protocol conformance tests become mandatory
- MCP ecosystem changes do not force internal refactors
- Inspector accepts the maintenance cost of a deliberately small protocol
