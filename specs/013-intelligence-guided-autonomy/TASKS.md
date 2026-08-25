# SPEC-013 Task Graph — Intelligence-Guided Autonomous QA

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Baseline audit + activation (audit notes in CHECKPOINT.md; baseline
      gates recorded: install OK, lint 0 errors/4 pre-existing warnings,
      typecheck PASS, unit 568 passed/3 skipped @51 files on `385d3c6`)
- [x] F1/F2 `@inspector/model-runtime` package: types, roles, provider
      metadata, invocation contract, failure taxonomy, router with
      deterministic fallback, deadline/cancel, usage truth; scale back-compat.
- [x] F3 `model_calls` migration (#12) + Store APIs + tests.
- [x] F4/F5 Reservation-based model budget gate (global/worker/item, atomic),
      crash-safe invocation semantics + fault-injection tests.
- [x] F6 Context packet builders (planner/suspicion/repair) with bounds,
      redaction, hashes, injection inertness + tests.
- [x] F7 Semantic planner integration in ExploreController (+ checkpoint/
      resume state) + tests; F19 acceptance fixture; no-RNG-contamination proof.
- [x] F8 Model-backed semantic suspicion evaluator + disposition safety tests.
- [x] F9/F10 Source intelligence ranking + upgraded repair context + tests.
- [x] F11 ModelPatchAgent + structural validation + F22 E2E repair fixture
      (accept + reject paths).
- [x] F12 Bounded summarization memory + degradation tests.
- [x] F13 CLI model configuration + doctor/help reporting + JSON stability.
- [x] F14 Shared local-provider module loader (extracted to model-runtime,
      reused by CLI and fleet executor; shape validation + classifications).
- [x] F15 Shared workflows receive optional model runtime (CLI == fleet path;
      web explorer seam; fake/native stay deterministic with honest notes).
- [x] F16 Campaign model accounting through ExecutionContext + two-worker
      concurrency ceiling proofs (shared global scope + per-item scope).
- [x] F17 Capability routing tags (`model-planner`, `model-semantic-oracle`)
      declared from real executor configuration; refusals unchanged.
- [x] F18 Deterministic test provider covering the simulation matrix
      (valid/malformed/schema-invalid/errors/hang/delay/health flips/
      known+unknown usage) — embedded in @inspector/model-runtime/scripted.
- [x] F20 Adversarial security suite (injection inertness, action fabrication,
      risk escalation vs policy, context overflow, patch traversal/tamper,
      secret redaction, confidence spoofing).
- [x] F21 Property/fault-injection coverage (200-payload planner fuzz,
      unique attempt ids, bounded packets under size storms, non-negative
      accounting storms, TTL restart windows, deterministic redaction).
- [x] F23 Restart/resume integration matrix (admission denial / deadline /
      pre-abort cancel / started-row crash window / accepted-decision resume
      via persisted checkpoint with a fresh controller; reservation held at
      death blocks overspend until conservative TTL conversion).
- [x] F24 Aggregate observability (`models summary` command + additive
      `model` block in hunt/explore JSON + runtime stats).
- [x] F25 Cost/performance discipline measured in fixtures (packet byte
      ceilings enforced, cadence floor + per-run caps on planner calls,
      zero-provider runs make zero calls with identical sequences).
- [x] F26 Installed-artifact smoke extension (help/models/provider load/
      invalid-provider refusal from the installed prefix).
- [x] F27 Documentation + durable state reconciliation + final gate +
      final commit/push.

## Exit checklist

- Full repository gate green on the exact final tree (install/lint/typecheck/
  test/test:integration/release:smoke).
- No known Critical/High regression open in affected paths.
- Docs/state agree; M13 COMPLETE recorded with exact evidence.
