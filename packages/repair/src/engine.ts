import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import type {
  Action,
  Finding,
  FindingEngine,
  OracleSignalKind,
  ReplayDriver,
} from "@inspector/finding";
import type { OracleSuite } from "@inspector/oracle";
import {
  RepairWorkspace,
  PathPolicyError,
  resolveContainedPath,
} from "./worktree.js";
import { SourceContextBuilder } from "./context.js";
import { RegressionGenerator, type RegressionCheck } from "./regression.js";
import { PatchBudget } from "./patcher.js";
import type { Patch, PatchAgent, PatchAttempt, RepairOutcome, RepairRecord } from "./types.js";

export interface RepairEngineOptions {
  repoRoot: string;
  revision: string;
  /** Directory where the repair record JSON is persisted. */
  evidenceDir: string;
  maxAttempts?: number;
  /**
   * Relative paths exempt from the test-file tampering policy (P4 defense
   * against weakened tests), e.g. fixtures the repair is expected to touch.
   */
  allowedTestPaths?: string[];
}

/** Basename/segment patterns for test files that patches may not touch. */
const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)fixtures(\/|$)/i,
  /\.test\.[^/]+$/i,
  /\.spec\.[^/]+$/i,
];

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isTestPath(relPath: string): boolean {
  const norm = normalizeRelPath(relPath);
  return TEST_PATH_PATTERNS.some((re) => re.test(norm));
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
 *  - the masking probe must first prove valid on the UNPATCHED revision;
 *  - patches may not modify test files unless explicitly allow-listed;
 *  - failures are contained per attempt and at the pipeline level: the
 *    finding always returns to CONFIRMED and an audit record is persisted;
 *  - rejected patches are rolled back and preserved for audit with their
 *    full content; durable evidence is copied out before workspace disposal;
 *  - an accepted patch is NEVER auto-applied — application to a real
 *    checkout is an explicit opt-in via applyAcceptedPatch().
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
    hints: {
      errorText?: string;
      selectors?: string[];
      /** Expected oracle kind; defaults to PAGE_ERROR. */
      expectOracle?: OracleSignalKind;
    } = {},
  ): Promise<RepairRecord> {
    const startedAt = new Date().toISOString();
    const attempts: PatchAttempt[] = [];

    if (finding.status !== "CONFIRMED") {
      return await this.finish({
        finding,
        outcome: "POLICY_BLOCKED",
        attempts,
        startedAt,
        reason: `finding status ${finding.status} is not patchable`,
      });
    }

    let workspace: RepairWorkspace | undefined;
    try {
      workspace = await RepairWorkspace.create(this.opts.repoRoot, this.opts.revision);
      const worktreeCommit = await workspace.headCommit().catch(() => null);

      // P4: the masking probe must be meaningful before any patch can be
      // blamed — evaluate it ONCE against the unpatched revision.
      if (!(await this.probeSurvives(workspace))) {
        return await this.finish({
          finding,
          outcome: "PROBE_INVALID",
          attempts,
          startedAt,
          workspace,
          worktreeCommit,
          reason: "masking probe already fails on the unpatched revision; probe is invalid",
        });
      }

      // P2: failing regression must exist before/with the patch.
      const expectOracle = hints.expectOracle ?? "PAGE_ERROR";
      const check: RegressionCheck = await this.regressions.materialize(
        workspace,
        finding.id,
        minimizedActions,
        expectOracle,
      );
      if (!check.failedPrePatch) {
        return await this.finish({
          finding,
          outcome: "NO_FAILING_REGRESSION",
          attempts,
          startedAt,
          regressionArtifact: check.artifactPath,
          workspace,
          worktreeCommit,
          reason: "regression does not fail on unpatched revision",
        });
      }

      const ctxBase = {
        findingId: finding.id,
        findingStatus: finding.status,
        errorMessage: hints.errorText,
      };
      const allowList = new Set((this.opts.allowedTestPaths ?? []).map(normalizeRelPath));
      const budget = new PatchBudget(this.opts.maxAttempts ?? 2);
      let index = 0;
      let sawConcretePatch = false;
      let sawPolicyBlock = false;

      while (budget.consume()) {
        index += 1;
        try {
          this.findingEngine.transition(finding, "PATCHING");

          const source = await this.contextBuilder.build(workspace, hints);
          const patch = await agent.proposePatch(
            this.contextBuilder.toPatchContext(source, ctxBase),
          );
          if (!patch || patch.files.length === 0) {
            attempts.push(this.attempt(index, agent.id, "ABORTED", "agent produced no patch"));
            this.findingEngine.transition(finding, "CONFIRMED");
            continue;
          }

          // Source-write policy: validate every path BEFORE touching disk.
          for (const f of patch.files) resolveContainedPath(workspace.path, f.path);
          // P4: test-weakening defense.
          const tampered = patch.files.filter(
            (f) => isTestPath(f.path) && !allowList.has(normalizeRelPath(f.path)),
          );
          if (tampered.length > 0) {
            attempts.push(
              this.attempt(
                index,
                agent.id,
                "REJECTED",
                `policy: patch touches test files (${tampered.map((f) => f.path).join(", ")})`,
                patch.rationale,
                patch.files.map((f) => f.path),
                patch,
              ),
            );
            sawConcretePatch = true;
            sawPolicyBlock = true;
            this.findingEngine.transition(finding, "CONFIRMED");
            continue;
          }

          for (const f of patch.files) await workspace.writeFile(f.path, f.content);

          // P4 verification: exact replay must no longer fire the oracle...
          const driver = await this.opts.driverFor(workspace);
          const replayResult = await driver.replay(minimizedActions);
          const stillFails = this.opts.oracleSuite.evaluate(replayResult).reproduced;

          // ...and the benign flow must survive (masking detection).
          const probeBroken = !(await this.probeSurvives(workspace));

          if (stillFails || probeBroken) {
            const reason = stillFails
              ? "reproducer still fires after patch"
              : "masking probe failed: benign flow broken (patch masks or breaks)";
            attempts.push(
              this.attempt(
                index,
                agent.id,
                "REJECTED",
                reason,
                patch.rationale,
                patch.files.map((f) => f.path),
                patch,
              ),
            );
            sawConcretePatch = true;
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
            attempts.push(
              this.attempt(
                index,
                agent.id,
                "REJECTED",
                "regression scenario fails post-patch",
                patch.rationale,
                patch.files.map((f) => f.path),
                patch,
              ),
            );
            sawConcretePatch = true;
            await workspace.rollback();
            this.findingEngine.transition(finding, "CONFIRMED");
            continue;
          }

          attempts.push(
            this.attempt(
              index,
              agent.id,
              "ACCEPTED",
              undefined,
              patch.rationale,
              patch.files.map((f) => f.path),
              patch,
            ),
          );
          this.findingEngine.transition(finding, "RESOLVED");
          return await this.finish({
            finding,
            outcome: "RESOLVED",
            attempts,
            startedAt,
            regressionArtifact: check.artifactPath,
            workspace,
            worktreeCommit,
          });
        } catch (err) {
          await workspace.rollback().catch(() => undefined);
          this.restoreConfirmed(finding);
          if (err instanceof PathPolicyError) {
            attempts.push(
              this.attempt(index, agent.id, "REJECTED", `source-write policy: ${err.message}`),
            );
            sawConcretePatch = true;
            sawPolicyBlock = true;
            continue;
          }
          attempts.push(
            this.attempt(index, agent.id, "ABORTED", `attempt ${index} failed: ${errorMessage(err)}`),
          );
          sawConcretePatch = true;
          continue;
        }
      }

      let outcome: RepairOutcome = "VERIFICATION_FAILED";
      if (sawPolicyBlock) outcome = "POLICY_BLOCKED";
      else if (!sawConcretePatch && attempts.length > 0) outcome = "NO_PATCH";
      return await this.finish({
        finding,
        outcome,
        attempts,
        startedAt,
        regressionArtifact: check.artifactPath,
        workspace,
        worktreeCommit,
        reason: "patch budget exhausted without an accepted patch",
      });
    } catch (err) {
      // Pipeline-level failure: never strand the finding mid-lifecycle and
      // never lose the audit trail.
      this.restoreConfirmed(finding);
      return await this.finish({
        finding,
        outcome: "ERROR",
        attempts,
        startedAt,
        workspace,
        reason: `repair pipeline failed: ${errorMessage(err)}`,
      });
    } finally {
      await workspace?.dispose();
    }
  }

  /**
   * Explicit, opt-in application of an accepted patch to a target checkout.
   * Never called automatically by the engine. Paths are re-validated against
   * the source-write policy relative to the TARGET root.
   */
  async applyAcceptedPatch(record: RepairRecord, targetRepoRoot: string): Promise<string[]> {
    const accepted = [...record.attempts]
      .reverse()
      .find((a) => a.verdict === "ACCEPTED" && a.patch && a.patch.files.length > 0);
    if (!accepted?.patch) {
      throw new Error(`repair record for ${record.findingId} carries no accepted patch`);
    }
    const { writeFile, mkdir } = await import("node:fs/promises");
    const written: string[] = [];
    for (const f of accepted.patch.files) {
      const full = resolveContainedPath(targetRepoRoot, f.path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, f.content, "utf8");
      written.push(f.path);
    }
    return written;
  }

  /** True when the benign flow still works in the given workspace state. */
  private async probeSurvives(workspace: RepairWorkspace): Promise<boolean> {
    const driver = await this.opts.driverFor(workspace);
    const result = await driver.replay(this.opts.maskingProbe);
    return !(
      result.outcomes.some((o) => o.status === "target-failure") ||
      result.signals.length > 0
    );
  }

  /** Bring a finding stranded in PATCHING/VERIFYING back to CONFIRMED. */
  private restoreConfirmed(finding: Finding): void {
    if (finding.status === "PATCHING" || finding.status === "VERIFYING") {
      try {
        this.findingEngine.transition(finding, "CONFIRMED");
      } catch {
        /* already moved on; leave untouched */
      }
    }
  }

  private attempt(
    index: number,
    agentId: string,
    verdict: PatchAttempt["verdict"],
    reason?: string,
    rationale?: string,
    filesTouched: string[] = [],
    patch?: Patch,
  ): PatchAttempt {
    return {
      index,
      agentId,
      verdict,
      reason,
      patchRationale: rationale,
      filesTouched,
      patch,
      at: new Date().toISOString(),
    };
  }

  private async finish(opts: {
    finding: Finding;
    outcome: RepairOutcome;
    attempts: PatchAttempt[];
    startedAt: string;
    regressionArtifact?: string;
    workspace?: RepairWorkspace;
    worktreeCommit?: string | null;
    reason?: string;
  }): Promise<RepairRecord> {
    const { finding, outcome, attempts, startedAt, regressionArtifact, workspace, reason } = opts;

    // Evidence durability: the workspace is disposed right after this, so
    // copy artifacts out to the evidence directory first.
    let durableArtifact = regressionArtifact;
    if (regressionArtifact && workspace && existsSync(regressionArtifact)) {
      try {
        mkdirSync(this.opts.evidenceDir, { recursive: true });
        const durable = join(this.opts.evidenceDir, `regression-${finding.id}.json`);
        copyFileSync(regressionArtifact, durable);
        durableArtifact = durable;
      } catch {
        /* best-effort: keep pointing at the original location */
      }
    }

    const record: RepairRecord = {
      findingId: finding.id,
      revision: finding.revision,
      workspacePath: workspace ? workspace.path : this.opts.repoRoot,
      worktreeCommit: opts.worktreeCommit ?? null,
      outcome,
      attempts,
      regressionArtifact: durableArtifact,
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
