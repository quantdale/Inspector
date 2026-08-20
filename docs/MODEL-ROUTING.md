# Model Routing

Inspector should exploit abundant inference without making every action an LLM decision.

## Model roles

### Explorer planner

Used when semantic choice is ambiguous: what action is likely to reveal new behavior, what boundary case matters, what suspicious observation deserves follow-up.

### Visual interpreter

Used only when semantic trees/structured signals are insufficient or contradictory.

### Oracle reasoner

Assesses weak semantic anomalies and proposes invariants. Its output does not bypass confirmation policy.

### Diagnostician/repair model

Receives confirmed finding evidence plus relevant source slices and proposes patches/tests.

### Summarizer

Compresses old run context into durable structured memory.

## Routing policy

Use the cheapest adequate path:

1. deterministic code/heuristic
2. small/fast model
3. stronger reasoning model
4. multimodal model only when image understanding is required

The router records provider/model, request class, input/output tokens when available, latency, cache data, retries, and attributed run/finding.

## Context packets

Never feed the entire run transcript repeatedly. Construct task-specific packets.

Explorer packet:

- current state summary
- visible actions
- nearby graph/history
- risk hints
- prior failed attempts
- current goals and budgets

Repair packet:

- minimized reproducer
- strong oracle result
- evidence summary
- relevant logs/traces
- suspected symbols/files
- tests near impacted code
- repository constraints

## Swarm design

Default to a single coordinator plus specialized workers, not many independent agents rediscovering the repo.

Good parallelism:

- isolated environments exploring different state regions
- independent reproducer confirmation
- static/source diagnosis parallel to runtime reproduction
- different repair candidates in separate worktrees

Bad parallelism:

- multiple agents mutating one worktree
- multiple planners clicking the same environment
- every worker rebuilding a full repository map from scratch

## Budget-aware degradation

When model budget becomes scarce:

- stop visual interpretation first where structured state suffices
- reduce semantic-planner frequency
- continue deterministic replay/minimization
- preserve confirmation and evidence integrity

Abundant model access should increase exploration breadth, not weaken evidence standards.
