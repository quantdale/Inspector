# Audit Certification Integrity — Spec Delta

## ADDED Requirements

### Requirement: Inventory and semantic review are distinct
A census generator MAY enumerate paths/blob hashes but SHALL default authored blobs to UNREVIEWED unless exact-blob semantic review evidence exists.

Reading/hashing bytes, file-extension matching, or pathname categorization SHALL NOT create REVIEWED status.

### Requirement: Every final authored blob is covered
H6 certification SHALL mechanically compare final `git ls-files` with the semantic-review ledger. Every authored final blob SHALL have its current exact blob hash and semantic review evidence. Missing paths and stale blob hashes fail certification.

#### Scenario: file added after audit generation
When a tracked file is added or changed after review, the audit gate SHALL fail until that exact blob is semantically reviewed.

### Requirement: Review evidence maps behavior
A semantic review record SHALL identify system map/behavioral contract inspected and findings or a concise no-finding rationale. Generic “runtime source reviewed” text is insufficient by itself.

### Requirement: H5 history is not rewritten
H6 SHALL record the H5 census defect prospectively. It SHALL NOT rewrite historical H5 completion records as though H6 evidence existed then.
