# Exploration Engine

Random clicking is a baseline, not the product. Inspector should use a hybrid explorer that incrementally learns a state/action graph and selects actions using novelty, risk, coverage, uncertainty, oracle strength, and cost.

## State representation

A state fingerprint is built from stable signals rather than raw pixels alone.

Candidate inputs:

- route/URL/window identity
- normalized accessibility/UI tree
- visible interactive controls and semantic properties
- selected DOM/app state features
- persisted-state digest
- process/activity identity
- key log/runtime markers
- screenshot perceptual hash for corroboration

The fingerprint must tolerate timestamps, animation, randomized IDs, and other expected noise.

## Action representation

Actions are semantic when possible:

```text
click(role=button, name="Save", locator=...)
type(role=textbox, name="Email", valueClass=invalid-email)
navigate(route=/settings)
kill_process(target=app, phase=after-write-start)
set_network(mode=offline)
restore_fixture(name=account-with-100-items)
```

Coordinates are an escape hatch, not the primary language.

## State graph

Inspector maintains a directed multigraph:

```text
State --Action--> State
```

Edges retain outcomes, latency, observation deltas, oracle results, coverage delta, and occurrence counts. Multiple edges may exist for the same semantic action under different fixtures or fault conditions.

## Candidate-action score

An initial scoring model can be heuristic and transparent:

```text
score =
  2.5 * state_novelty
+ 2.0 * transition_novelty
+ 1.8 * source_or_coverage_novelty
+ 1.6 * risk_prior
+ 1.4 * oracle_opportunity
+ 1.2 * uncertainty
+ 1.0 * boundary_value_bonus
- 1.0 * repeated_path_penalty
- 0.8 * action_cost
- 2.0 * instability_penalty
```

Do not begin with reinforcement learning. Log enough data first.

## Exploration strategies

The engine should compose several strategies:

### Structural exploration

Enumerate visible controls, routes, menus, dialogs, keyboard paths, and back/forward transitions.

### Boundary/adversarial input generation

Generate empty, minimum, maximum, huge, unicode, malformed, duplicate, stale, conflicting, and rapid-repeat inputs.

### Stateful sequence generation

Generate action sequences rather than isolated inputs: create -> edit -> delete -> back -> reopen; sign out during save; double-submit; rotate during transition; refresh during mutation.

### Lifecycle fault injection

At meaningful phases:

- kill app/process
- restart browser/page
- background/foreground mobile app
- drop network
- add latency
- abort selected request
- disk-full simulation where sandbox permits
- stale cache/storage restore
- interrupted persistence transaction

Faults must be restricted to disposable environments.

### Coverage-guided exploration

When code coverage is available, reward actions that reach new branches/functions. Coverage is a prioritization signal, not a correctness oracle.

### Change-guided exploration

When testing a diff, prioritize screens/actions whose source, API, schema, or data dependencies intersect changed code.

### Property/state-machine exploration

Allow developers to define primitive actions, preconditions, and invariants. A property-testing sidecar can generate and shrink sequences. Hypothesis-style stateful testing is a strong model for this subsystem even if the TypeScript MVP uses its own simple generator.

## Planner hierarchy

Use deterministic heuristics for obvious choices; use an LLM for ambiguous semantic planning.

```text
fast deterministic enumerator
      |
      +--> high-value candidate exists -> execute
      |
      +--> ambiguity/semantic goal -> model proposes ranked candidates
```

This conserves model calls while preserving intelligence where it matters.

## Sequence minimization

Once a failure reproduces, minimize it independently of the LLM where possible:

1. delta-debug chunks of actions
2. remove no-op observations/actions
3. shrink input values
4. simplify fixture
5. reduce fault timing window
6. replay each candidate from clean reset

The minimized sequence becomes the canonical reproducer.

## Avoiding loops

Track path hashes and semantic action counts. Penalize repeatedly traversed cycles unless a fault-injection strategy deliberately revisits them.

## Novelty exhaustion

A run may declare exploration saturation when a rolling window shows no new states, transitions, significant coverage, oracle opportunities, or high-risk sequences despite strategy diversification.
