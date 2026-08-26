# HARDENING_5 Design — Fleet Truth and Runtime Parity

## Context

Inspector intentionally separates scheduling (`@inspector/scale`) from execution (`@inspector/workflows`) and platform implementation (adapter packages). That separation currently permits vocabulary drift: `@inspector/scale` knows six families including Electron, while workflow exploration knows five and contains permissive fallbacks to fake. The fix must strengthen boundaries rather than add another special case that can drift later.

## Design Principles

1. **Identity is data, not inference.** A validated adapter family must survive routing, spawn, durable environment/run records, evidence, replay, and result reporting unchanged except for explicitly documented internal backend delegation.
2. **Unknown means refusal.** Product configuration must never map unknown/unsupported values to fake. Fake is selected only when the operator/manifest explicitly requests fake or a deterministic test fixture explicitly constructs it.
3. **Capability means executable.** A worker may advertise a family only when its executor can actually instantiate the required workflow path under the current environment. An injectable test backend must be distinguishable from a real-runtime proof.
4. **Exhaustiveness over scattered defaults.** Prefer a single typed registry/mapping or exhaustive switches with compile-time `never` checks. If dependency layering prevents centralization, add a contract matrix that enumerates all families at each layer.
5. **Electron identity survives web-semantic reuse.** `ElectronAdapterHandler` may reuse browser sensing/action semantics internally; fleet provenance must remain Electron-specific.
6. **Durability is artifact-class specific.** State/control-plane files may require stronger fsync/retry guarantees than reproducible diagnostics. Document rather than overclaim.
7. **Performance follows proof.** Benchmark first. A speculative patch is a hypothesis source, not code to merge.

## Adapter-Family Architecture

Target conceptual registry:

```text
AdapterFamily
  fake      -> required capability deterministic-fixture -> workflow fake      -> adapter-fake        -> fake replay
  web       -> browser                                -> workflow web       -> adapter-web         -> web replay
  cli       -> pty                                    -> workflow native    -> adapter-cli         -> CLI replay
  windows   -> uia                                    -> workflow native    -> adapter-windows     -> UIA replay
  android   -> adb                                    -> workflow native    -> adapter-android     -> Android replay
  electron  -> electron (+ display when required)     -> Electron-capable workflow -> adapter-electron -> Electron replay
```

The exact module owning this mapping is an implementation decision constrained by dependency direction. Do not create a new core package merely for one enum if an existing low-level contract can own it safely. The important property is that each consumer proves exhaustiveness.

### Electron exploration model

Electron's adapter already wraps browser semantics. Two designs are acceptable only if provenance remains exact:

- treat Electron as its own exploration adapter whose generic graph/scoring semantics can share implementation with web; or
- introduce an explicit platform/backend descriptor separating `family: electron` from `explorerKind: web-like`.

Do **not** coerce `electron` to `web` or `fake` before creating the run. Durable run/environment/finding/evidence fields must identify Electron. Resume and replay must reconstruct Electron from those fields.

### Target configuration

Define/validate the Electron target contract rather than overloading web `targetUrl` accidentally. The seeded Electron fixture is sufficient for deterministic campaign tests. Real-runtime proof may launch the repository's Electron fixture under Xvfb. If external Electron app targeting is not yet a supported product contract, reject unsupported target forms at preflight and document the limit.

## Replay / Verify / Regress

`replayDriverFor()` must recognize durable Electron adapter identity. The replay implementation should use the real Electron adapter/backend when provenance says real and an injectable deterministic backend only when provenance explicitly records that mode. Missing executable/display is `environment-failure`/`incompatible-target` according to existing taxonomy, not a target defect and never a fake fallback.

Downstream verify/regress must retain `sourceItemId`, workspace containment, finding id, adapter, revision, and evidence checks already enforced for other families.

## Contract Testing

Add an adapter-family matrix generated from the canonical family list. For each family, assert at least:

- manifest accepts it;
- required capability is known;
- a truthful capability snapshot can advertise it;
- workflow mapping is exhaustive;
- adapter binary resolution is exact or typed-unavailable;
- run/environment adapter identity is expected;
- replay driver is exact or explicit preflight refusal;
- unknown values fail before any run/workspace side effect.

Include a regression specifically proving the pre-H5 Electron path cannot return a successful fake run.

## Cross-Platform Atomic Writes

Inventory every unique temp + rename implementation. Do not immediately create one global abstraction. First group writers by contract:

- durable control-plane state;
- evidence/artifact metadata;
- CLI/workflow metadata;
- repair/worktree outputs;
- generated/reproducible diagnostics.

For Windows transient sharing violations, use a bounded retry policy with deterministic injectable timing in tests. Retry only error codes empirically/semantically classified as transient sharing conflicts. Preserve the original error if the retry budget expires. Unique temp names and age-gated cleanup remain mandatory.

On POSIX, decide whether parent-directory fsync is required for each durable class. Tests must not claim power-loss durability if the implementation guarantees only process-crash atomicity.

## Performance Method

Create a benchmark ledger in H5 audit/checkpoint state containing command, fixture, seed, host/CI class, cold/warm status, run count, median and spread/p95 when meaningful. Profile before touching production code.

Prioritize web replay/exploration because it dominates current E2E time. Evaluate the preserved H4 ideas independently: prepared-statement caching, single-pass aggregation, fingerprint co-computation, sweep throttling, checkpoint frequency, and CI caches. The old patch must not be applied wholesale.

Checkpoint reduction is a safety change disguised as performance. Any reduction requires crash injection at the widened window, deterministic resume equivalence, budget continuity, and finding/evidence continuity.

## State and Truth

Planner state remains truthful as READY_FOR_EXECUTION. On explicit apply, the executor creates a HARDENING_5 ACTIVE block/ledger before product edits, then sets the prompt ACTIVE. At completion, mark H5 COMPLETE, retain M13 COMPLETE and M8 DEFERRED_ENVIRONMENT, update stale Electron current-state prose, and leave historical reports intact.

## Rollback / Failure Strategy

Each workstream lands in coherent commits after targeted gates. If an optimization regresses correctness or is statistically unconvincing, revert/drop it without blocking correctness work. If real Electron/Windows prerequisites are unavailable on a host, retain deterministic injectable tests and rely on the appropriate hosted OS/runtime gate; if no genuine environment exists anywhere, record an environment deferral rather than faking proof.
