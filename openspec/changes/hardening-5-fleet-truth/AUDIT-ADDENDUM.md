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

## 2026-08-27 planner re-audit — exact current HEAD

The re-audit was performed against `main@6df14d5945e057761afdde8be7d07d6b7b2ace54` after the prior planner correction landed. This section supersedes older "queued/pending" observations where they conflict with newer evidence.

### Exact-HEAD hosted evidence

GitHub Actions run `32988428201` for exact HEAD `6df14d5` completed **FAILURE**:

- Linux quality gate job `98239998815`: install, lint, typecheck, unit, and browser provisioning passed; full `pnpm test:integration` failed.
- Unit gate: 64 files / 676 tests passed.
- Integration gate: 50 files total; 47 passed, 2 skipped, 1 failed. 211 tests total; 205 passed, 5 skipped, 1 failed.
- The failing test is `packages/workflows/src/windows-campaign.integration.test.ts`, producer/verify/regress campaign truth. `report.failed` was empty but `report.completed` was also empty when three completed items were required.
- Windows path/native job passed.
- Electron real-runtime/Xvfb and Linux installed-artifact jobs were skipped downstream of the failed Linux quality job. They are therefore **not certification evidence for this SHA**.

Source tracing explains the Linux failure: the test explicitly selects `INSPECTOR_WINDOWS_BACKEND=mock`, but `InspectorWorkflowExecutor.capabilities()` derives Windows family availability only from `probeUia()`; `probeUia()` returns unavailable on non-Windows before considering configured mock execution. The scheduler therefore records capability refusals and removes every Windows item from the queue. This is backend-selection/capability-model drift, not a random assertion flake.

### Additional defects

| ID | Status | Evidence | Failure mode |
| --- | --- | --- | --- |
| H5-D14 | CONFIRMED | `scripts/gen_audit_census.py`, `.inspector/state/HARDENING_5-AUDIT.md` | the "every-file review" generator never reads file contents and unconditionally assigns `R` from pathname/category; 530/530 was bookkeeping, not evidence of review. The generator also states lockfile/dependency output is untracked although `pnpm-lock.yaml` is tracked. |
| H5-D15 | CONFIRMED | exact-HEAD run `32988428201`; `capabilities.ts`; `windows-campaign.integration.test.ts`; `campaign.ts` | explicit Windows mock execution is runnable but capability discovery advertises only real-UIA host availability, causing every item to be refused on Linux. The report can consequently have zero failures and zero completions while work was never executed. |

Additional direct source evidence strengthens earlier findings:

- **H5-D11 is CONFIRMED at the defaulting boundary:** Electron missing backend provenance falls through to replay `auto`; CLI missing/non-real provenance falls to mock; Android missing/non-mock provenance falls to real; Windows missing/non-mock provenance constructs the default driver. Durable replay semantics can therefore depend on defaults/current host unless provenance is made explicit and validated.
- **H5-D13 is PARTIALLY CONFIRMED:** `FindingEngine.rehydrate` maps malformed JSON arrays to `[]` and malformed structured JSON to `null` rather than reporting durable corruption. Whether unvalidated IDs can also produce filesystem containment violations remains a red-test requirement; do not claim that subcase until reproduced.

### Audit-certification correction

The existing census may remain useful as a tracked-path inventory, but it is not a review certificate. The final H5 audit must separate:

1. **inventory evidence** — exact final `git ls-files`, blob SHA/content hash, classification;
2. **review evidence** — content-aware review status, system-map participation, findings/notes or explicit no-finding rationale;
3. **exclusion evidence** — only genuinely generated/vendor/cache content, with a concrete reason.

A generator MUST NOT mark an authored file reviewed merely because its path matches `packages/`, `docs/`, `specs/`, or another category. New/changed blobs invalidate prior review evidence for that path.

### Consequence for H5 completion

H5 is unequivocally ACTIVE. Exact current HEAD is red, the prior 530/530 review claim is insufficient, H5-D6..D15 remain to be resolved/classified, and required hosted Electron/installed-artifact lanes did not execute on the current SHA. The executor must complete H5.10 and all still-open H5.2/H5.4/H5.8/H5.9 tasks before any COMPLETE claim.

