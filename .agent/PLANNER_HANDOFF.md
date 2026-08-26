# Planner → Executor Handoff

Additive; stricter repository rules win. The planner writes `.agent/EXECUTION_PROMPT.md` only after auditing actual code, tests, docs, recent commits/diffs, useful issues/PRs, and native state. It must contain Status, Planned-From, target branch, one high-impact campaign, scope, ordered workstreams, constraints, validation, acceptance/completion gates, and Git/reporting requirements; then commit/push and stop without implementing.

For `/goal continue`: read repository instructions, this file, the execution prompt if present, and native campaign/state files; reconcile against current Git/implementation; resume the first genuinely incomplete requirement of an ACTIVE prompt, without redoing landed work; validate, fix introduced Critical/High regressions, update state, and commit/push per local policy. Otherwise fall back to native continuation semantics; if none exists, report that planning is required.

## Active planner handoff — HARDENING_5 re-audit (2026-08-27)

Current planner baseline is `main@6df14d5945e057761afdde8be7d07d6b7b2ace54`, whose exact Actions run `32988428201` is red in full integration. The active execution contract remains `.agent/EXECUTION_PROMPT.md` + `openspec/changes/hardening-5-fleet-truth/`; its latest 2026-08-27 delta and H5.10 tasks are authoritative.

Two additional confirmed defects must not be lost during rehydration: **H5-D14** (path-only self-attesting every-file audit) and **H5-D15** (configured Windows mock backend is executable but capability discovery suppresses the Windows family on Linux). Resume H5, do not invent H6/M14, and do not call the campaign complete until exact-blob content review and exact-SHA hosted certification are real.

The intended executor envelope is approximately **12 productive hours**. If the harness enforces a shorter hard session cap, checkpoint and resume the same H5.10 campaign on the next invocation; never convert a session timeout into completion.

