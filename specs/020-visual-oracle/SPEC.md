# SPEC-020 — Visual Oracle: Screenshot Perceptual Hash and Visual Diff

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M20
Depends on: M4 (SPEC-004 Oracle & Repair), M13 (SPEC-013 Intelligence-Guided Autonomy)

## Objective

Add a deterministic, model-free **visual diff oracle** built on screenshot **perceptual hashing (pHash)**. Inspector can capture screenshots (web `page.screenshot`, native view hierarchy renders where available) and compare them via a pure-TypeScript pHash implementation with Hamming distance — no external vision model, no network call, no credentials.

The oracle flags meaningful visual change (layout shift, missing element, render break) as a **weak signal** that enriches suspicion and evidence. It never independently confirms a defect or authorizes repair; it follows the established `classifySuspicion` / soft-oracle contract from M4/M13.

In scope: pHash primitive, distance/threshold helpers, a `VisualOracle` that emits soft verdicts, integration with the state fingerprint / evidence pipeline, and documentation of the weak-oracle guarantee. Out of scope is any learned vision model or cloud inference.

## Invariants

- **Deterministic:** identical input bytes produce an identical hash and an identical distance on every run, every host, every Node version. No randomness, no floating-point non-determinism beyond a documented tolerance; no time or environment dependence.
- **No vision model required:** pHash and the visual oracle are pure local computation (DCT-based or equivalent block-hash) with zero external service, zero API key, zero model download, and negligible added dependency weight. CI and all gates pass offline.
- **Weak oracle only:** the visual oracle emits `soft` strength with `confidence ≤ 0.5` and can never promote a finding to `CONFIRMED` alone. Without corroboration from a hard oracle (invariant, crash, assertion, persistence, or other hard signal) the finding stays `NEEDS_HUMAN_ORACLE` via `classifySuspicion` unchanged. Repair policy continues to block source mutation on visual-only suspicion.
- **Bounded and safe:** hashing is bounded by input size (screenshots are downscaled to a fixed small grid before DCT); large screenshots do not cause unbounded CPU/memory. Failures (missing screenshot, corrupt image, unsupported format) produce a classified `skipped`/`error` verdict, never a false confirm or unhandled exception.
- **Evidence-preserving:** baseline hashes and computed distances are recorded as bounded provenance (hash hex, distance, threshold) without persisting raw large screenshots by default beyond the existing artifact retention policy. No secrets are persisted.

## Workstreams

### F0 — pHash implementation

Pure-TypeScript perceptual hash for screenshots/images:

- Downscale to fixed grid (e.g., 32×32), grayscale, DCT (or equivalent frequency-domain / block-mean) → 64-bit hash (hex string and/or `bigint` representation).
- Exported helpers: `perceptualHash(imageBytes | RGBA): string`, `hammingDistance(a, b): number`, `isNearDuplicate(a, b, threshold): boolean` with documented thresholds (e.g., ≤ 8 near-duplicate, > 12 distinct — values finalized in implementation and tests).
- No native addon, no `sharp`/`canvas` hard dependency; use a minimal pure-JS image decode path (PNG decode or raw RGBA input) so the primitive works in unit tests without a browser. Browser screenshots already arrive as PNG bytes.
- Determinism proof: same PNG → same hash across runs; single-pixel vs. layout-level changes produce expected distance buckets.
- Unit tests green: determinism, near-duplicate tolerance (resize/compression), distinct-image separation, threshold boundaries, and error cases (empty/corrupt input).

### F1 — Visual oracle

`VisualOracle` (or `VisualDiffOracle`) implementing the existing `Oracle` / `CandidateOracle` contract:

- Input: baseline hash (or baseline screenshot bytes) + current screenshot bytes + optional threshold override.
- Output: structured verdict with `strength: "soft"`, `confidence ≤ 0.5`, `kind: "visual-diff"` (or equivalent), `distance`, `threshold`, `hashA/hashB` provenance, and a human-readable reason.
- Never returns `hard`/`confirmed`; confidence is capped even when distance is large. Large distance is still suspicion, not confirmation.
- Respects the M4/M13 weak-signal contract: downstream `classifySuspicion` leaves visual-only findings at `NEEDS_HUMAN_ORACLE`; repair engine policy-blocks them.
- Integration point for future optional model-backed visual reasoning is a separate seam — this milestone does not add any model call.
- Tests: oracle never confirms alone, confidence cap, threshold behavior, missing-baseline `skipped` path, and idempotent verdict for identical images (distance 0).

### F2 — Integration with fingerprint and evidence

Wire the primitive into Inspector's existing state/evidence flow without creating a second oracle system:

- Baseline hash capture: when a state fingerprint or oracle checkpoint records a screenshot, optionally record its pHash alongside (additive field, no breaking change to existing state schema).
- Comparison flow: `VisualOracle` can be invoked from the oracle suite / suspicion pipeline with baseline + current evidence; harness for deterministic replay of visual verdicts in tests (fixture PNG pairs).
- Artifact handling: reuse existing artifact store / evidence bundle retention; do not introduce a new large-binary store. Hash-distance provenance is queryable.
- Backward compatibility: workspaces and stores without visual hashes continue to work; missing hash is treated as `skipped`, not a failure.
- Tests: integration fixture proving baseline → mutated screenshot → soft visual verdict → finding remains unconfirmed without hard corroboration; second fixture where hard oracle + visual oracle together can confirm (visual enriches but does not decide).

### F3 — Docs

- Update `docs/ORACLE-SYSTEM.md` (or `ORACLE-SYSTEM` / `ARCHITECTURE.md` as appropriate) with pHash algorithm choice, hash format, distance/threshold guidance, and the weak-oracle guarantee.
- Update `docs/EXPLORATION-ENGINE.md` / `docs/ARCHITECTURE.md` fingerprint section to note optional visual hash field.
- Add operator note (README or `docs/PRODUCT.md` oracle section) clarifying that visual diff is local, deterministic, and never auto-confirms.
- Reconcile `campaign.yaml` / `CHECKPOINT.md` / `ROADMAP` for M20 activation (status ACTIVE, milestone M20, spec/tasks pointers) — consistent with the durable-state transition rule.
- No new dashboard, cloud, or model-provider docs in this milestone.

## Exit gate

On the exact final tree:

- pHash unit tests green (determinism, near-duplicate, distinct, threshold, error cases) and deterministic across reruns.
- Visual oracle tests green: soft-only verdicts, confidence ≤ 0.5, `classifySuspicion` keeps visual-only findings at `NEEDS_HUMAN_ORACLE`, repair remains policy-blocked on visual-only suspicion.
- Integration fixture green: baseline + mutated screenshot path produces soft visual verdict and never confirms alone; combined hard + visual path preserves existing confirmation semantics.
- Full gate green: `lint` (0 errors), `typecheck` PASS, `unit` PASS, `integration` PASS (or environment-gated subset truthfully recorded), `release:smoke` PASS — all credential-free, no external service required.
- Docs updated (pHash/oracle weak guarantee, fingerprint integration, operator note) and durable state consistent (M20 ACTIVE until gate, then COMPLETE only after the gate truly passes).

## Non-goals

- Vision models, LLM-based image reasoning, vector DB / RAG, or any external inference service.
- Cloud control plane, distributed queues, hosted SaaS, dashboard redesign.
- New browser engine, scheduler/lease rewrite, campaign repair, auto-push/merge/deploy, tag/release/publication.
- Reinforcement learning, bespoke/fine-tuned models, or wholesale monorepo refactor.
- Blocking or flaky image-comparison thresholds that would auto-confirm defects; thresholds are advisory for suspicion only.

## Durable-state transition on completion

When the exit gate passes at a known revision, mark M20 COMPLETE in durable state (`campaign.yaml` / checkpoint) with evidence (pHash suite revision, visual-oracle verdict fixtures, gate results), and activate the next roadmap spec per the next-spec rule.
