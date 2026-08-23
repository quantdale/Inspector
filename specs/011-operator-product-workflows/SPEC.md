# SPEC-011 — Operator-Grade Product Workflows & Distribution

Status: ACTIVE (M11 activated 2026-08-23)
Milestone: M11
Depends on: SPEC-004, SPEC-007, SPEC-009, SPEC-010

## Objective

Turn Inspector's mature exploration, finding, reproduction, repair, scale,
persistence, and adapter engines into a coherent operator-facing product
available from the installed `inspector` CLI. M11 is productization work, not a
new hardening campaign: it closes the workflows that the product contract
already promises, preserves the graduated-autonomy boundaries, and makes the
distribution honest and testable.

## Product contract

The CLI must expose these durable workflows:

```text
inspector hunt       discover and confirm defects (optional explicit repair)
inspector explore    explore coverage/novelty without patching
inspector verify     replay one durable finding honestly
inspector regress    replay a bounded set of regression scenarios
inspector repair     run the existing isolated repair pipeline
inspector campaign   operate the existing bounded scale engine
```

Human-readable progress is sent to stderr. With `--json`, stdout contains one
valid versioned JSON document and progress remains on stderr. Command errors
use `{ ok: false, error: { kind, message } }` and deterministic exit classes.

## Invariants

- Automation failure (`ACTION_FAILED`, stale selector, missing UIA/ADB node,
  PTY miss, or adapter timeout) is never a target defect.
- Verification binds to the finding's durable run, adapter family, target
  provenance, revision, and minimized evidence. Missing or incompatible
  provenance fails closed.
- Repair requires a durable `CONFIRMED`/`REGRESSED` finding, exact revision,
  explicit repository root, a failing pre-patch regression, an authorized
  patch provider, and a detached isolated worktree. The primary checkout is
  never edited, pushed, merged, or released by the command.
- Explore never implies repair. Hunt repair is opt-in and separately gated.
- Campaign workers use the existing scale scheduler/leases/ledger; the CLI
  does not create a second scheduler.
- Budgets, repair attempts, artifact state, and resumable campaign state remain
  durable across controller restart.
- Evidence and logs are redacted before persistence; artifact staging is
  atomic and orphan cleanup is bounded.

## Workstreams

### P0 — Activation and contract synchronization

Create this specification/task graph, activate M11 in durable state, reconcile
the stale M10 records, add the roadmap milestone, and record a debt audit that
distinguishes M9/M10 closures, M11 open work, environment deferrals, and
decisions that require product input.

### P1 — Verification and regression workflows

Implement `verify <findingId>` and `regress` on the existing replay/oracle/
finding machinery. Load evidence bundles and durable findings, validate
provenance, recreate the original adapter family/target, classify reproduced,
fixed, flaky, environment failure, invalid provenance, incompatible target,
and skipped results, persist verification/regression records, and provide a
stable JSON schema plus deterministic exit codes.

### P2 — Explicit exploration workflow

Implement `explore` as a durable coverage/novelty workflow that reuses the
existing explorer loop, supports resume where applicable, and does not apply
patches or promote observations outside the existing finding lifecycle. Keep
`hunt` semantics intact and make any optional repair authorization explicit.

### P3 — Repair workflow

Implement `repair <findingId>` around `RepairEngine`, `RepairWorkspace`,
`OracleSuite`, and the patch-agent contract. Require `--repo-root` and exact
revision/provenance; support an explicitly configured provider mechanism and
fail actionably when none is configured. Preserve rejected patches and audit
records, enforce path/test policies, exact replay, regression-first checks,
masking probes, and no primary-checkout mutation. Add CLI JSON output and
end-to-end proof with a deterministic provider fixture.

### P4 — Campaign/scale operator surface

Expose bounded `campaign run|list|show|stop|resume` operations using
`@inspector/scale`. Persist campaign configuration and state under the selected
workspace, support clean cancellation/recovery, stable JSON views, explicit
worker/target assignments, and a deterministic two-isolated-worker proof.

### P5 — Product-blocking correctness and durability

Close the specific debt needed by the new workflows: universal oracle failure
classification, filesystem-aware repair containment, deterministic redaction,
durable budgets, atomic artifact staging/orphan cleanup, and web action-window
event attribution. Add deterministic regression/restart/security fixtures.

### P6 — Production binding and operator quality

Add a production-real Electron launch path plus a deterministic fixture when
the host supports Electron; otherwise leave an explicit environment-deferred
record after completing all source-level binding/tests. Improve PTY terminal
state with a deterministic cell-grid/viewport model while preserving raw
evidence. Do not claim real proof from injected backends.

### P7 — CI, distribution, acceptance proofs, and documentation

Strengthen layered CI (fast Linux, Windows-sensitive, release smoke), make
release artifacts carry truthful provenance and clean package contents, prove
fresh npm-tarball installation, and synchronize all operator/product/security
documentation. Build the M11 acceptance matrix, including hunt→verify→regress
→repair, resume, campaign, distribution, and real-backend proofs.

## Stable machine-output contract

Important command JSON uses:

```json
{
  "schema": "inspector-cli/<command>/1",
  "ok": true,
  "command": "verify",
  "result": {},
  "warnings": []
}
```

Failure documents retain `schema`, `ok: false`, `command` when known, and a
stable `error.kind`. Exit classes are: `0` success/healthy result, `2`
reproduced target defect/regression, `3` environment unavailable or
incompatible target, `4` invalid provenance/configuration/policy refusal, and
`1` unexpected Inspector/internal failure. A command may report a healthy
`fixed`/`resolved` result with exit `0`.

## Acceptance tests

- CLI unit tests cover parsing, help, JSON shape, missing values, stable error
  kinds, and exit classes for all M11 commands.
- Integration tests prove verify/regress classification and provenance refusal
  against seeded fake/web/native fixtures.
- A deterministic seeded workflow proves hunt → confirmed finding → verify →
  regression → repair in a detached worktree → exact replay/regression pass,
  masking checks, rejected-patch preservation, and untouched primary checkout.
- An interruption/resume test proves no duplicate durable actions/findings and
  no budget reset.
- A scale integration proof runs two isolated workers with leases, budgets,
  deduplication, restart, and clean cancellation.
- Oracle, redaction, containment, budget, artifact, and settle-window fixtures
  cover the product-blocking debt named above.
- A real Electron proof is recorded only when the actual Electron runtime is
  exercised; otherwise the blocker and all completed independent work are
  recorded as `ENVIRONMENT_DEFERRED`.
- Fresh release-artifact installation runs `inspector --version`, `doctor`, a
  fake hunt, finding/run inspection, and at least one M11 command.
- Applicable lint, typecheck, unit, integration, platform, and release-smoke
  gates pass.

## Non-goals

- No publication, npm release, GitHub release, deployment, or tag movement.
- No automatic push, merge, or edit of the operator's checkout.
- No global mouse/keyboard injection or weakened policy boundary.
- No restart of HARDENING_1 or implicit HARDENING_2.
- No claim of real iOS support; M8 remains `DEFERRED_ENVIRONMENT`.
- No cloud control plane or broad dashboard rewrite.

## Exit gate

M11 is complete only when the product workflows, campaign surface, required
correctness fixes, distribution proof, layered CI, documentation, acceptance
matrix, and repository gates all pass, with Electron either production-real
proven or honestly environment-deferred. Durable state records exact evidence
and remains internally consistent with the final commit.
