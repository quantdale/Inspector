# AGENTS.md

This file is the operating contract for autonomous coding agents working on Inspector.

## Campaign mode

The repository has completed the **M13 — INTELLIGENCE_GUIDED_AUTONOMOUS_QA
(Intelligence-Guided Autonomous QA)** implementation milestone and,
separately invoked under `docs/HARDENING-CAMPAIGN.md`, the **HARDENING_2**,
**HARDENING_3**, and **HARDENING_4 — certification integrity, durable-state
atomicity, and cross-process ownership fencing — COMPLETE (2026-08-26;
hosted certification run 32936068493 SUCCESS on exact pushed SHA `f687ef1`)**
campaigns (RC1 field validation and M9-M12 are complete; M8 iOS remains
`DEFERRED_ENVIRONMENT`). No implementation milestone campaign is currently
ACTIVE. **HARDENING_5** (Fleet Execution Truth, extended through deep-audit
verification-outcome-truth, replay-backend-provenance, and durable-history-
integrity correction — defects H5-D0..H5-D13) is ACTIVE per
`.agent/EXECUTION_PROMPT.md` and `.inspector/state/campaign.yaml`; its
completion gate (all Critical/High defects CLOSED, hosted CI verified on the
exact pushed SHA) must pass before any COMPLETE claim. Continue only when the
next roadmap milestone or campaign is explicitly activated via
`.agent/EXECUTION_PROMPT.md`; do not infer a release from this state.

The intent is unattended forward development: continue implementing the roadmap without waiting for routine human approval. Deep audits, broad refactors whose only purpose is cleanup, exhaustive fuzzing, and other hardening-only work belong to a separately invoked hardening campaign.

The campaign's canonical machine-readable state is `.inspector/state/campaign.yaml`. Never infer progress from chat history.

## Rehydration order

At the start of every fresh session, context reset, crash recovery, or handoff:

1. Read `.inspector/state/campaign.yaml`.
2. Read `.inspector/state/CHECKPOINT.md`.
3. Read this `AGENTS.md`.
4. Read `docs/AUTONOMOUS-IMPLEMENTATION.md`.
5. Read `docs/ROADMAP.md`.
6. Read the active specification and task file named in campaign state.
7. Read relevant architecture documents and ADRs only as needed for the active task.
8. Inspect Git status, recent commits, and the actual implementation before changing code.

Do not ask the user to restate prior progress if these files are available.

## Authority and precedence

When instructions conflict, use this precedence:

1. safety/security constraints and external tool authorization requirements
2. accepted ADRs under `docs/ADR/`
3. active specification
4. `docs/ARCHITECTURE.md` and protocol/security contracts
5. `docs/AUTONOMOUS-IMPLEMENTATION.md`
6. `docs/ROADMAP.md`
7. older prose/comments

Record material deviations as a new ADR. Do not silently reinterpret a contract.

## Autonomous continuation rule

Do not stop merely because one task, task group, specification, or milestone completed.

After a gate passes:

1. update durable campaign state and checkpoint;
2. commit the completed waypoint if repository writes are authorized;
3. activate the next unblocked waypoint;
4. continue implementation.

If the next detailed specification does not yet exist but the roadmap defines the milestone, create the specification from the roadmap and existing architecture contracts, record the decision, then continue. The seeded specifications under `specs/` should normally make this unnecessary.

## What the agent may decide without asking

The agent should independently make routine engineering decisions that stay inside existing architecture and product constraints, including:

- package/module decomposition;
- internal function/type names;
- tests and fixtures;
- local refactors required by the active implementation;
- dependency selection when it is low-risk, actively maintained, license-compatible, and consistent with ADRs;
- bug fixes discovered while implementing the active waypoint;
- creation of targeted regression tests;
- documentation synchronization;
- task ordering among independent tasks inside the active milestone;
- temporary local instrumentation that is removed or intentionally retained before checkpointing.

Prefer the smallest design that satisfies the current and next known milestone.

## Stop or escalate conditions

Pause only when continuing would require one of the following:

- a secret, account credential, paid service purchase, or human login that is unavailable;
- an irreversible or externally destructive action;
- publishing, release, deployment, or merge authority not granted by the invoking workflow;
- a product decision with materially different user-visible outcomes that existing documents do not resolve;
- a security boundary that would have to be weakened;
- a licensing conflict;
- required hardware/OS that is unavailable and cannot be emulated reasonably;
- two authoritative contracts that cannot be reconciled by a narrow ADR;
- repeated deterministic gate failure after the root cause has been investigated and no safe forward path exists.

When blocked, update campaign state to `BLOCKED`, document evidence and attempted remedies in `CHECKPOINT.md`, then continue any independent unblocked work. Stop the campaign only when no safe unblocked work remains.

## Implementation baseline

Unless superseded by an ADR:

- Node.js 22+
- TypeScript strict mode
- pnpm workspace
- Vitest for unit/core tests
- Playwright for the first real platform adapter and web E2E
- SQLite for durable local control-plane state
- JSON Schema plus runtime validation for protocol payloads
- OpenTelemetry conventions for Inspector telemetry
- JSON-RPC 2.0 framing over stdio/local IPC for adapter subprocesses
- MCP only as an optional external facade

Python, Kotlin, C#, Swift, Rust, or Go are allowed in platform helpers when they are the best native fit. Do not rewrite the TypeScript core merely for stack uniformity.

## Core invariants

- Platform-specific behavior stays behind adapters.
- No LLM action bypasses capability/policy enforcement.
- Every external action has an ID, deadline, risk class, budget attribution, idempotency policy, and outcome.
- Every observation influencing a finding is attributable to a run/step and persistable.
- A candidate is not confirmed until reproduction policy is satisfied.
- Unknown action outcomes are never blindly retried.
- Prefer semantic structure and stable IDs over coordinates or raw pixels.
- Repair work uses an isolated Git worktree or disposable checkout.
- Secrets are redacted before artifacts or model context are persisted.
- Generated run artifacts are not committed unless a spec explicitly declares them fixtures.

## Development loop

For each waypoint:

1. **Orient** — load durable state and inspect current code.
2. **Plan narrowly** — identify acceptance criteria and affected boundaries.
3. **Implement** — complete the smallest coherent slice.
4. **Verify locally** — run targeted tests continuously.
5. **Run waypoint gate** — run the gate defined by the active spec.
6. **Synchronize docs/state** — update task checkboxes, campaign state, and checkpoint.
7. **Checkpoint commit** — make a scoped commit when authorized.
8. **Continue** — select the next unblocked waypoint immediately.

Never mark a task complete merely because code exists. Mark it complete only after its required gate passes.

## Gate policy

During implementation, optimize for forward progress while preserving a green resumable baseline.

Minimum repository gates once bootstrapped:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Run targeted tests after small edits. Run the full applicable gate at the end of each task group and milestone. Platform adapters add smoke/conformance gates.

A protocol change requires compatibility tests or a version bump. A change to exploration/oracle/finding/repair policy requires deterministic fixture scenarios.

## Failure policy

When a gate fails:

1. classify whether the failure is caused by the current change, environment, flakiness, or pre-existing state;
2. collect the smallest useful evidence;
3. fix current-change regressions before moving on;
4. retry flaky/environmental failures only with bounded attempts;
5. never hide failures by deleting assertions, weakening types, or skipping tests without a documented ADR/spec change.

## Git and checkpoint discipline

Inspector develops directly on the single persistent branch `main`. Agents may use a disposable clone or detached worktree for temporary isolation, but must never leave a persistent feature or campaign branch behind.

- Never force-push campaign history.
- Never rewrite or discard another agent's work without evidence it is obsolete.
- Keep commits scoped to completed waypoints.
- Include state/checkpoint updates in the same commit as the waypoint when practical.
- Do not merge to `main`, publish releases, or push when the external invoking workflow has not granted that authority. Repository intent does not override tool-level authorization requirements.
- When push permission is granted, push durable checkpoint commits so a fresh machine can resume.

## Hardening separation

Normal correctness work required to pass an implementation gate is always allowed. A **hardening campaign** means broad audit/cleanup/chaos/fuzz/performance/security work beyond the active implementation requirements.

Do not spontaneously switch to hardening mode. See `docs/HARDENING-CAMPAIGN.md`.

## Completion condition

The implementation campaign is complete only when the required milestones in `docs/ROADMAP.md` have passed their exit gates and campaign state is `COMPLETE`. Until then, the default action after a successful waypoint is **continue**.
