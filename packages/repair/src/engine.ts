import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Action, Finding, FindingEngine, ReplayDriver } from "@inspector/finding";
import type { OracleSuite } from "@inspector/oracle";
import { RepairWorkspace } from "./worktree.js";
import { SourceContextBuilder } from "./context.js";
import { RegressionGenerator, type RegressionCheck } from "./regression.js";
import { PatchBudget } from "./patcher.js";
import type { PatchAgent, PatchAttempt, RepairRecord } from "./types.js";

export interface RepairEngineOptions {
  repoRoot: string;
  revision: string;
  /** Directory where the repair record JSON is persisted. */
  evidenceDir: string;
  maxAttempts?: number;
}

/**
 * Autonomous repair coordinator (M4 P3–P5).
 *
 * Invariants enforced here:
 *  - only CONFIRMED findings may be patched; weak-suspicion-only findings
 *    (NEEDS_HUMAN_ORACLE) are policy-blocked;
 *  - a failing regression must exist BEFORE any source modification;
 *  - every patch is verified by exact replay of the minimized reproducer plus
 *    a benign-flow masking probe, inside an isolated worktree;
 *  - rejected patches are rolled back and preserved for audit.
 */
export class RepairEngine {
  private readonly regressions: RegressionGenerator;
  private readonly contextBuilder = new SourceContextBuilder();

  constructor(
    private readonly findingEngine: FindingEngine,
    private readonly opts: RepairEngineOptions & {
      driverFor: (workspace: RepairWorkspace) => Promise<ReplayDriver>;
      oracleSuite: OracleSuite;
      /** Benign action sequence that must keep working after any real fix. */
      maskingProbe: Action[];
    },
  ) {
    this.regressions = new RegressionGenerator({
      driverFor: opts.driverFor,
      oracleSuite: opts.oracleSuite,
    });
  }

  async repair(
    finding: Finding,
    minimizedActions: Action[],
    agent: PatchAgent,
    hints: { errorText?: string; selectors?: string[] } = {},
  ): Promise<RepairRecord> {
    const startedAt = new Date().toISOString();
    const attempts: PatchAttempt[] = [];

    if (finding.status !== "CONFIRMED") {
      return this.finish(finding, "POLICY_BLOCKED", attempts, startedAt, undefined,
        `finding status ${finding.status} is not patchable`);
    }

    const workspace = await RepairWorkspace.create(
      this.opts.repoRoot,
      this.opts.revision,
    );

    try {
      // P2: failing regression must exist before/with the patch.
      const check: RegressionCheck = await this.regressions.materialize(
        workspace,
        finding.id,
        minimizedActions,
        "PAGE_ERROR",
      );
      if (!check.failedPrePatch) {
        return this.finish(finding, "NO_FAILING_REGRESSION", attempts, startedAt,
          check.artifactPath, "regression does not fail on unpatched revision");
      }

      const ctxBase = {
        findingId: finding.id,
        findingStatus: finding.status,
        errorMessage: hints.errorText,
      };
      const budget = new PatchBudget(this.opts.maxAttempts ?? 2);
      let index = 0;

      while (budget.consume()) {
        index += 1;
        this.findingEngine.transition(finding, "PATCHING");

        const source = await this.contextBuilder.build(workspace, hints);
        const patch = await agent.proposePatch(
          this.contextBuilder.toPatchContext(source, ctxBase),
        );
        if (!patch) {
          attempts.push(this.attempt(index, agent.id, "ABORTED", "agent produced no patch"));
          this.findingEngine.transition(finding, "CONFIRMED");
          continue;
        }

        for (const f of patch.files) await workspace.writeFile(f.path, f.content);

        // P4 verification: exact replay must no longer fire the oracle...
        const driver = await this.opts.driverFor(workspace);
        const replayResult = await driver.replay(minimizedActions);
        const stillFails = this.opts.oracleSuite.evaluate(replayResult).reproduced;

        // ...and the benign flow must survive (masking detection).
        const probeDriver = await this.opts.driverFor(workspace);
        const probeResult = await probeDriver.replay(this.opts.maskingProbe);
        const probeBroken =
          probeResult.outcomes.some((o) => o.status === "target-failure") ||
          probeResult.signals.length > 0;

        if (stillFails || probeBroken) {
          const reason = stillFails
            ? "reproducer still fires after patch"
            : "masking probe failed: benign flow broken (patch masks or breaks)";
          attempts.push(this.attempt(index, agent.id, "REJECTED", reason, patch.rationale, patch.files.map((f) => f.path)));
          await workspace.rollback();
          this.findingEngine.transition(finding, "CONFIRMED");
          continue;
        }

        // Post-patch regression gate.
        this.findingEngine.transition(finding, "VERIFYING");
        const regressionPasses = await this.regressions.passes(
          workspace,
          check.scenario.steps,
        );
        if (!regressionPasses) {
          attempts.push(this.attempt(index, agent.id, "REJECTED", "regression scenario fails post-patch", patch.rationale));
          await workspace.rollback();
          this.findingEngine.transition(finding, "CONFIRMED");
          continue;
        }

        attempts.push(this.attempt(index, agent.id, "ACCEPTED", undefined, patch.rationale, patch.files.map((f) => f.path)));
        this.findingEngine.transition(finding, "RESOLVED");
        return this.finish(finding, "RESOLVED", attempts, startedAt, check.artifactPath);
      }

      return this.finish(finding, "VERIFICATION_FAILED", attempts, startedAt, check.artifactPath,
        "patch budget exhausted without an accepted patch");
    } finally {
      await workspace.dispose();
    }
  }

  private attempt(
    index: number,
    agentId: string,
    verdict: PatchAttempt["verdict"],
    reason?: string,
    rationale?: string,
    filesTouched: string[] = [],
  ): PatchAttempt {
    return { index, agentId, verdict, reason, patchRationale: rationale, filesTouched, at: new Date().toISOString() };
  }

  private finish(
    finding: Finding,
    outcome: RepairRecord["outcome"],
    attempts: PatchAttempt[],
    startedAt: string,
    regressionArtifact?: string,
    reason?: string,
  ): RepairRecord {
    const record: RepairRecord = {
      findingId: finding.id,
      revision: finding.revision,
      workspacePath: this.opts.repoRoot,
      outcome,
      attempts,
      regressionArtifact,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    if (reason) record.attempts.push(this.attempt(0, "engine", "ABORTED", reason));
    try {
      mkdirSync(this.opts.evidenceDir, { recursive: true });
      writeFileSync(
        join(this.opts.evidenceDir, `repair-${finding.id}.json`),
        JSON.stringify(record, null, 2),
      );
    } catch {
      /* best-effort persistence */
    }
    return record;
  }
}
