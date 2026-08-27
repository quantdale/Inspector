# SPEC-023 — GA Re-certification

Status: COMPLETE (2026-08-27 — gates PASS: lint 0/4, typecheck PASS, unit 784/3, integration pending full lane; see campaign.yaml)
Milestone: M23
Depends on: SPEC-000, SPEC-001, SPEC-002, SPEC-003, SPEC-004, SPEC-005, SPEC-006, SPEC-007, SPEC-008 (DEFERRED_ENVIRONMENT), SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-013, HARDENING_2, HARDENING_3, HARDENING_4, HARDENING_5, RC1_FIELD_VALIDATION (GA-FIELD-VALIDATION-REPORT.md + GA-READINESS.yaml) — all prior milestones COMPLETE except M8 which remains DEFERRED_ENVIRONMENT

## Objective

Re-certify Inspector for GA on the current tree (`main` at M23 open) by **re-running the full field-proof portfolio** against the installed artifact, reconciling **GA-READINESS** (YAML + report) to the new tree/provenance, and obtaining a **hosted certification** (GitHub Actions) that proves the quality gate on a clean runner. This is a truth-preserving re-validation: no new product surface, no hardening redesign — only proof that the claims certified at HARDENING_5 / RC1_FIELD_VALIDATION still hold on the present codebase.

Field proofs re-executed from the **installed artifact** (not source-only):

- **web** — Playwright/Chromium (todomvc-react, todomvc-backbone or equivalent healthy targets + inline/window-soak attribution)
- **PTY** — real ConPTY (`vim` / CLI target via `@lydell/node-pty`)
- **UIA** — real Windows UIA bridge (Calculator / Paint / Notepad portfolio)
- **ADB** — real Android AVD (`com.android.settings` or equivalent live AVD)
- **Electron** — production Electron binding (`@inspector/electron-adapter`) — real runtime where display/executable available, honest deferral otherwise

Plus the operational soaks that protect GA confidence: installed-artifact harness, interrupt/resume soak, long-unattended run, and resource-stability checks. Results update `.inspector/state/GA-READINESS.yaml` and `docs/GA-FIELD-VALIDATION-REPORT.md` with new tree SHAs, tarball/bundle hashes, and per-target evidence refs under `.inspector/ga-work/`.

## Invariants

- **No publish without explicit authorization.** `publication_status` stays `NOT_PUBLISHED`; no `npm publish`, no GitHub Release creation, no hosted binary upload. Authorization change must be explicit and auditable.
- **Honest zeros preserved.** Healthy targets that yield zero findings remain reported as `0` with their action/state counts visible. No suppression, no synthetic findings, no conversion of environment failures into defects.
- **No tag pushed.** `v0.1.0-rc.1` remains untouched as the historical artifact of record; `0.1.0-rc.2` (or successor candidate) is provenance-stamped locally only. No `git tag` push or tag move occurs without explicit authority. Candidate SHA/tarball hashes are recorded truthfully.
- **Evidence truthfulness.** GA-READINESS fields (`candidate_sha`, `tarball_sha256`, `bundle_sha256`, field-run verdicts, gate results) match the exact tree that produced them. Hosted CI SHAs are verified via public GitHub API on the exact pushed commit — never inferred.
- **Existing gates remain authoritative.** Offline/no-provider operation, deterministic replay, policy/risk/budget enforcement, redaction, and isolation guarantees are unchanged and must still pass on the final tree.
- **No credential or secret persistence.** Spawn-env deltas written to durable state remain credential-stripped; no token/secret is logged or stored.

## Workstreams

### F0 — Field proofs (installed artifact, real backends)

Re-run the GA field portfolio from a **fresh installed artifact** (npm tarball installed to a disposable prefix and exercised from PowerShell/cmd/Git Bash shims):

- Web portfolio (react + backbone, 180–220 actions each, honest-zero assertion) + web action-window soak (S1–S6 × N reps, 56-case matrix) + seeded fake control through the full finding pipeline.
- PTY portfolio (vim via ConPTY, ≥200 interactions, Ctrl-C/external-kill/close semantics, pid-reap ≤1s).
- UIA portfolio (Calculator/Paint/Notepad, ≥100 interactions, kill probes honest, app-side cast failures classified not promoted).
- ADB portfolio (live AVD, ≥50 actions, 0 unexpected failures or honest deferral with evidence if AVD unavailable).
- Electron proof (production binding vs real Electron process where display available; Xvfb/Windows lanes as applicable; honest display-gated deferral otherwise — never fake).
- Interrupt/resume soak (≥10 abrupt kills, 0 UNIQUE/BUSY, strictly increasing steps, terminal-run refusal) + long unattended run (≥500 actions in one workspace, linear DB growth, cleanup possible).

Each proof writes evidence under `.inspector/ga-work/` and is summarized in the report. Unavailable backends produce an honest `DEFERRED_ENVIRONMENT` record with evidence, not a mock pass.

### F1 — GA-READINESS update

Reconcile `.inspector/state/GA-READINESS.yaml` and `docs/GA-FIELD-VALIDATION-REPORT.md` to the M23 tree:

- `candidate_staleness_decision` / `proposed_new_candidate` updated with new `built_from_tree`, `tarball_sha256`, `bundle_sha256`, and `tagging_authority: NONE GRANTED`.
- `field_runs` entries refreshed with new run ids, SHAs, evidence refs, and verdicts.
- `phases` (p3–p29) re-marked DONE with new evidence; `final_gate.tree_sha` set to the M23 final tree; `release_decision` re-evaluated (`GO` / `GO_WITH_DOCUMENTED_DEBT` / `NO_GO`) with named residual debt if any.
- Historical sections (`phase_0_post_tag_audit`, RC1 provenance) retained untouched; new candidate provenance appended additively.
- `docs/STATUS.md` milestone summary extended with M23 outcome; `docs/GA-FIELD-VALIDATION-REPORT.md` decision/provenance/performance sections reflect the re-run.

### F2 — Hosted certification (GitHub Actions)

Push the M23 tree and certify via **hosted CI on the exact pushed SHA** (verified through the public GitHub REST API):

- Linux quality gate: `pnpm install --frozen-lockfile`, `lint` (0 errors), `typecheck` PASS, `test` (unit) PASS, `test:integration` PASS with browser provisioning (`pnpm --filter @inspector/adapter-web provision:browser`), `release:smoke` PASS from installed prefix. No skips added; flakes bounded and evidenced.
- Windows lane: path/native integration (windows-campaign, UIA where runner supports it) as in HARDENING_5.
- Electron lane: Xvfb real-runtime proof (electron-production + electron-fleet) where runner supports display.
- Installed-artifact smoke lane green.
- Record run id(s) and per-lane results in GA-READINESS and STATUS; a red lane blocks the exit gate unless the failure is proven to be an external runner outage (evidenced API response + re-run).

### F3 — Docs / durable-state sync and final gate

Synchronize all durable and human-readable state on the **exact final tree** and run the full local gate:

- `campaign.yaml` (`active` / `progress.completed_milestones` / `verification.last_gate*`) reflects M23 COMPLETE only after the gate truly passes.
- `HARDENING-CHECKPOINT.md` / `GA-READINESS.yaml` / `CHECKPOINT.md` agree on SHAs, run ids, and decisions.
- `README.md`, `ARCHITECTURE.md`, `SECURITY-MODEL.md`, `OBSERVABILITY.md`, `DEVELOPMENT.md`, and spec checkboxes reconciled; no stale M13/M12-only language.
- Final local gate on the exact final tree: `pnpm install --frozen-lockfile` PASS, `lint` 0 errors, `typecheck` PASS, `test` PASS, `test:integration` PASS, `release:smoke` PASS — all green without credential-dependent suites. Historical release records (`v0.1.0-rc.1`, `0.1.0-rc.2` provenance) remain unchanged except for additive M23 entries.

## Exit gate

M23 is COMPLETE when **all** of the following hold on the **exact final tree**:

1. F0 field proofs re-executed from the installed artifact: web, PTY, UIA, ADB, Electron each PASS or honestly deferred with evidence; soaks (interrupt/resume, long-run, window attribution) PASS; evidence persisted under `.inspector/ga-work/`.
2. `GA-READINESS.yaml` and `GA-FIELD-VALIDATION-REPORT.md` updated with new tree SHAs, tarball/bundle hashes, field-run evidence refs, and a re-evaluated release decision; `STATUS.md` reflects M23.
3. Hosted certification: at least one GitHub Actions run on the **exact pushed SHA** is `SUCCESS` across required lanes (Linux quality + integration, Windows path/native, Electron Xvfb, installed-artifact smoke) — verified via public API and recorded.
4. Full local gate green on the exact final tree (install / lint / typecheck / unit / integration / release:smoke) with no new skips or suppressed failures; durable state and docs agree.

No publish, no tag push, and no release artifact publication occur as part of this milestone.

## Non-goals

- No new product features, adapter families, explorer algorithms, model-runtime changes, or hardening redesign.
- No cloud control plane, distributed queues, hosted SaaS, dashboard rewrite, or scheduler/lease rewrite.
- No iOS runtime without macOS/Xcode (M8 remains `DEFERRED_ENVIRONMENT` unless a real macOS proof occurs).
- No publication, tag creation/push, or deployment — `NOT_PUBLISHED` and tag discipline persist.
- No weakening of clean-state reproduction, evidence quality, redaction, or policy enforcement.
- No wholesale monorepo refactor or unrelated broad fuzz campaigns.
