# SPEC-019 — Platform Fidelity: Windows UIA, PTY Viewport, Android Dump Hardening

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M19
Depends on: M9, M10, M11, M12, M13 (SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-013)

## Objective

Close three measured platform-fidelity gaps that degrade real-target hunting without changing Inspector's product contract:

1. **Windows UIA 1-node subtree** — a shallow or single-node automation tree under a valid root causes false-negative element discovery and mis-ranked exploration edges.
2. **PTY viewport edge** — off-viewport or wrapped terminal output is silently truncated/misaligned, causing missed state and unstable snapshots on small or scrolled viewports.
3. **Android dump retry** — transient `uiautomator dump` / `adb` failures surface as hard environment errors instead of bounded, classified retries.

All three are fixed behind existing adapter contracts; no new adapter family, no host-global input.

## Dependencies

- M9–M13 COMPLETE (or at least M9 native exploration, M10 checkpoint/resume, M12 fleet routing, M13 model-runtime contracts stable — no behavioral conflict).
- Existing platform adapters: `windows` (UIA), `cli`/`pty`, `android` (ADB/UIAutomator) as implemented in M5/M6.
- No new external service or SDK required; environment-probed capabilities remain the availability gate.

## Required behaviors / Deliverables

- **Windows UIA subtree guard (F0):** When a UIA snapshot returns a single-node tree but the root is valid and responsive, the adapter probes a one-level deeper subtree (cached control-view + bounded retry) and merges children without reissuing host-global input; result is validated and bounded.
- **PTY viewport correctness (F1):** Terminal adapter correctly handles scrolled, wrapped, and resized viewports: viewport-relative coordinates remain stable, off-viewport content is correctly paged or reported as not-visible (never silently clipped), and snapshot determinism is preserved.
- **Android dump retry (F2):** Android adapter retries transient dump failures with bounded backoff, classifies permanent vs. retryable failures distinctly, and preserves existing crash/ANR vs. adapter-failure discrimination.
- **Docs & state (F3):** `PLATFORM-ADAPTERS.md` / adapter capability notes, `ARCHITECTURE.md` (where adapter contracts touched), `ROADMAP.md`/`STATUS.md`/spec index, and `.inspector/state/campaign.yaml` + `CHECKPOINT.md` synchronized on completion.

## Invariants

- **No global mouse/keyboard:** All sensing/acting remains through adapter-scoped contracts (UIA, PTY, ADB). No host-wide cursor movement, global key injection, or screen-coordinate synthesis outside the target context.
- **No behavior regression:** Existing deterministic replay, evidence quality, budget/lease/fencing, redaction, policy, and cross-platform finding semantics are unchanged. Real-target fixes do not alter fake-adapter determinism or machine JSON contracts (additive fields only, if any).
- **Bounded and classified:** Every retry/probe is bounded (attempt cap + deadline) with stable error classification; transient retries never become infinite loops and never mask permanent defects.

## Workstreams

### F0 — Windows UIA 1-node subtree guard

- Reproduce single-node subtree on a seeded Windows fixture (root valid, children absent on first fetch but present on control-view probe).
- Add guarded subtree expansion: conditional deep probe only when `tree.size == 1 && root.isValid`, bounded to one level, deduplicated by `AutomationId`/`RuntimeId`, merged into snapshot.
- Add classification: probe timeout vs. permanent empty tree kept distinct; no silent fallback to host mouse.
- Tests: unit (tree-merge logic, dedup, bounds), integration (seeded Windows target where probe recovers children; negative case where genuine single-node stays single).

### F1 — PTY viewport edge handling

- Reproduce truncated/misaligned snapshot on small (e.g. 80x24) and scrolled viewports with wrapped lines.
- Fix viewport math: correct cursor/scroll offset, line wrapping, and resize handling; off-viewport elements reported as `visible: false` / paged via adapter action, never silently dropped.
- Preserve determinism: same PTY content + dimensions ⇒ byte-stable snapshot and stable action-coordinate mapping.
- Tests: unit (viewport math matrix: dimensions × scroll × wrap), integration (seeded CLI target asserted through PTY with viewport assertions).

### F2 — Android dump retry hardening

- Reproduce transient `uiautomator dump` failure (injected fault: first dump fails, second succeeds) surfacing as environment failure.
- Add bounded retry with backoff (cap N=3, deadline-bounded) and distinct classification (`transient-dump-retry` vs. `dump-permanent-failure`); retry budget counted in adapter accounting.
- Preserve crash/ANR discrimination: device/app crash still classified separately from dump transport failure.
- Tests: unit (retry/backoff/classification), integration (fault-injected Android helper where retry recovers; permanent failure still fails closed).

### F3 — Documentation and durable-state sync

- Update `PLATFORM-ADAPTERS.md` with the three fidelity notes and capability caveats.
- Synchronize `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`, `specs/README.md` (if indexed), and campaign state.
- Record checkpoint evidence: before/after probes, retry counts, and viewport matrices.

## Task graph / Waypoints

- F0 UIA subtree guard
- F1 PTY viewport
- F2 Android retry
- F3 Docs & state sync (after F0–F2 green)

F0–F2 are independent; F3 is the integration/closure gate.

## Acceptance tests

- **Unit:** subtree merge/dedup/bounds; PTY viewport math (wrap/scroll/resize matrix); Android retry classification (transient vs. permanent, cap enforcement).
- **Integration:** seeded Windows fixture recovers subtree via probe (and genuine single-node stays single); seeded CLI/PTY target proves stable snapshots across viewport sizes; fault-injected Android dump recovers on retry and fails closed on permanent error.
- **Regression:** existing web/pty/windows/android conformance suites still pass; fake-adapter determinism unchanged; no new host-global input path introduced.

## Quality / Exit gate

On the exact final tree:

- New tests (F0–F2) green; no existing test regression.
- `lint` 0 errors, `typecheck` PASS (where applicable), `unit` + `integration` PASS on runnable adapters.
- Manual or CI evidence that host mouse/keyboard was not introduced (code audit of adapter diff).
- Docs/state consistent: `PLATFORM-ADAPTERS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`, `campaign.yaml`/`CHECKPOINT.md` agree; M19 marked COMPLETE only after gate passes.

## Non-goals

- New adapter families (iOS-unblocked runtime, new browser engine, cloud control plane).
- Dashboard redesign, distributed queues, hosted SaaS, vector DB / RAG.
- Scheduler/lease rewrite, campaign repair auto-push, deployment/publication, tag/release.
- Wholesale monorepo refactor or unrelated broad fuzz campaigns.

## Durable-state transition on completion

Set `M19 COMPLETE` in `.inspector/state/campaign.yaml` and `CHECKPOINT.md` only after the exit gate truly passes on the recorded revision. Activate the next roadmap spec (M20) and continue; historical release records remain unchanged.
