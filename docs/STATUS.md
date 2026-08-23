# Project Status

Last updated: M11 COMPLETE (2026-08-23)

## Campaign

- Mode: **M11 — Operator-grade product workflows and distribution: COMPLETE**.
  M9 native autonomous exploration and M10 resumability are complete. M11
  P0-P7 and its exit gate are complete.
  Canonical state is recorded in `.inspector/state/campaign.yaml`.
- RC1_FIELD_VALIDATION: **COMPLETE** — decision **GO_WITH_DOCUMENTED_DEBT**
  for candidate **0.1.0-rc.2** (tree `85011ca`). Report:
  `docs/GA-FIELD-VALIDATION-REPORT.md`.
- Implementation campaign M0–M7 + M9: **COMPLETE**. HARDENING_1:
  **COMPLETE**. DOGFOOD_RC1: **COMPLETE**. RC1_FINALIZATION: **COMPLETE** —
  `v0.1.0-rc.1` tagged at `ddeea86`, never moved.
- rc.2 remains **NOT_PUBLISHED and untagged** (no release authority).
- Working branch: `main`

## M9 outcome

Capability-driven native exploration is product reality: `inspector hunt`
explores real Windows/UIA, CLI/PTTY, and Android targets through the standard
evidence/finding pipeline with platform-faithful replay drivers and
failure-class discipline (automation misses never become defects). Field
proofs on the final tree: Calculator 56 actions/50 states; vim 100 actions/
100 states; com.android.settings 45 actions/19 states (2-state pre-W7
baseline). Full exit gate PASS (unit 515/3skip; integration 137/137 after a
bounded retry of the documented concurrent-startup flake class).

## M10 outcome

The active implementation has a versioned, checksummed exploration checkpoint
stream (`inspector-exploration-checkpoint/1`) alongside low-level run steps.
Serializable Mulberry32 state, StateGraph snapshots, committed-step
reconciliation, durable reset/action budgets, web/native campaign restoration,
finding-class persistence, and `inspector hunt --resume <runId>` are wired.
Deterministic web and native interruption tests plus a bounded multi-restart
soak pass. Real-backend proofs also pass: a Playwright seeded-web hunt was
interrupted at run `run_4842e061213d4415971e879c3615973c` and resumed to its
original 12-action cap (5 states, 1 reset, one confirmed PAGE_ERROR, 28
monotonic steps, 8 retained checkpoints); a real ADB Settings hunt was
interrupted at run `run_7eb518e2e11849a3bcd97a66f73abd0b` and resumed to its
original 8-action cap (3 states, 16 monotonic steps, 8 retained checkpoints).
The available machine has no `vim` executable, and the Calculator UIA create
probe exceeded its 30-second lifecycle deadline; those backends remain
environmental non-proofs, not substituted mock passes. The real web and
Android proofs satisfy the M10 native/backend exit requirement.

The deterministic matrix covers committed-step/checkpoint lag, pending and
unknown actions, seeded multi-restart boundaries, bounded checkpoint history,
corrupt/incompatible checkpoints, native edge/RNG restoration, and CLI
process-kill continuation. The seeded restart soak uses boundaries 1, 2, 4,
and 6 and ends with unique monotonic steps, exactly the configured action
budget, and no checkpoint growth beyond retention 8.

## M11 outcome

The installed CLI now exposes durable `verify`, `regress`, `explore`,
`repair`, and `campaign run|list|show|stop|resume` workflows over the existing
finding, replay/oracle, repair, exploration, and scale engines. Product-facing
JSON schemas and deterministic outcome classes distinguish reproduction,
fixed, flaky, environment failure, incompatible target, policy refusal, and
internal errors. Discovery never implies patching permission.

M11 P5 closed the product-blocking oracle false-positive, realpath repair
containment, freeform redaction, restart-durable budget/accounting, atomic
artifact cleanup, and timestamped web attribution debt. P6 added a production
Playwright Electron binding and deterministic fixture with explicit real vs
injectable selection, plus a real PTY VT viewport/cursor/resize model. The
current host has no downloaded Electron executable: the production field proof
is `ENVIRONMENT_DEFERRED`, not substituted with a mock result.

P7 completed layered Linux/Windows CI configuration, the clean installed
npm-tarball smoke, the end-to-end acceptance matrix, stable CLI error output,
and final documentation/state reconciliation. No rc.2 package, release, or
tag has been published.

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
| frozen install | PASS |
| lint | PASS (0 errors; 4 pre-existing warnings) |
| typecheck | PASS |
| test (unit) | PASS (533 passed / 3 skipped) |
| test:integration | PASS after bounded retries (155 passed / 1 skipped across 37 files) |
| M11 acceptance matrix | PASS |
| installed release smoke | PASS (fresh npm prefix) |

M11 final evidence on the current tree: P1-P4 product integration proofs
and P5 safety gates pass; P6 typecheck/lint pass, VT viewport integration
passes, Electron injectable conformance is 2/2, and the real Electron test is
honestly skipped because the executable is unavailable. P7's installed-artifact
smoke passes from a fresh npm prefix (`inspector-cli-0.1.0-m11.0.tgz`). The
full parallel integration sweep exposed only the documented concurrent
subprocess-startup class; bounded isolated retries passed without weakening
assertions. The clean candidate SHA-256 is
`a626595041a3b1a9aab87145fca8fd36708c84e9bc015253041d4e54039001f3`, with
manifest source commit `e6f4c78471e030a39fcf9e232cb12e2b781bc8e3` and
`source.dirty: false`.

M10 final-gate evidence is the `c0835d7` implementation commit plus the
following state-synchronization commit; historical RC1 reports remain
unchanged.

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
| M9 Platform-neutral exploration | COMPLETE |
| M10 Resumable exploration | COMPLETE |
| M11 Operator workflows/distribution | COMPLETE |

The machine-readable source of truth is `.inspector/state/campaign.yaml`.
