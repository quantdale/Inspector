# Inspector Implementation Roadmap

This roadmap is the authoritative milestone order for the autonomous implementation campaign. It is designed to prove the difficult ideas before broadening platform support.

## Campaign rules

- Complete milestones in dependency order unless an explicit blocker makes independent work preferable.
- Each milestone ends with an objective exit gate, not a subjective declaration of completion.
- Passing a milestone does **not** trigger a broad hardening campaign. Activate the next implementation milestone immediately.
- Deep hardening is an overlay campaign invoked separately; see `docs/HARDENING-CAMPAIGN.md`.
- Durable progress lives in `.inspector/state/campaign.yaml`.

## M0 — Foundation kernel

Spec: `specs/000-foundation/`

Goal: executable repository skeleton and durable typed contracts.

Deliverables:

- TypeScript/pnpm workspace;
- core package boundaries;
- SQLite migrations/store;
- protocol schemas and adapter SDK;
- policy/budget engine skeleton;
- artifact store;
- run/checkpoint model;
- fake adapter and conformance tests;
- CLI skeleton.

Exit gate: a deterministic fake environment executes typed observe/action loops, persists ordered events, survives crash/restart, classifies unknown action outcomes safely, and passes specification acceptance tests.

Current status: **COMPLETE** (M0–M7 all COMPLETE; see `docs/STATUS.md` and
`.inspector/state/campaign.yaml` for the authoritative ledger).

## M1 — Web sensing and acting

Spec: `specs/001-web-adapter/SPEC.md`

Goal: give Inspector real senses and hands against an isolated browser target.

Deliverables:

- Playwright/Chromium environment lifecycle;
- browser context reset and deterministic fixture state;
- accessibility/semantic interactive inventory;
- screenshots;
- console/page errors;
- network request/response event capture with redaction;
- semantic click/fill/press/navigation;
- trace artifacts;
- seeded sample web app with known hidden defects.

Exit gate: Inspector traverses the seeded app headlessly without host mouse/keyboard, records a complete replayable observation/action trace, and adapter conformance passes.

## M2 — Finding, evidence, reproduction, minimization

Spec: `specs/002-finding-reproduction/SPEC.md`

Goal: convert raw anomalies into trustworthy findings.

Deliverables:

- finding lifecycle state machine;
- hard deterministic oracle detectors;
- clean reset/replay;
- reproduction thresholds;
- sequence minimization;
- evidence bundle writer;
- deterministic regression scenario export;
- flaky/non-reproducible classification.

Exit gate: seeded crash/state-corruption defects become confirmed findings with minimized reproducers and replayable evidence, while non-defects are rejected or remain candidates.

## M3 — Autonomous exploration

Spec: `specs/003-autonomous-exploration/SPEC.md`

Goal: discover meaningful defects beyond predefined scenarios.

Deliverables:

- state/action graph;
- semantic state fingerprinting;
- novelty and risk scoring;
- cycle avoidance;
- boundary-value and adversarial input generation;
- stateful sequence generation;
- source/change/coverage-informed prioritization where available;
- lifecycle/network fault injection for disposable web targets;
- LLM planner fallback rather than sole controller.

Exit gate: Inspector autonomously discovers multiple hidden seeded defects that are not encoded as hand-authored test paths and produces reproducible evidence for them.

## M4 — Oracle expansion and autonomous repair

Spec: `specs/004-oracle-repair/SPEC.md`

Goal: prove the complete discovery-to-fix loop.

Deliverables:

- invariant/metamorphic oracle SDK;
- weak semantic/vision suspicion path with confidence handling;
- exact-revision Git worktrees;
- source/repository map integration;
- repair-agent context builder;
- regression test generation;
- build/replay/regression verification;
- rejected-patch rollback.

Exit gate: at least one seeded defect is discovered, confirmed, repaired in isolation, replayed successfully, protected by a regression test, and verified without manual debugging.

## M5 — Android adapter

Spec: `specs/005-android/SPEC.md`

Goal: prove the adapter architecture on a fundamentally different platform.

Deliverables:

- ADB environment lifecycle;
- dedicated emulator worker strategy;
- package install/reset/launch/kill;
- logcat/process/device sensors;
- UI Automator helper and semantic UI tree;
- screenshots and semantic actions;
- emulator state fixtures/snapshots;
- lifecycle/network/process interruption hooks;
- seeded Android target app.

Exit gate: the same core finding/reproduction pipeline detects and confirms seeded Android defects with no Android-specific logic leaking into core packages.

## M6 — CLI, Electron, and Windows adapters

Spec: `specs/006-cross-platform/SPEC.md`

Goal: validate the protocol against non-browser/non-mobile interaction models.

Subphases:

1. CLI/PTTY target adapter;
2. Electron adapter reusing browser semantics where safe;
3. Windows native adapter via UI Automation/Appium-compatible tooling and isolated desktop strategy.

Exit gate: all three adapters pass the common conformance contract, produce evidence bundles in the same schema, and require no platform branching in core finding semantics.

## M7 — Scale, integrations, and unattended operations

Spec: `specs/007-scale-integrations/SPEC.md`

Goal: make Inspector practical for long-running real-repository use.

Deliverables:

- isolated parallel workers with ownership/quotas;
- persistent repository/source map;
- impact/change analysis;
- model abstraction and routing;
- request/token/cost accounting;
- scheduling and bounded campaign execution;
- flaky finding clustering/deduplication;
- MCP facade and orchestrator integration;
- plugin/adapter registration and conformance tooling;
- crash-safe multi-run recovery.

Exit gate: Inspector can run a bounded unattended campaign across at least two isolated workers, recover from controller restart, preserve evidence/state, and expose stable external control without compromising internal protocol semantics.

## M8 — iOS simulator adapter (environment-dependent expansion)

Spec: `specs/008-ios/SPEC.md`

Goal: support iOS simulator testing through macOS-hosted automation while keeping the core portable.

Deliverables:

- macOS worker contract;
- simulator lifecycle;
- install/launch/reset;
- XCUITest/Appium/WebDriverAgent-compatible semantic automation;
- screenshots/log collection;
- evidence integration and conformance.

Exit gate: seeded iOS simulator target passes adapter conformance and finding/reproduction flow.

If no macOS environment exists, M8 may be recorded `DEFERRED_ENVIRONMENT` after its adapter interfaces and remote-worker contract are fully specified. This does not block completion of the core implementation campaign M0–M7.

## Implementation campaign definition of done

Required:

- M0 through M7 exit gates pass;
- all durable state is consistent with repository HEAD;
- no known Critical/High regression introduced by the final milestone gates;
- operator/developer docs can bootstrap a clean checkout;
- at least web + Android + CLI/Electron/Windows adapter families demonstrate the common evidence/reproduction model;
- autonomous repair loop is proven end-to-end;
- campaign state is `COMPLETE`.

M8 is complete or explicitly `DEFERRED_ENVIRONMENT` with its reason and resumption requirements recorded.

## M9 — Platform-neutral autonomous exploration (product development)

Spec: `specs/009-native-autonomous-exploration/SPEC.md`

**Status: COMPLETE (2026-08-23).** Exit gate PASS on the final tree
(unit 515 passed / 3 skipped; integration 137/137 after a bounded retry of
the documented concurrent-startup flake class). Field proofs on real
backends: Calculator 56 actions / 50 states; vim 100 actions / 100 states;
com.android.settings 45 actions / 19 states (2-state pre-W7 baseline).
Replay-faithful drivers for android/cli/windows with failure-class
discipline. Remaining depth/replay polish continues under later milestones.

Goal: close audit finding W6 — make product-level autonomous exploration
(`inspector hunt`) capability-driven across CLI/PTY, Windows/UIA, and Android,
replacing bespoke out-of-tree loops.

Deliverables:

- action vocabulary in the protocol (kinds, target schemes, adapter-declared
  risk, autonomousEligible);
- external-side-effect risk gate (adapter-declared risk + contextual label
  deny-patterns + policy ceiling);
- per-platform candidate inventories feeding the existing scorer;
- generic exploration session through RunController/FindingEngine;
- `hunt --adapter cli|windows|android` wiring with durable resume specs.

Exit gate: production hunts autonomously explore a real TUI (vim), a real UWP
app (Calculator or Paint), and com.android.settings on an AVD through the
standard evidence/finding pipeline; per-platform replay-faithful reproduction
is either wired or findings honestly remain CANDIDATE.

## M10 — Resumable exploration campaigns (product development)

Spec: `specs/010-resumable-exploration/SPEC.md`

**Status: COMPLETE (2026-08-23).** Exit gate PASS on `c0835d7`: frozen
install, lint, typecheck, unit 518/3 skipped, and integration 144/144 across
31 files. Deterministic interruption/soak tests plus real Playwright web and
Android Settings interrupt/resume proofs passed; final state synchronization
is recorded in the follow-up checkpoint commit.

Goal: close the remaining SPEC-003 E7 gap so a controller or host process
restart does not make an autonomous web or native hunt forget its exploration
graph, decision history, RNG position, finding deduplication, or consumed
budgets.

Deliverables:

- versioned, validated exploration campaign/checkpoint persistence separate
  from low-level run checkpoints;
- serializable RNG and state/action graph restoration;
- web and native resumable sessions with committed-step/unknown-action
  reconciliation;
- durable action/reset/finding/budget continuity;
- `inspector hunt --resume <runId>` with adapter/target compatibility checks and
  distinct diagnostic `runs resume` behavior;
- deterministic interruption matrix, bounded restart soak, and real-backend
  field proofs where the host environment supports them.

Exit gate: a fresh Inspector process continues an interrupted web and at least
one real native hunt with preserved coverage and budgets; repeated restart tests
show no duplicate actions/findings, sequence/idempotency corruption, unsafe
unknown-action retry, or checkpoint growth beyond retention; all repository
gates and documentation/state synchronization pass.

## M11 — Operator-grade product workflows and distribution (product development)

Spec: `specs/011-operator-product-workflows/SPEC.md`

**Status: COMPLETE — P0-P7 (2026-08-23).** M11 converted the mature internal engines into
the workflows promised by `docs/PRODUCT.md` and validates them from the
installed CLI. M10 remains historically COMPLETE; M8 remains
`DEFERRED_ENVIRONMENT`. Follow-up verification (2026-08-23, `91411fa`) executed
the production Electron field proof for real on a Windows host (Electron
43.4.1), re-ran the full integration sweep green in one pass, added a
display-gated Xvfb Electron CI lane with per-job timeouts, and refreshed the
clean candidate artifact provenance.

Goal: make an operator able to discover, verify, regress, explore, repair, and
operate bounded campaigns without reaching into package internals, while
preserving provenance, isolation, graduated autonomy, and honest environment
classification.

Deliverables:

- real `verify` and `regress` commands using durable evidence and replay/oracle
  machinery;
- explicit durable `explore` workflow and opt-in-only repair from hunt;
- safe `repair <findingId>` around the existing isolated repair pipeline;
- operator-facing scale campaign run/list/show/stop/resume commands;
- product-blocking oracle, containment, redaction, budget, artifact, and web
  attribution fixes;
- production Electron binding/proof when the environment supports it, or an
  honest independent-work-complete environment deferral;
- improved PTY/TUI terminal state, layered CI, truthful release artifacts, and
  clean installed-artifact smoke proof;
- synchronized docs and an end-to-end M11 acceptance matrix.

Exit gate: `verify`, `regress`, `explore`, and `repair` are real tested product
commands; major scale functionality is operator-accessible; required safety
and durability debt is closed or explicitly evidenced; a clean release
artifact executes core and M11 commands; layered CI and applicable repository
gates pass; Electron status is honest; and durable state is marked COMPLETE
with exact evidence. No release or tag publication is performed.

## M12 — Real-target fleet campaigns, capability-aware scheduling, and unattended runtime efficiency (product development)

Spec: `specs/012-real-target-fleet-campaigns/SPEC.md`

**Status: COMPLETE (2026-08-24).** Exit gate PASS: scheduler has no adapter
dependency (pluggable `WorkItemExecutor`, F1); versioned work items + YAML/JSON
manifests with pre-flight validation and a backward-compatible quick path (F2);
shared workflow services in `@inspector/workflows` drive REAL hunt/explore/
verify/regress machinery as campaign items with per-item isolation, provenance,
and honest usage accounting (F3); capability routing from probed backends with
durable refusals (F4); restart/recovery matrix over real-work execution (F5);
graceful SIGINT shutdown (F6); finding aggregation + observability additions
(F7); ≥3 genuinely different real adapter families proven through the campaign
scheduler — web (Playwright), CLI/PTY (ConPTY), android (AVD) — plus the full
fake-engine pipeline (F8); replay-phase optimization with recorded measurements
and behavior-preserving E2E proofs (F9); installed-artifact campaign smoke PASS
(F10); documentation and durable state synchronized (F11).

Goal: remove the fake-target limitation from the campaign product surface so
`inspector campaign` orchestrates real Inspector workflows against real
adapter-backed targets with the durability, isolation, evidence, policy,
budget, restart, lease, and provenance guarantees already built in.

**HARDENING_2 (2026-08-24, separately invoked) hardened exactly this runtime:**
budget permission is now obtained BEFORE budgeted resources are consumed
(structured `budget-exhausted`, exact accounting), cooperative cancellation
reaches the real exploration loops, the scheduler manages lease liveness with
fenced heartbeats, settlement is crash-safe via a pending-settlement journal,
wall budgets survive process restarts, externally-held work reports truthful
`blocked` state (never false `running`), semantically corrupt durable state
fails closed, all-refused campaigns are distinguishable from success, and
verify/regress items reach their producers' findings via validated
`targetConfig.sourceItemId` references. See ADR-0012 and the HARDENING_2
ledger in `.inspector/state/HARDENING-CHECKPOINT.md`.

Deliverables:

- pluggable execution contract (`WorkItemExecutor`) behind the scale scheduler;
  deterministic fake execution becomes one implementation of that contract;
- versioned, validated campaign work-item schema plus a file-based manifest
  interface (`campaign run --manifest <file>`) with a backward-compatible
  quick path;
- capability-aware worker routing from probed backend availability, with
  persisted snapshots/decisions and honest refusal classification;
- reusable workflow services shared by interactive CLI commands and fleet
  executors (hunt/explore first; verify/regress via their replay machinery;
  repair only with explicit authorization);
- per-item isolation and durable campaign → item → worker → run → finding →
  evidence provenance;
- restart/cancellation guarantees proven at campaign scale; finding
  aggregation/deduplication on campaign output; enriched observability;
- web replay runtime-efficiency work with recorded measurements;
- installed-artifact campaign smoke proof.

Exit gate: all SPEC-012 acceptance tests pass; ≥2 genuinely different real
adapter families are exercised through `UnattendedCampaign` on an available
host (honest deferrals elsewhere); installed artifact operates campaigns;
repository gates pass on the final tree; documentation and durable state match.

## M13 — Intelligence-Guided Autonomous QA: model runtime, deliberate exploration, semantic reasoning, source-aware diagnosis, and safe repair assistance (product development)

Spec: `specs/013-intelligence-guided-autonomy/SPEC.md`

Goal: connect Inspector's intentionally incomplete intelligence seams into one
provider-neutral model runtime that can optionally improve exploration
decisions, weak semantic reasoning, context compression, source diagnosis,
and repair proposals — without letting model opinion bypass evidence, policy,
budget, replay, restart, or isolation guarantees. Offline/no-provider
operation remains first-class and deterministic.

Deliverables:

- `@inspector/model-runtime`: provider-neutral contracts, typed invocation
  with attribution, truthful usage reporting, stable failure classification,
  deadline/cancellation, deterministic fallback, response validation hooks;
- durable `model_calls` control plane (additive migration) with hashes and
  redacted metadata — never raw prompts;
- reservation-before-consumption enforcement of `maxModelRequests` /
  `maxTokens` / `maxCostUsd` across global/worker/item scopes with
  crash-safe conservative settlement;
- bounded versioned context packets (planner/oracle/repair) with redaction
  and prompt-injection inertness;
- optional semantic planner inside the existing inventory-bound Planner seam
  with cadence/plateau activation, strict output validation, deterministic
  fallback, and checkpoint/resume continuity;
- optional model-backed weak semantic suspicion that can never confirm a
  defect or authorize repair;
- source/change-intelligent ranking for diagnosis and bounded repair
  context;
- provider-neutral `PatchAgent` proposal path through the existing isolated
  verification pipeline (campaign repair remains unsupported);
- CLI/provider-module configuration, shared workflow wiring, campaign model
  accounting with two-worker concurrency proofs, capability routing for
  model-capable workers, aggregate observability;
- credential-free deterministic test provider, acceptance fixture,
  adversarial/property/restart coverage, installed-artifact smoke.

Exit gate: all SPEC-013 acceptance tests pass on the final tree; full
repository gates plus release smoke pass; a scripted provider proves the
entire intelligence layer with zero credentials/network; docs and durable
state match the implementation.

## Explicitly not required before implementation completion

These are valuable but belong to later hardening/productization unless needed by a milestone gate:

- cloud control plane;
- custom vision model;
- bespoke browser/mobile automation engine;
- reinforcement learning policy;
- polished dashboard;
- exhaustive security/performance/mutation/fuzz campaigns;
- large-scale distributed infrastructure before single-host limits are measured.
