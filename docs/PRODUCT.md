# Product Definition

## Problem

Conventional test automation executes scenarios humans already imagined. Coding agents can repair known defects, but they are usually given a ticket or failing test. The expensive gap is **finding high-value unknown failures in a running system, proving them, and closing the loop safely**.

Inspector exists to close that gap.

## Product contract

Given a repository plus a runnable target, Inspector should eventually be able to:

1. Build or launch an isolated test environment.
2. Observe the application through structured and visual sensors.
3. Construct and update a model of reachable application states and actions.
4. Explore deliberately rather than only replaying predefined tests.
5. Detect anomalous behavior using explicit and inferred oracles.
6. Gather a complete evidence package.
7. Reproduce a suspected failure from a clean state.
8. Minimize the action/state sequence needed to trigger it.
9. Classify confidence, severity, scope, and flakiness.
10. Generate a deterministic regression test when feasible.
11. Diagnose likely source locations.
12. Patch the repository in an isolated worktree when policy permits.
13. Rebuild and replay the exact failure.
14. Run impact-aware regression checks.
15. Persist the result and continue exploring.

## What Inspector is not

- Not a replacement for unit tests.
- Not a random click monkey with an LLM attached.
- Not a generic desktop computer-use agent that requires the host mouse/keyboard.
- Not a CI service in the first milestone.
- Not an autonomous production operator.
- Not permitted to infer a defect solely because a UI differs from an LLM's aesthetic preference.

## Primary user

A developer or small engineering team that wants long-running autonomous QA against development/staging builds and can provide deterministic fixtures or test environments.

## Core workflows

### Hunt

`inspector hunt`

Explore until budget exhausted or stop policy fires. Record candidates and
confirm reproducible defects. Hunt is discovery-only by default; any repair
requires a separate explicit `inspector repair` authorization.

### Verify

`inspector verify <finding>`

Recreate the environment, execute the minimized reproduction, and confirm current status.

### Regress

`inspector regress`

Replay confirmed regression scenarios against a new revision.

### Explore

`inspector explore`

Build state/action coverage without automatically patching.

### Repair

`inspector repair <finding>`

Create isolated worktree, diagnose, patch, verify, and produce a reviewable change.

### Campaign

`inspector campaign run|list|show|stop|resume`

Run bounded scale workflows over explicit target assignments. Campaign state,
leases, worker ownership, budgets, finding clustering, and stop/resume state
are durable; the CLI never pushes, merges, or releases a repair.

## Installed CLI machine contract

Important product commands emit a stable top-level schema with `--json`:

| Command | Schema | Exit meaning |
| --- | --- | --- |
| `hunt` | `inspector-cli/hunt/1` | `0` completed; `1` adapter/observation or error-level hunt stop |
| `explore` | `inspector-cli/explore/1` | same execution classes as hunt; patching is always disabled |
| `verify` | `inspector-cli/verify/1` | `0` fixed/clean; `2` reproduced; `3` flaky/environment; `4` incompatible/skipped |
| `regress` | `inspector-cli/regress/1` | `0` pass/fixed; `2` reproduced regression; `3` flaky/environment/incompatible |
| `repair` | `inspector-cli/repair/1` | `0` resolved; `2` patch failed; `3` execution error; `4` policy/probe refusal |
| `campaign` | `inspector-cli/campaign/1` | `0` bounded operation accepted/completed; `2` failed item execution |

Unexpected command failures use `inspector-cli/error/1` and keep JSON on stdout
only, with `error.kind`, `error.classification`, and `error.exitCode`.
Progress is sent to stderr. Environment failures and automation misses are
never promoted to target defects.

## Success metrics

Inspector is successful when it improves these metrics, not when it maximizes agent activity:

- confirmed unique defects per compute-hour
- false-positive rate
- clean-state reproduction rate
- minimized reproduction success rate
- deterministic regression-test generation rate
- repair verification rate
- escaped regression rate after an Inspector fix
- useful state/transition coverage
- human minutes required per confirmed finding
- median evidence completeness

## Non-negotiable properties

### Auditability

A reviewer must be able to answer: what did Inspector see, what did it do, why did it call this a bug, can I replay it, and what changed?

### Isolation

Default operation must not hijack the developer's foreground input devices. Target processes, browser contexts, emulators, VMs, PTYs, or isolated desktops are preferred.

### Determinism

Inspector should aggressively control clock, random seeds, accounts, fixtures, network behavior, and persistent state where the target permits it.

### Graduated autonomy

Discovery, confirmation, patching, pushing, and deployment are separate capabilities. Enabling one must not imply the others.
