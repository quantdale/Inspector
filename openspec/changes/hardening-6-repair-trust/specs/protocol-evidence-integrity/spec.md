# Protocol and Evidence Integrity — Spec Delta

## ADDED Requirements

### Requirement: Action outcomes correlate to the request
Before accepting an action outcome, Inspector SHALL require exact equality of actionId, runId, and environmentId with the submitted action/current controller.

Mismatch is a protocol violation and SHALL create no successful durable step.

### Requirement: Observations correlate to the controller
Before accepting an observation, Inspector SHALL require its runId/environmentId to match the current controller. Controller-owned sequencing remains authoritative.

### Requirement: Declared artifact references are real evidence
If an accepted action outcome declares artifact refs, Inspector SHALL validate syntax, run ownership, existence, and required integrity before considering the evidence step complete.

Missing/corrupt/cross-run refs SHALL NOT be silently filtered or charged as zero bytes.

### Requirement: AdapterServer validates every inbound contract
The adapter server SHALL validate JSON-RPC envelope invariants and params for initialize, observe, act, lifecycle, health, and cancel before invoking handler code.

Malformed notifications SHALL NOT invoke handlers with fabricated defaults.
