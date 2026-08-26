# Inspector Execution Prompt — HARDENING_5

**Status:** ACTIVE (2026-08-26 — activated by the executor session after reconciling `main`: pulled planner commit `7214ae4`, baseline `217165c` hosted run 32955622320 SUCCESS; HARDENING_5 recorded in canonical state `.inspector/state/campaign.yaml` `hardening5:` block and ledger campaign #5 before implementation edits).  
**Campaign:** HARDENING_5 — Fleet Execution Truth, Platform Parity, Cross-Platform Durability, and Measured Runtime Efficiency  
**Mode:** HARDENING  
**Target branch:** `main` only  
**Planned from:** `217165cd4a6c39c0726b12b01edf2c6c4056a6e1` (`HARDENING_4 COMPLETE` state-synchronization HEAD)  
**Planner date:** 2026-08-26  
**OpenSpec change:** `openspec/changes/hardening-5-fleet-truth/`  
**Intended scale:** one substantial autonomous campaign. Continue through the full evidence-backed scope; do not stop after the first defect. Do not invent work merely to consume time.

## 1. Why this is the next campaign

The implementation roadmap ends at M13. M13 is COMPLETE; M8 iOS remains environment-deferred; no M14 exists. `packages/repo-contract/src/campaign-state.test.ts` explicitly guards against inventing M14. Therefore this is a separately invoked hardening campaign, not a new implementation milestone.

The planning baseline is unusually strong: current `main` HEAD `217165c` has GitHub Actions run `32955622320` completed SUCCESS with Linux lint/typecheck/unit/full integration, Windows native/path coverage, Linux installed-artifact smoke, and real Electron/Xvfb proof. Start from that green exact-tree baseline and preserve it.

The audit nevertheless found a concrete cross-layer fleet truth contradiction that current gates do not cover:

1. `@inspector/scale` declares `AdapterFamily = fake | web | cli | windows | android | electron` and manifest validation accepts `electron`.
2. `InspectorWorkflowExecutor` advertises the Electron family when `probeElectron()` succeeds, so the scheduler can legitimately route an Electron work item to it.
3. `packages/workflows/src/types.ts` cannot represent Electron at all: `ExplorationAdapter` is only `web | fake | cli | windows | android`.
4. `packages/workflows/src/campaign-executor.ts::familyAdapter()` does not handle Electron and falls through to `fake`.
5. `packages/workflows/src/workspace.ts::adapterSpawn()` cannot resolve the Electron adapter binary and also falls through to `fake` for unknown names.
6. `packages/workflows/src/exploration.ts` treats only CLI, Windows, and Android as native; there is no Electron exploration branch.
7. `packages/workflows/src/replay-subject.ts::replayDriverFor()` has web/fake/CLI/Windows/Android replay but no Electron replay.
8. The dedicated Electron adapter itself is real and tested; it intentionally reuses browser semantics while preserving Electron identity, and hosted Xvfb now proves the real runtime works. The defect is therefore in orchestration/product integration, not absence of an adapter.

Taken together, an accepted/routed Electron campaign can cross a control plane that claims Electron capability into a workflow path that silently selects the fake adapter. Treat this as a likely HIGH/CRITICAL trust defect until deterministic reproduction establishes exact externally observable behavior and severity. Never fix it by merely rejecting Electron if the intended product contract is to support the already-declared family; reconcile the contract end-to-end.

Additional evidence-backed debt belongs in the same campaign because it crosses the same product/runtime boundaries:

- historical fleet state says Windows/UIA and Electron campaign lanes were unwritten/deferred; Windows now has generic native workflow plumbing, but it still needs a real end-to-end campaign proof and truth reconciliation rather than assumptions;
- Electron verify/regress replay is unsupported even if hunt/explore is made real;
- workflows/CLI/artifact atomic rename sites still lack the bounded Windows sharing-violation retry that HARDENING_4 proved necessary for hot reread state files; audit every atomic-write implementation and close only confirmed durability gaps;
- `FileLock` remains synchronous `Atomics.wait` based while SQLite leases are the production default; change it only if profiling shows a meaningful real bottleneck or liveness problem;
- web exploration/replay remains expensive (historically ~4–6 minutes in full E2E); optimize from measured profiles, not intuition;
- an interrupted H4 session preserved an unlanded 17-file speculative performance patch at `.inspector/tmp/h4-stray-perf-batch-2026-08-26.patch` (and a local stash on that machine). Treat it only as a hypothesis source: inspect any available patch, benchmark each idea independently, and never apply it wholesale;
- durable prose still contains historical Electron-host-unavailable statements that are now stale relative to hosted real Electron/Xvfb success. Reconcile truth without rewriting historical evidence.

## 2. OpenSpec is the execution contract

Read these first, in order:

1. `openspec/changes/hardening-5-fleet-truth/proposal.md`
2. every delta under `openspec/changes/hardening-5-fleet-truth/specs/`
3. `openspec/changes/hardening-5-fleet-truth/design.md`
4. `openspec/changes/hardening-5-fleet-truth/tasks.md`

If OpenSpec tooling is installed, validate/show the change before implementation and use the equivalent of the apply workflow. If it is not installed, the Markdown artifacts remain authoritative; do not block the campaign merely to install tooling. Do not archive/sync this OpenSpec change until the hardening completion gate passes.

## 3. Mandatory activation and rehydration

Before any implementation edit:

1. Fetch/prune origin and verify `main`, worktree cleanliness, HEAD, `origin/main`, ahead/behind state, and current hosted CI. Preserve any legitimate newer work; do not overwrite concurrent changes.
2. Read `.agent/PLANNER_HANDOFF.md`, this prompt, `.inspector/state/campaign.yaml`, `.inspector/state/CHECKPOINT.md`, `.inspector/state/HARDENING-CHECKPOINT.md`, `AGENTS.md`, `docs/HARDENING-CAMPAIGN.md`, `docs/ROADMAP.md`, and `docs/STATUS.md` completely.
3. Read SPEC-012, SPEC-013, ADR-0012, ADR-0013, platform/adapters, architecture, security, exploration, evidence, observability, product, development, and release documents as required by the touched contracts.
4. Inspect at least the most recent 30 meaningful commits and their diffs, including M12, HARDENING_2, M13, HARDENING_3, HARDENING_4 activation/fixes/completion. Understand why existing guards exist before changing them.
5. Recheck open issues and PRs. Planning-time open PR count was zero; do not assume it remains zero.
6. Transition HARDENING_5 to ACTIVE in canonical durable state and append campaign #5 to `.inspector/state/HARDENING-CHECKPOINT.md`. Preserve all M0–M13 and H1–H4 history and M8 deferral. Update this prompt status to ACTIVE in the same activation checkpoint so repo-contract truth remains coherent.
7. Establish stable H5 defect IDs. Every defect must progress: suspicion → deterministic evidence → severity → regression test/proof → fix → transitive verification → CLOSED.

Do not implement from chat history. Re-read live source.

## 4. Mandatory every-file audit proof

The operator explicitly requested a deep audit of every file/system/logic path. Make that mechanically auditable instead of claiming it informally.

Create/update `.inspector/state/HARDENING_5-AUDIT.md` from the live checkout with a tracked-file census produced from `git ls-files` (or an equivalent exact Git index inventory). Every tracked authored file must receive a disposition, either individually or through a clearly enumerated homogeneous group whose member paths are listed. At minimum classify:

- runtime source and package manifests;
- unit/property/fuzz/integration/soak tests and fixtures;
- adapter implementations and native helpers;
- protocol, persistence, artifact, finding/oracle/explore/repair/model/scale/workflow logic;
- CLI and installed-artifact surfaces;
- scripts, build/release/CI configuration, workspace config, lockfile implications;
- docs, ADRs, specs, OpenSpec artifacts, agent instructions, durable state schemas;
- dogfood/repro assets and intentionally committed Inspector evidence/state;
- hidden agent/tool configuration that can affect execution.

Generated/vendor/cache files may be excluded only when they are not tracked authored source; record the exclusion rule. The final H5 report MUST state the tracked-file count, reviewed count, excluded count/reasons, and prove `reviewed + justified exclusions == tracked files`. A sample or package-level skim is not sufficient.

For substantive files, trace behavior rather than only reading names. For each major system map happy path, invalid input, failure, cancellation, timeout, crash/restart, concurrent ownership, corruption, platform loss, and installed-package behavior where applicable.

## 5. Required system maps

Build/use these maps during the audit:

```text
manifest -> validateWorkItem/AdapterFamily -> capability probe -> scheduler/router -> InspectorWorkflowExecutor -> family mapping -> workspace adapter spawn -> RunManager -> real adapter
```

```text
Electron manifest -> electron capability -> workflow types -> spawn -> ElectronAdapterHandler -> real/injectable backend -> observation/action evidence -> finding -> replay -> verify/regress
```

```text
Windows manifest -> UIA capability -> native workflow -> adapter spawn -> RealUiaBackend -> evidence -> replay -> verify/regress
```

```text
artifact/workflow/CLI state write -> unique temp -> flush/fsync policy -> rename -> Windows sharing violation / POSIX semantics -> reader -> crash recovery / orphan cleanup
```

```text
exploration action -> checkpoint -> replay/minimization -> oracle -> evidence -> verify/regress -> fleet settlement -> resume
```

```text
campaign -> scheduler -> SQLite/JSON state -> leases/fencing -> worker -> budget gate -> workflow -> settlement -> restart
```

```text
source checkout -> build/release -> installed prefix -> adapter executable resolution -> platform prerequisites -> hosted CI certification
```

## 6. Ordered workstreams

### H5.0 — Exact baseline, every-file census, and defect ledger

- Reproduce exact current baseline and query Actions for current HEAD.
- Build the complete tracked-file audit inventory described above before broad implementation.
- Identify all adapter-family declarations, switches, default branches, string unions, manifests, replay mappings, binary resolvers, capability tags, docs, fixtures, and tests. Search for every place a new/known adapter family can be silently collapsed to fake/default behavior.
- Search for all `rename*`, temp-file, atomic-write, cleanup, lock/wait, checkpoint, replay, and capability-fallback implementations.
- Record initial suspected defects separately from proven defects.

### H5.1 — Reproduce and close Electron fleet false-execution risk

Construct a deterministic campaign manifest with an Electron work item and an Electron-capable injected/real capability snapshot. Prove the exact current path and resulting adapter/run/evidence identity before editing.

Required invariants after the fix:

- a work item accepted as `adapterFamily: electron` can never execute as fake, web, or another family without an explicit, contract-defined transformation that preserves Electron target identity;
- every accepted adapter family is representable in the workflow layer;
- adapter resolution is exhaustive and fail-closed: an unknown/unimplemented family returns a typed configuration/capability refusal before work starts, never a fake fallback;
- campaign result notes, durable run adapter, environment adapter, evidence bundle, finding adapter, usage, and replay provenance all agree;
- capability advertisement never exceeds executable capability;
- no test-only injectable backend is reported as a real Electron field proof unless the result explicitly identifies it as injectable.

Prefer compile-time exhaustiveness (`never`/exhaustive maps) over default fallthroughs where practical.

### H5.2 — Platform-complete real fleet lanes: Electron and Windows/UIA

Electron:

- thread Electron through workflow types/config, adapter binary resolution, lifecycle/start/resume, exploration engine choice, target configuration, cancellation, evidence, checkpoints, and installed-artifact resolution;
- choose the smallest semantically correct exploration model. Electron deliberately reuses browser semantics inside its adapter, but the run must retain `adapter-electron`/Electron identity; do not masquerade it as `web-playwright` or fake;
- prove injectable deterministic campaign coverage and real Electron/Xvfb field coverage when available;
- prove capability-unavailable behavior when the executable/display is absent.

Windows/UIA:

- determine whether current generic native plumbing already makes Windows campaigns fully real; if yes, add missing campaign-level proof and reconcile stale debt rather than rewriting working code;
- if gaps exist, close them through the same manifest → routing → workflow → UIA → evidence → replay chain;
- hosted Windows CI should execute a bounded campaign-level UIA proof where runner constraints permit, not merely package-level unit tests.

### H5.3 — Electron replay, verify, regress, resume, and evidence continuity

- Add platform-faithful Electron replay support for durable findings; use durable target/backend provenance and preserve Electron identity.
- Verify/regress items referencing Electron producer workspaces must reproduce against Electron, never fake/web by accident.
- Resume must restore the same adapter family/backend/target and reject incompatible provenance.
- Test missing executable/display, malformed provenance, target drift, crash during replay, cancellation, and evidence artifact failures.
- Ensure minimization/oracle automation-failure classification stays correct; adapter/environment failures are not target defects.

### H5.4 — Adapter-family contract centralization and negative-space sweep

Audit all duplicated adapter-family vocabularies and switches across scale, workflows, CLI args/config, metadata, workspace spawn, exploration, replay, finding, adapters, tests, release packaging, and docs.

- Remove unsafe default-to-fake behavior where the input comes from validated product configuration.
- Centralize only when it reduces drift without creating a dependency cycle; otherwise add repo-contract tests that force all declared families to be handled by every required layer.
- Add a matrix/property test over every declared family covering manifest acceptance, capability requirement, executable mapping, durable adapter identity, and replay support/refusal.
- Confirm future new adapter families cannot compile/pass CI while silently skipping one layer.

### H5.5 — Cross-platform atomic-write durability completion

Inventory every atomic writer, rename-based commit, orphan-temp cleanup, artifact metadata write, CLI/workflow state write, and repair/worktree write.

Reproduce Windows sharing-violation behavior before broad changes. Then:

- create/reuse a narrow bounded retry primitive only for transient sharing violations (`EPERM`/`EACCES`/platform-equivalent proven by tests); never retry semantic/path/permission errors indefinitely;
- preserve unique temp ownership and never allow a reader/cleanup sweep to remove a live writer's temp;
- decide and document flush/fsync/directory-sync guarantees by artifact class rather than pretending all writes have identical durability requirements;
- keep failures loud and typed; never silently reset or truncate state;
- prove Windows and POSIX behavior with deterministic tests and hosted runners where possible.

Do not rewrite SQLite-backed production state into JSON or weaken H4 fencing.

### H5.6 — Measured performance/resource campaign

Performance changes are evidence-gated. Establish reproducible baselines first: median plus spread/p95 where feasible, warm/cold separation, CPU/wall/IO counts where useful, and exact fixture/seed.

Priority targets:

1. web exploration/replay 4–6 minute E2E cost;
2. repeated SQLite prepare/query hot paths;
3. ledger aggregation/fingerprint recomputation;
4. state/artifact temp sweeps;
5. checkpoint frequency and serialization cost;
6. CI dependency/cache opportunities that do not hide hermeticity bugs;
7. synchronous FileLock waiting only if it appears in a real hot path.

The preserved H4 speculative patch is not an implementation plan. For every idea recovered from it, create an independent benchmark/hypothesis, cherry-pick/reimplement only the minimal proven change, and discard anything that weakens crash recovery, cancellation, checkpoint continuity, evidence determinism, CI clean-runner behavior, or test isolation.

Do not delete correctness checkpoints merely for speed. If coalescing/checkpoint reduction is considered, inject crashes at every newly enlarged window and prove bounded recovery/replay equivalence.

### H5.7 — Truth surfaces, stale debt, OpenSpec, and operator semantics

- Reconcile `docs/STATUS.md`, `docs/ROADMAP.md`, `AGENTS.md`, `.inspector/state/*`, release/dogfood reports, comments, and task/spec claims against actual H5 results.
- Preserve historical statements as history, but correct current debt surfaces that still say real Electron proof is unavailable when hosted Xvfb has succeeded.
- Keep M8 iOS environment-deferred unless a genuine macOS/Xcode/simulator becomes available. Do not emulate success through mocks.
- Do not invent M14 and do not release/tag/publish.
- Keep the OpenSpec tasks/deltas synchronized as findings change. Archive/sync only after completion.

### H5.8 — Adversarial matrix, soak, and flake classification

Run targeted property/state-machine/multi-process campaigns for:

- all adapter families and unknown-family refusal;
- parallel fleet items across fake/web/CLI/Windows/Android/Electron where environments permit;
- cancellation at start/observe/action/checkpoint/evidence/settlement boundaries;
- lease loss and stale completion during slow platform operations;
- crash/restart around Electron/native lifecycle and atomic renames;
- malformed/stale replay provenance;
- executable/display/ADB/UIA disappearance mid-item;
- artifact/temp cleanup races;
- model assistance remaining web-only by explicit contract unless deliberately expanded.

Every flake classification needs bounded reproduction evidence. Do not solve red tests by increasing timeouts or skipping assertions without proving environment causality.

### H5.9 — Exact-tree certification

Local/available environment gate on the exact final tree:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @inspector/adapter-web provision:browser
pnpm test:integration
pnpm release:smoke
```

Also run targeted Windows, Electron, fleet, replay, atomic-write, and performance suites introduced by H5.

Push normal commits to `main` without force. Then query GitHub Actions for the exact pushed SHA and require all intended lanes to actually execute—not merely be skipped. A completion report that refers to an older SHA is not certification of the current one.

## 7. Acceptance gates

HARDENING_5 may be marked COMPLETE only when all are true:

1. the every-file audit census proves every tracked authored file was reviewed or explicitly justified as non-authored/generated;
2. the Electron accepted/routed-to-fake contradiction is deterministically reproduced and closed with regression coverage;
3. no declared adapter family can silently fall through to fake/default execution;
4. Electron campaign hunt/explore is real and identity-faithful, with honest environment refusal when prerequisites are absent;
5. Electron verify/regress/replay and resume either work platform-faithfully or are rejected at preflight by an explicit narrowed product contract—never accepted then mis-executed;
6. Windows/UIA has an end-to-end campaign proof or an evidence-backed environment deferral reflected consistently in truth surfaces;
7. cross-platform atomic-write debt is either closed where violations are reproducible or narrowed/documented with tests showing why unaffected writers are safe;
8. performance work has recorded before/after evidence; no speculative patch is landed wholesale and no correctness gate/checkpoint is weakened for speed;
9. all Critical/High defects discovered during the campaign are CLOSED; lower-severity debt is explicitly recorded with rationale;
10. installed-artifact behavior matches source-workspace behavior for changed fleet/platform paths;
11. OpenSpec artifacts and durable campaign/checkpoint state match implementation truth;
12. local gates pass on the exact final tree;
13. hosted CI passes on the exact pushed final implementation SHA with expected Linux, Windows, installed-artifact, Electron, and integration steps actually executed;
14. no release, tag, deployment, destructive external action, or force-push occurred.

## 8. Git/reporting requirements

- Work directly on persistent `main` per `AGENTS.md`; disposable worktrees/branches may be used only locally and must not be left as persistent campaign branches.
- Pull/reconcile before each push if origin moved. Never force-push.
- Commit coherent verified slices; include durable state/checkpoint updates with the slice when practical.
- The final commit message must be a detailed session report: baseline SHA/CI, every-file census counts, confirmed defect table with severities/root causes/fixes/tests, performance before/after data, exact local gate counts, hosted run/job IDs on the certified SHA, environment deferrals, remaining debt, and explicit statement that no release/tag/publication occurred.
- Push the completed state so the next agent can rehydrate from Git alone.

When this prompt and the OpenSpec artifacts differ, the stricter safety/correctness requirement wins; update both before proceeding if a material contradiction is found.
