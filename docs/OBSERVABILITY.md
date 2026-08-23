# Inspector Observability

Inspector must be observable independently of the application it is testing.

## Signals

Use OpenTelemetry-compatible concepts for:

### Traces

- run
- environment setup/reset
- exploration iteration
- adapter action
- observation collection
- oracle evaluation
- reproduction attempt
- minimization attempt
- model call
- worktree preparation
- build/test
- repair verification

### Metrics

- actions/sec
- adapter error rate
- environment reset rate
- model calls/tokens/cost
- unique states/transitions
- coverage delta
- candidate findings
- confirmed findings
- false/rejected candidates
- reproduction success ratio
- median sequence length before/after minimization
- artifact bytes
- repair success ratio

### Logs

Structured JSON logs with run/environment/step correlation. Model-generated text belongs in explicit fields; do not intermix untrusted target logs with control-plane messages.

## Health

Adapters emit heartbeat and health state:

```text
STARTING -> READY -> DEGRADED -> UNHEALTHY -> CLOSED
```

Environment instability must not be mistaken for application defects.

## Replay diagnostics

Every replay should record environment fingerprint and compare it to the original finding. Mismatches such as browser version, emulator snapshot, fixture revision, feature flags, or backend schema are surfaced before judging the result.

## Operator CLI output

With `--json`, product workflows emit versioned command schemas on stdout and
send progress to stderr. Unexpected failures use
`inspector-cli/error/1` with a stable kind, classification, and exit code;
malformed JSON is never used for an error path. Verification, regression,
repair, and campaign records are persisted in SQLite alongside their evidence
artifacts, so an interrupted operator process can resume or report an explicit
environment/incompatible-target outcome.

Target freeform text is redacted before it enters persisted observations,
evidence, or model context. Raw evidence remains available where it does not
contain recognized secret material, with hashes and provenance retained for
audit.
