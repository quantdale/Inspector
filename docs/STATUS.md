# Project Status

Last updated: M9 native exploration in progress (GA COMPLETE)

## Campaign

- Mode: **M9 — Platform-neutral autonomous exploration** (spec:
  `specs/009-native-autonomous-exploration/SPEC.md`; state:
  `.inspector/state/campaign.yaml`)
- RC1_FIELD_VALIDATION: **COMPLETE** — decision **GO_WITH_DOCUMENTED_DEBT**
  for candidate **0.1.0-rc.2** (tree `85011ca`). Report:
  `docs/GA-FIELD-VALIDATION-REPORT.md`.
- Implementation campaign M0–M7: **COMPLETE**. HARDENING_1: **COMPLETE**
  (66 defects closed). DOGFOOD_RC1: **COMPLETE**. RC1_FINALIZATION:
  **COMPLETE** — `v0.1.0-rc.1` tagged at `ddeea86`, never moved.
- rc.2 remains **NOT_PUBLISHED and untagged** (no release authority).
- Working branch: `main`

## M9 progress (native exploration)

Capability-driven hunts are proven on real backends through the standard
pipeline: Windows Calculator (40 actions / 14 states), real vim over ConPTY
(80 actions / 80 distinct states), com.android.settings on an AVD (65 actions,
honest-zero). Active waypoint W6 adds platform-faithful replay drivers so
real-discovered findings can be reproduced without mock backends, plus W7
Android exploration depth and W8 finding-pipeline proofs + exit gate.
Known limitation until W6 lands: native findings stay honestly CANDIDATE.

## Candidate staleness (GA decision)

Field validation found and fixed two runtime defects (FIELD-1 HIGH:
resume never re-created the environment on a fresh adapter process, fixed in
`cc0d34b` with deterministic regression coverage; FIELD-2 MEDIUM: UIA rehost
recovery could not follow a window that migrated to a new owner pid, fixed in
`e40fa2d`). The original `v0.1.0-rc.1` tag is untouched and remains the
historical validated artifact of record; the GA-proposed candidate is
**0.1.0-rc.2**, rebuilt from tree `85011ca` with full provenance recorded in
`.inspector/state/GA-READINESS.yaml` (`candidate_staleness_decision`). No
replacement tag has been created or pushed.

## Field validation summary

Real targets exercised from the installed rc.2 artifact: web todomvc-react
and todomvc-backbone (honest-zero findings on healthy apps), Windows UIA
Calculator/Paint/Notepad (114 unscripted interactions), vim over real ConPTY
(265 interactions; Ctrl-C/external-kill/close all honest; every
session-attributed vim pid reaped ≤745 ms), Android Settings on a live AVD
(60 actions / 40 clicks / 0 failures), plus the seeded control through the
full finding pipeline. Interrupt/resume soak against the installed artifact:
14 abrupt kills — 11 clean resumes, 3 honestly-documented refusals, zero
UNIQUE/BUSY errors, strictly increasing step sequences, terminal runs refuse
resume. Web pageerror/action-window attribution: 56/56 scenario passes across
8 repetitions per class. Evidence: `.inspector/ga-work/`.

## Verified gates

| Gate | Result |
| --- | --- |
| lint | PASS |
| typecheck | PASS |
| test (unit) | PASS |
| test:integration | PASS |

Final-gate numbers are refreshed at the end of the field-validation campaign
(see `.inspector/state/GA-READINESS.yaml` `final_gate`).

## Known blockers

None blocking continued validation.

## Milestone summary

| Milestone | State |
| --- | --- |
| M0 Foundation | COMPLETE |
| M1 Web adapter | COMPLETE |
| M2 Finding/reproduction | COMPLETE |
| M3 Autonomous exploration | COMPLETE |
| M4 Oracle/repair | COMPLETE |
| M5 Android | COMPLETE |
| M6 Cross-platform adapters | COMPLETE |
| M7 Scale/integrations | COMPLETE |
| M8 iOS | DEFERRED_ENVIRONMENT |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
