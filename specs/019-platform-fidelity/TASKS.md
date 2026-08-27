# SPEC-019 Task Graph — Platform Fidelity (M19)

Checkboxes flip only when the task's gate actually passes.

- [x] F0 — Windows UIA 1-node subtree guard: reproduce single-node tree on seeded Windows fixture, add bounded one-level control-view probe with dedup (AutomationId/RuntimeId) behind valid-root guard, keep host-global input absent; unit + integration tests green.
- [x] F1 — PTY viewport edge handling: reproduce wrap/scroll truncation on small viewport, fix viewport math (cursor/scroll/wrap/resize) with deterministic snapshots and correct off-viewport visibility; viewport-matrix unit + seeded PTY integration tests green.
- [x] F2 — Android dump retry hardening: reproduce transient uiautomator dump failure, add bounded retry (N=3, deadline) with transient vs. permanent classification preserving crash/ANR discrimination; unit + fault-injected integration tests green.
- [x] F3 — Docs and durable-state sync: update PLATFORM-ADAPTERS.md / ARCHITECTURE.md / ROADMAP.md / STATUS.md, synchronize campaign.yaml + CHECKPOINT.md, final gate (new tests green, no regression, no global mouse/keyboard, docs/state consistent) and mark M19 COMPLETE.

## Exit checklist

- New F0–F2 tests green; no existing suite regression.
- No host-global mouse/keyboard introduced (adapter-diff audit).
- Docs/state agree; M19 COMPLETE recorded only after gate passes on the exact final revision.
