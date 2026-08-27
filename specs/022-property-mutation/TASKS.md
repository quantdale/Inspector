# SPEC-022 Task Graph — Property and Mutation Testing

Checkboxes flip only when the task's gate actually passes.

- [x] F0 Lifecycle property suite — deterministic seeded generators over finding state machine (valid/invalid transitions, terminal absorption, restart persistence, shrinking on failure); suite green with logged seeds.
- [x] F1 Budget property suite — deterministic seeded generators over admission/settlement/crash-TTL/concurrency; asserts non-negative, never oversubscribed, denial ⇒ no invocation, conservative crash settlement; suite green with logged seeds.
- [x] F2 Replay vocabulary property suite — deterministic seeded generators mixing legal and fabricated actions (200+ payloads); asserts only inventory actions execute, fabrications rejected at validation; suite green with logged seeds.
- [x] F3 Mutation matrix and kill proof — enumerate bounded mutants (lifecycle/budget/replay vocab seams), run suite per mutant, achieve 100% kill rate, record proof artifact (`mutation-proof.json`) with mutant → killing test → seed mapping.

## Exit checklist

- Property suites (F0–F2) deterministic, seeded, and green on the exact final tree with no flake.
- Mutation matrix executed; every mutant killed; proof artifact recorded and reviewed.
- Full gate green: lint (0 errors), typecheck PASS, unit PASS, integration PASS.
- M22 marked COMPLETE in durable state only after the gate truly passes.
