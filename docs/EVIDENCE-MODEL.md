# Evidence Model

Inspector should be able to hand a finding to a human or a different agent without requiring the original conversation context.

## Finding lifecycle

```text
OBSERVED
  -> CANDIDATE
     -> REPRODUCING
        -> MINIMIZED
           -> CONFIRMED
              -> PATCHING
                 -> VERIFYING
                    -> RESOLVED
                    -> REGRESSED
     -> REJECTED
     -> FLAKY
     -> NEEDS_HUMAN_ORACLE
```

Transitions are explicit durable events.

## Evidence bundle

A confirmed finding should contain, when available:

```text
finding.json
summary.md
reproduce.yaml
steps.jsonl
before.png
after.png
ui-tree-before.json
ui-tree-after.json
console.log
runtime.log
network.har-or-summary
trace.zip
storage-before.json
storage-after.json
db-diff.json
coverage-before.json
coverage-after.json
environment.json
git.json
oracle-evaluations.json
```

Not every adapter supports every artifact. Missing sensors are represented explicitly.

## Required metadata

- finding ID
- exact git revision
- target build identity
- environment/adapter version
- fixture/seed/clock identity
- clean-reset procedure
- minimized action sequence
- reproduction count / attempts
- oracle(s) that failed
- confidence
- severity
- first/last observed timestamps
- correlated logs/events
- artifact hashes

## Artifact store

Artifacts are content-addressed where practical. The database stores metadata and hashes. Duplicate screenshots/traces may be deduplicated.

Large binary artifacts must not be injected wholesale into LLM context. Models receive summaries and handles, then request specific artifacts.

## Reproducer format

`reproduce.yaml` is adapter-neutral at the semantic layer:

```yaml
version: 1
fixture: account-with-draft
seed: 731992
steps:
  - action: launch
  - action: click
    target: { role: button, name: Edit }
  - action: type
    target: { role: textbox, name: Title }
    value: "x"
  - action: fault.kill_target
    when: persistence-write-started
  - action: launch
assert:
  - invariant: draft-storage-valid
```

Adapters may add namespaced extensions.

## Evidence quality score

Track a simple quality score based on:

- clean reset available
- deterministic fixture captured
- reproduction ratio
- sequence minimized
- strong oracle present
- synchronized logs/traces present
- state diff present
- exact source revision recorded

The score is useful for triage and for deciding whether autonomous repair is allowed.
