# Delta — Durable History Integrity

## Purpose

Ensure state synchronization and campaign closure cannot erase the historical evidence required to audit Inspector's autonomous work.

## Requirements

### Requirement: hardening ledger updates are append-preserving

A current campaign update MUST preserve prior hardening campaign sections, defect records, certification evidence, and explicitly retained debt. State reconciliation may correct current-status headers but MUST NOT delete historical evidence merely to make a shorter current-state file.

#### Scenario: H5.9 state synchronization

Given a ledger containing H1-H4 history and H5 work, when H5.9 appends certification status, then all prior campaign anchors and defect-history sections remain present after the write.

### Requirement: durable state and prose surfaces agree on active campaign

`campaign.yaml`, `.agent/EXECUTION_PROMPT.md`, `AGENTS.md`, `docs/STATUS.md`, OpenSpec tasks, and the hardening ledger MUST agree on whether H5 is ACTIVE/PENDING/COMPLETE. Historical reports are preserved as historical snapshots and are not rewritten to pretend they predicted later work.

### Requirement: repository contracts detect destructive history loss

A deterministic repo-contract test MUST fail if campaign history referenced by durable machine-readable state disappears from the hardening ledger. The guard SHOULD validate semantic anchors/identities rather than brittle total line counts.

### Requirement: every-file census is regenerated after planner/executor changes

The H5 completion census MUST be generated from the exact final `git ls-files` tree. `reviewed + justified exclusions == tracked` must hold after all new OpenSpec, test, source, CI, and state files are added.

### Requirement: certification is exact-SHA evidence

A state-sync commit cannot certify itself by quoting a successful run for its parent. H5 may be COMPLETE only when required hosted jobs actually execute and pass on the exact pushed implementation SHA being certified; if the final synchronization commit creates a new SHA, the ledger must state precisely which implementation SHA was certified and must not imply unexecuted CI for the synchronization-only SHA.

## Test obligations

Add a regression fixture that simulates truncating prior hardening sections and proves the repo-contract gate fails. Add consistency checks for active campaign identity and OpenSpec/campaign status. Do not use a fixed line-count assertion as the sole history-integrity mechanism.
