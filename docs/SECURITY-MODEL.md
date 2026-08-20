# Security Model

Inspector is intentionally powerful. Its default trust boundary assumes the target application and generated test inputs may be buggy or hostile, and the model may propose unsafe actions.

## Principles

- deny by default
- isolate targets from the developer session
- make capabilities explicit
- keep secrets out of model context when possible
- separate observation, interaction, source modification, and publishing permissions
- treat network access as a capability
- make destructive operations environment-scoped

## Threats

- model issues dangerous shell command
- target app exfiltrates test secrets
- prompt injection appears inside tested UI/logs
- browser visits untrusted external domain
- test deletes/modifies host files
- Android/desktop action targets the wrong device/window
- stale adapter session acts on a new target
- repair agent leaks credentials into source or logs
- artifacts contain tokens, emails, cookies, personal data

## Required defenses

### Target allowlist

Every action is scoped to an environment and target identity. A selector resolving outside the owned target is rejected unless cross-app capability is explicitly granted.

### Command policy

The core never exposes an unrestricted shell tool directly to an exploratory model. Commands are generated through typed operations or executed in an isolated repair workspace under command policy.

### Network policy

MVP default: target may reach only configured origins. External navigation discovered through links is blocked or recorded as a candidate action requiring policy approval.

### Secret handling

- inject secrets into target environment only when required
- redact known secret values from logs/artifacts/model inputs
- store secret references, not plaintext, in durable run state
- never place production credentials in default fixtures

### Prompt-injection boundary

Text observed inside the target is **data**, not control instructions. Adapter observations must be wrapped and labeled as untrusted target content. The policy engine ignores instructions originating from observations.

### Environment destruction

Fault injection such as process kill, file corruption, database mutation, or network manipulation is only allowed inside environments marked disposable.

### Publishing

Commit/push/PR operations are separately permissioned. A successful repair does not grant publishing rights.

## Artifact retention

Retention and maximum size are run policies. Sensitive artifacts should support immediate redaction or deletion while preserving hashes/metadata needed for audit.
