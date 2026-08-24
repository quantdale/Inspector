# SPEC-013 Task Graph — Intelligence-Guided Autonomous QA

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Baseline audit + activation (audit notes in CHECKPOINT.md; baseline
      gates recorded: install OK, lint 0 errors/4 pre-existing warnings,
      typecheck PASS, unit 568 passed/3 skipped @51 files on `385d3c6`)
- [ ] F1/F2 `@inspector/model-runtime` package: types, roles, provider
      metadata, invocation contract, failure taxonomy, router with
      deterministic fallback, deadline/cancel, usage truth; scale back-compat.
- [ ] F3 `model_calls` migration (#12) + Store APIs + tests.
- [ ] F4/F5 Reservation-based model budget gate (global/worker/item, atomic),
      crash-safe invocation semantics + fault-injection tests.
- [ ] F6 Context packet builders (planner/oracle/repair) with bounds,
      redaction, hashes, injection inertness + tests.
- [ ] F7 Semantic planner integration in ExploreController (+ checkpoint/
      resume state) + tests; F19 acceptance fixture; no-RNG-contamination proof.
- [ ] F8 Model-backed semantic suspicion evaluator + disposition safety tests.
- [ ] F9/F10 Source intelligence ranking + upgraded repair context + tests.
- [ ] F11 ModelPatchAgent + structural validation + F22 E2E repair fixture
      (accept + reject paths).
- [ ] F12 Bounded summarization memory + degradation tests.
- [ ] F13 CLI model configuration + doctor reporting + JSON stability.
- [ ] F14 Shared local-provider module loader (extracted, validated).
- [ ] F15 Shared workflows receive optional model runtime (CLI == fleet path).
- [ ] F16 Campaign model accounting through ExecutionContext + two-worker
      concurrency ceiling proofs.
- [ ] F17 Capability routing for model-capable workers + honest refusals.
- [ ] F18 Deterministic test provider covering the full simulation matrix.
- [ ] F20 Adversarial security suite (injection, fabrication, traversal,
      overflow, tamper, secrets, spoofing).
- [ ] F21 Property/fault-injection coverage around new contracts.
- [ ] F23 Restart/resume integration matrix incl. one fresh-controller
      persisted resume.
- [ ] F24 Aggregate observability + bounded inspection surface.
- [ ] F25 Cost/performance discipline measurements.
- [ ] F26 Installed-artifact smoke extension.
- [ ] F27 Documentation + durable state reconciliation + final gate +
      final commit/push.

## Exit checklist

- Full repository gate green on the exact final tree (install/lint/typecheck/
  test/test:integration/release:smoke).
- No known Critical/High regression open in affected paths.
- Docs/state agree; M13 COMPLETE recorded with exact evidence.
