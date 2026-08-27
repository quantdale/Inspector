# SPEC-023 Task Graph — GA Re-certification (M23)

Checkboxes flip only when the task's gate actually passes on the exact final tree.

- [x] F0 Field proofs — re-run GA portfolio from the installed artifact (web, PTY, UIA, ADB, Electron) plus window/interrupt/long-run soaks; evidence under `.inspector/ga-work/`; honest zeros and honest deferrals preserved; no mock passes
- [x] F1 GA-READINESS update — reconcile `.inspector/state/GA-READINESS.yaml` and `docs/GA-FIELD-VALIDATION-REPORT.md` with new tree SHAs, tarball/bundle hashes, field-run verdicts/evidence refs, and re-evaluated release decision; retain RC1 history additively
- [x] F2 Hosted certification — push M23 tree and obtain GitHub Actions SUCCESS on the exact pushed SHA across Linux quality+integration, Windows path/native, Electron Xvfb, and installed-artifact smoke lanes (verified via public API); record run ids
- [x] F3 Docs/state sync + final gate — synchronize `campaign.yaml`, `HARDENING-CHECKPOINT.md`, `STATUS.md`, and docs to the final tree; full local gate green (install / lint / typecheck / unit / integration / release:smoke); no publish and no tag pushed

## Exit checklist

- All F0 proofs green or honestly deferred with evidence; no environment failure promoted to defect
- GA-READINESS and GA-FIELD-VALIDATION-REPORT reflect the exact final tree and hosted run(s)
- Hosted CI SUCCESS on the exact pushed SHA across required lanes
- Full repository gate green on the exact final tree; docs/state agree; M23 COMPLETE recorded only after the gate truly passes
