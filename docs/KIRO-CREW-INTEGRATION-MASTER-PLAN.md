# Kiro Crew Integration Master Plan — Inspector

**Status:** PLANNED / NOT ACTIVATED  
**Priority:** Optional post-GA operational experiment  
**Date:** 2026-09-01  
**Campaign effect:** NONE — this document does not create M24, release authority, a hardening campaign, or publication authority.

## 1. Executive decision

Kiro Crew should be evaluated as an **optional operator around Inspector**, not as a replacement for Inspector's scheduler, campaign state, finding lifecycle, repair trust model, fleet ownership, or evidence pipeline.

Inspector already owns the difficult reliability semantics:

```text
observe -> explore -> suspect -> reproduce -> minimize -> confirm
        -> diagnose -> patch -> rebuild -> replay -> regress -> continue
```

It also already has:

- durable campaign state in `.inspector/state/campaign.yaml`;
- checkpoint/recovery rules;
- bounded unattended campaigns;
- worker leasing/fencing;
- model routing/accounting;
- evidence bundles;
- deterministic replay;
- repair isolation;
- an external MCP/orchestrator surface.

Crew's role is therefore narrower: maintain long-lived operational context, decompose a bounded operator task, call Inspector's existing CLI/MCP surfaces, coordinate analysis subagents, and resume its own operator workflow after interruption.

Inspector remains authoritative for what was actually tested, what constitutes a finding, whether a repair is valid, and whether a campaign is complete.

## 2. Current repository constraint

The current implementation series M14-M23 and HARDENING_6 are COMPLETE. Repository policy explicitly says:

- no M24 is inferred;
- no release/tag/publication is inferred;
- future work requires explicit activation through `.agent/EXECUTION_PROMPT.md`.

This master plan is planning-only. Implementation begins only after a future campaign explicitly activates it.

## 3. Architecture

```text
                    Kiro Crew
             optional operator layer
                      |
        +-------------+-------------+
        |                           |
  Inspector CLI                  Inspector MCP
        |                           |
        +-------------+-------------+
                      |
                Inspector Core
                      |
     campaign state / leases / evidence /
       findings / replay / repair gates
                      |
                CANONICAL TRUTH
```

Crew must not write directly into Inspector's SQLite/state stores or synthesize finding state. It interacts through supported product/operator interfaces.

## 4. Installation and isolation

### 4.1 External dependency only

Do not add Crew to the pnpm workspace, installed Inspector package, tarball, or runtime dependencies.

Crew is operator tooling.

### 4.2 Dedicated state home

Use a project-specific Crew home:

```bash
export KIROCREW_HOME="$HOME/.kiro/crew-inspector"
```

This prevents cross-project memory and schedule contamination.

### 4.3 Pinned runtime

Record and pin:

- Kiro Crew version;
- kiro-cli version;
- served model;
- reasoning effort;
- OS;
- sandbox/approval configuration.

Use interactive approval for the first pilot. Move to auto approval only for a mechanically constrained command set after the shadow campaign passes.

## 5. Authority and memory policy

### Canonical Inspector truth

1. safety/security and tool authorization;
2. accepted ADRs;
3. active spec;
4. architecture/protocol contracts;
5. `.inspector/state/campaign.yaml` and checkpoint;
6. actual implementation/tests/evidence.

Crew memory is below all of these.

### Crew may remember

- stable CLI workflows;
- safe project summaries;
- adapter/capability facts already present in durable state;
- recurring environmental limitations;
- previously disproven investigation paths;
- operator preferences;
- safe command recipes.

### Crew may not decide from memory

- finding CONFIRMED/REJECTED/RESOLVED state;
- replay outcome;
- regression cleanliness;
- repair acceptance;
- campaign completion;
- fleet lease ownership;
- publication/release readiness.

Those are Inspector outcomes and must come from Inspector.

## 6. Integration principle: one control plane owns each concern

Inspector and Crew overlap in scheduling, tasks, subagents, persistence, and recovery. The implementation must not create two owners for the same concern.

Rules:

- **Inspector owns test execution, leases, budgets, target adapters, evidence, findings, and repair semantics.**
- **Crew owns only the outer operator task when explicitly selected.**
- Inspector campaign scheduler and Crew cron must never independently schedule the same campaign.
- Inspector worker parallelism remains inside Inspector.
- Crew subagents may analyze outputs, but they do not become Inspector workers.
- Crew restart state does not replace Inspector restart state.

## 7. Implementation phases

### IN-C0 — Shadow operator proof

**Goal:** prove Crew can understand and resume Inspector state without mutation.

1. Install pinned Crew outside the repo.
2. Set dedicated `KIROCREW_HOME`.
3. Create an Inspector Crew agent whose rehydration order mirrors `AGENTS.md`.
4. Ask Crew to report current status.
5. Force restart/compaction.
6. Re-report status.
7. Compare against `.inspector/state/campaign.yaml`, `docs/STATUS.md`, and `AGENTS.md`.

Required truth:

- M23 COMPLETE;
- H6 COMPLETE;
- M8 DEFERRED_ENVIRONMENT;
- no M24/release inferred.

**Exit gate:** exact semantic agreement, no repo mutation, no campaign activation.

### IN-C1 — Bounded fake-adapter campaign operator

**Goal:** let Crew invoke Inspector, while Inspector remains the execution engine.

Crew receives a task spec such as:

```text
Run a bounded Inspector campaign using the fake adapter.
Maximum workers: 2
Maximum steps: 4
No repair.
No publication.
Inspect the final campaign record and summarize evidence.
```

Crew invokes only supported CLI commands, for example:

- `pnpm cli doctor`;
- `pnpm cli campaign run ...`;
- `pnpm cli campaign list/show ...`;
- `pnpm cli findings list/show ...`.

It may interpret JSON output, but must not rewrite durable state directly.

**Exit gate:**

- same campaign outcome as direct CLI use;
- no duplicate execution;
- Inspector owns all budgets/leases;
- Crew restart does not create a second campaign unless explicitly requested.

### IN-C2 — Real local web pilot

Use a deterministic localhost web target. No external product target is needed.

Crew may:

1. verify capability;
2. start one bounded web hunt/campaign;
3. wait for terminal Inspector state;
4. summarize findings/evidence;
5. request deterministic verification through Inspector.

Crew may not label weak suspicion as confirmed.

**Exit gate:** evidence/finding semantics remain identical to direct Inspector operation.

### IN-C3 — Analysis subagents

After the single-agent pilot is proven, allow Crew subagents for **analysis only**.

Suggested roles:

- evidence-bundle reviewer;
- reproducibility reviewer;
- source-context reviewer;
- regression-risk reviewer.

Each subagent gets bounded sanitized inputs and returns a recommendation to the parent. The final finding/repair disposition remains an Inspector gate.

Do not map Crew subagents to fleet worker identities.

### IN-C4 — Repair orchestration pilot

Crew may request Inspector's existing repair flow but MUST NOT bypass it.

Required flow:

```text
Crew selects already-CONFIRMED finding
        ->
Inspector repair command
        ->
Inspector isolated worktree
        ->
build + replay + regression
        ->
Inspector accepted/rejected outcome
        ->
Crew summarizes result
```

Crew cannot directly mark a patch accepted or a finding RESOLVED.

**Exit gate:** positive repair evidence and durable-before-RESOLVED guarantees remain intact.

### IN-C5 — MCP integration

Only after the CLI pilot proves value, evaluate connecting Crew/kiro-cli to Inspector's existing MCP facade.

The MCP route should expose the same safe product/operator actions already supported. Do not create a second internal control plane specifically for Crew.

Requirements:

- capability discovery;
- structured errors;
- bounded requests;
- no raw-store access;
- no bypass around policy/budget/finding gates;
- stable identity/correlation.

If MCP adds no material benefit over the CLI, skip this phase.

### IN-C6 — Scheduling

Crew cron is optional and disabled by default.

If enabled, it may schedule **operator jobs**, not fleet workers. Example:

```text
At 02:00, ask Inspector to run campaign manifest X if no active campaign owns X.
```

Before launch, one authority must prove no duplicate campaign owner exists.

Prefer Inspector's scheduler when the work is fundamentally an Inspector campaign. Use Crew scheduling only when the task spans Inspector plus other operator actions.

## 8. Crash/restart qualification

The pilot must deliberately test:

1. Crew killed before Inspector launch;
2. Crew killed after launch but before first result;
3. Crew killed while Inspector campaign is running;
4. Crew restarted after Inspector already reached terminal state;
5. duplicated/replayed Crew instruction.

Expected behavior:

- Inspector campaign identity remains unique;
- no duplicate target execution;
- terminal campaign is not re-run implicitly;
- Crew rehydrates by querying Inspector state;
- Inspector remains recoverable without Crew.

## 9. Security and privacy

Crew may see only the minimum context required for the operator task.

Do not place in Crew persistent memory:

- secrets;
- raw credentials;
- unnecessarily raw network payloads;
- sensitive screenshots;
- data not needed for future operator decisions.

Inspector's redaction/policy layer remains authoritative before evidence is model-visible.

Crew's own sandbox is defense in depth, not a substitute for Inspector policy.

## 10. Observability

Record a safe operator receipt for every Crew-driven task:

- Crew/kiro-cli versions;
- Inspector SHA/version;
- Crew task ID;
- Inspector campaign/run IDs;
- CLI/MCP actions requested;
- wall time;
- Crew retry count;
- Inspector budget/result;
- whether repair was requested;
- final terminal state;
- any operator intervention.

Do not claim Crew success merely because the Crew process exited zero. Success means the expected Inspector terminal evidence exists.

## 11. Benchmarks

Compare direct operation versus Crew over at least five bounded campaigns.

Measure:

- operator setup time;
- resume/recovery time;
- duplicate work;
- campaign completion rate;
- false/stale state interpretations;
- human interventions;
- model credits/tokens;
- total wall time;
- repair acceptance accuracy;
- additional maintenance surface.

Crew should be retained only if it clearly reduces operator effort or improves continuity.

## 12. Kill/rollback criteria

Stop the integration if:

- Crew duplicates Inspector campaign ownership;
- Crew state becomes necessary to recover Inspector;
- Crew bypasses CLI/MCP policy;
- Crew calls repair outside Inspector's worktree/verification path;
- Crew turns environment failures into product findings;
- Crew schedules duplicate fleet work;
- persistent memory creates repeated stale-state errors;
- maintenance overhead exceeds measured benefit.

Rollback must require only stopping Crew and deleting the dedicated `KIROCREW_HOME`. Inspector itself must remain unchanged and operable.

## 13. Expected implementation artifacts

Only when activated:

```text
docs/
  KIRO-CREW-INTEGRATION-MASTER-PLAN.md
  KIRO-CREW-OPERATOR-RUNBOOK.md

scripts/
  crew-preflight.*           # external tool/version/config checks
  crew-inspector-bridge.*    # constrained CLI/MCP invocation wrapper

tests/
  ...                        # wrapper, duplicate-launch, restart, policy tests
```

If a significant product-facing capability is added, create a normal Inspector spec/OpenSpec/ADR according to repository convention before broad implementation.

## 14. External references

Re-validate upstream behavior at implementation time:

- https://github.com/kirodotdev/KiroCrew
- https://kiro.dev/docs/crew/

Current upstream characteristics relevant to this plan include KiroACP/kiro-cli as the required provider path, persistent memory, TaskRunner checkpoints, subagents, and optional schedules. Do not assume future releases preserve exact CLI or config semantics.

## 15. Final recommendation

Inspector should use Crew only as a **thin, optional operator**. Inspector already solves durable QA execution better than a general agent workspace can. Crew earns its place only if it improves long-horizon operator continuity while leaving all finding, replay, fleet, budget, repair, and evidence truth inside Inspector.
