# HARDENING_5 Deep-Audit Addendum — Verification Truth and Provenance Integrity

Planner audit baseline: `main` @ `04d8d841d7d1db322800fa0b8439878639d2c81d` (2026-08-26).

This addendum is **additive** to the existing H5 proposal/design/specs/tasks. It does not declare H5 complete and does not supersede already-landed H5 work. It records new defects discovered while reviewing the post-H5.7 implementation and current H5.9 state.

## Why these findings belong to H5

The active H5 tasks still include replay/error-classification negative space (H5.4.5), the adversarial/soak/installed-artifact matrix (H5.8), and exact-tree truth/certification (H5.9). These defects sit directly inside that unfinished scope. Do not open H6 to escape them.

## Audit facts at planning time

- Existing mechanical census: 530 tracked files, 530 reviewed, zero exclusions. Regenerate after this planner commit.
- `campaign.yaml` says H5 ACTIVE, H5.8 DONE, H5.9 PENDING.
- `tasks.md` still leaves H5.8.1-H5.8.6 and H5.9.1-H5.9.7 unchecked, plus H5.2.6/H5.4.5.
- `AGENTS.md`/`docs/STATUS.md` still expose stale H4/no-active-campaign current-state prose.
- Actions run 32985028766 for the planning-baseline SHA was queued during the audit; queued is not certified.

## Defect/suspicion ledger

| ID | Planning status | Source evidence | Failure mode |
| --- | --- | --- | --- |
| H5-D6 | CONFIRMED | `.inspector/state/HARDENING-CHECKPOINT.md`, parent `05254ff` | latest state-sync deleted ~698 lines of historical hardening ledger |
| H5-D7 | CONFIRMED | `packages/workflows/src/campaign-executor.ts` verify path | `environment-failure` can transition CONFIRMED -> RESOLVED |
| H5-D8 | CONFIRMED | same file, regress path | replay exceptions become `reproduced:false` and are counted clean; skipped drivers can yield zero valid scenarios |
| H5-D9 | CONFIRMED | `packages/finding/src/finding-engine.ts`; timeout-only test | all replay errors with zero successes become REJECTED, conflating no evidence with clean evidence |
| H5-D10 | CONFIRMED | `campaign-executor.ts` vs `scale/src/executor.ts` contract | verify/regress charge before replay without admit-before-consume |
| H5-D11 | REPRO REQUIRED | Electron replay/hunt + durable spawn provenance | missing backend pin can make historical replay choose current-host real/injectable mode |
| H5-D12 | CONFIRMED | campaign executor integration tests + `.github/workflows/ci.yml` | tautological/pass-by-return assertions and hosted jobs do not prove new campaign-level platform lanes |
| H5-D13 | SUSPICION | FindingEngine rehydrate + replay path construction | malformed durable data may silently degrade evidence or violate containment; prove before changing |

## Systemic pattern

The recurring defect class is **information collapse**: a rich outcome (`environment error`, `not executed`, `unknown backend`, `missing provenance`) becomes a boolean/default and is then interpreted as clean/fixed/rejected/success. H5 completion must remove this semantic collapse at trust boundaries rather than patch only one branch.

## Positive-evidence rule

The correction campaign adopts this invariant:

> A negative product conclusion requires positive execution evidence.

Therefore:

- `fixed`/`RESOLVED` requires successful environment-valid clean verification according to policy;
- `clean` regression requires a successfully executed replay whose oracle is clean;
- `REJECTED` reproduction requires successfully executed non-reproducing attempts sufficient under policy;
- environment/adapter/provenance/cancellation/budget failures are indeterminate operational outcomes, not target-quality evidence.

## Current certification gaps

1. A web-finding assertion in `campaign-executor.integration.test.ts` is `>= 0`, which cannot fail.
2. The real Android fleet test returns from the test body when its env gate is missing; default green does not prove execution.
3. Windows CI currently covers native/adapter/CLI paths but not the H5 `windows-campaign.integration.test.ts` campaign path.
4. Electron Xvfb currently proves the production adapter runtime, not the H5 workflow/fleet campaign path.
5. H5 source-vs-installed parity for changed verification/backend paths remains part of unfinished H5.8/H5.9.

## Planner constraints

- Restore durable history before broad implementation.
- Red test before fix for every confirmed behavioral defect.
- Do not weaken oracle/finding semantics, skip tests, inflate timeouts, or map errors to success.
- Do not silently migrate backend provenance based on what happens to be installed on the current machine.
- Preserve M13 COMPLETE and M8 DEFERRED_ENVIRONMENT; no M14, release, tag, or publication.
- H5 remains ACTIVE until the exact implementation SHA passes the required local and hosted gates.
