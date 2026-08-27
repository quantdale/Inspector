# SPEC-014 Task Graph — Replay Performance

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Baseline measurement — reproducible replay-cost baseline (wall time + driver sessions) for a fixed web fixture suite; methodology and raw numbers recorded.
- [x] F1 Persistent driver audit — audit/fix lifecycle and isolation of the replay-phase driver-reuse path; auditable reuse contract; no state leakage or cleanup regression.
- [x] F2 Benchmark guard — deterministic benchmark harness measuring replay-phase savings vs F0 baseline; fails on regression beyond threshold; CI-runnable, bounded, credential-free.
- [x] F3 Docs — persistent-driver optimization, benchmark guard usage, and measured savings documented; README/ARCHITECTURE/EXPLORATION-ENGINE/campaign.yaml/CHECKPOINT.md/ROADMAP reconciled.

## Exit checklist

- Benchmark shows replay-phase savings vs baseline with identical outcomes.
- Full gate green on the exact final tree (lint/typecheck/test/test:integration/release:smoke).
- Docs/state agree; M14 COMPLETE recorded with exact evidence.
