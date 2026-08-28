import { dirname, join } from "node:path";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
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
  ProvenanceError,
  assertCleanCheckout,
} from "./worktree.js";
import { SourceContextBuilder } from "./context.js";
import { RegressionGenerator, type RegressionCheck } from "./regression.js";
import { PatchBudget } from "./patcher.js";
import {
  assessReplayEvidence,
  isCleanExecuted,
  replayExceptionEvidence,
  type ReplayEvidence,
} from "./replay-evidence.js";
import type {
  Patch,
  PatchAgent,
  PatchAttempt,
  RepairOutcome,
  RepairRecord,
  RepairVerification,
  ReplayEvidenceSummary,
} from "./types.js";

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
  /** Durable progress hook invoked after every repair-attempt decision. */
  onAttempt?: (attempt: PatchAttempt, attemptCount: number) => void;
  /** Fault-injection seam for required evidence durability tests. */
  persistence?: RepairPersistenceHooks;
  /** Fault-injection seam for explicit target application tests. */
  application?: RepairApplicationHooks;
}

export interface RepairPersistenceHooks {
  copyArtifact?: (source: string, destination: string) => void;
  writeRecord?: (path: string, content: string) => void;
  fsync?: (path: string) => void;
  rename?: (source: string, destination: string) => void;
}

export interface RepairApplicationHooks {
  mkdir?: (path: string) => Promise<void>;
  writeFile?: (path: string, content: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
}

export class RequiredRepairEvidenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RequiredRepairEvidenceError";
  }
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
  /**
   * Per-repair provenance sink for regression-gate evaluations. Set at the
   * start of repair() (when the finding is known) and cleared afterwards;
   * null when no store-backed evaluation recording applies.
   */
  private evaluationSink:
    | ((gate: "regression-pre-patch" | "regression-post-patch", matchedIds: string[], observed: string) => void)
    | null = null;

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
      onEvaluation: (gate, matchedIds, observed) => this.evaluationSink?.(gate, matchedIds, observed),
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
    let verification: RepairVerification | undefined;
    this.evaluationSink = (gate, matchedIds, observed) => {
      this.findingEngine.recordRepairVerification({
        finding,
        descriptors: this.opts.oracleSuite.descriptors,
        matchedIds,
        expected:
          gate === "regression-pre-patch"
            ? "regression scenario fails on the unpatched revision"
            : "regression scenario passes post-patch",
        observed,
      });
    };
    try {
      workspace = await RepairWorkspace.create(this.opts.repoRoot, this.opts.revision);
      const worktreeCommit = await workspace.headCommit().catch(() => null);

      // P4: the masking probe must be meaningful before any patch can be
      // blamed — evaluate it ONCE against the unpatched revision.
      const initialProbeEvidence = await this.probeEvidence(workspace);
      if (!isCleanExecuted(initialProbeEvidence)) {
        return await this.finish({
          finding,
          outcome: "PROBE_INVALID",
          attempts,
          startedAt,
          workspace,
          worktreeCommit,
          reason: `masking probe is not clean on the unpatched revision (${initialProbeEvidence.disposition}): ${initialProbeEvidence.reason}`,
        });
      }

      // P2: failing regression must exist before/with the patch.
      const expectOracle = hints.expectOracle ?? "PAGE_ERROR";
      const check: RegressionCheck = await this.regressions.materialize(
        workspace,
        finding.id,
        minimizedActions,
        expectOracle,
        { adapter: finding.adapter },
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
          verification: { prePatch: summarizeEvidence(check.prePatchEvidence) },
          reason: "regression does not fail on unpatched revision",
        });
      }
      verification = { prePatch: summarizeEvidence(check.prePatchEvidence) };

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
            this.appendAttempt(attempts, this.attempt(index, agent.id, "ABORTED", "agent produced no patch"));
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
            this.appendAttempt(
              attempts,
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

          // Bind every proposed file to the exact preimage observed in the
          // certified worktree. The preimage is later required when an
          // operator explicitly applies this accepted patch elsewhere.
          const certifiedPatch = await this.certifyPatchPreimages(workspace, patch);
          for (const f of certifiedPatch.files) await workspace.writeFile(f.path, f.content);

          // P4 verification: the post-patch regression must execute every
          // required action successfully and have no hard-oracle match.
          this.findingEngine.transition(finding, "VERIFYING");
          const postPatchEvidence = await this.regressions.passes(
            workspace,
            minimizedActions,
          );
          const replayResult = postPatchEvidence.result;
          const stillFails = !isCleanExecuted(postPatchEvidence);

          // Masking-by-removal defense: every action that crashed the
          // unpatched target with a genuine application failure (TARGET_FAILURE)
          // must now SUCCEED. A patch that stops the reproducer from firing by
          // disabling the behavior instead of repairing it (e.g. deleting the
          // failing control) leaves those actions failing with an automation
          // error — rejected exactly like a still-firing reproducer.
          const crashProne = new Set(
            check.prePatch.outcomes
              .filter(
                (o) =>
                  o.status === "target-failure" &&
                  o.error?.code === "TARGET_FAILURE",
              )
              .map((o) => o.actionId),
          );
          const flowLost = replayResult?.outcomes.some(
            (o) => crashProne.has(o.actionId) && o.status !== "success",
          ) ?? false;
          const maskingByActionFailure = replayResult?.outcomes.some(
            (o) =>
              crashProne.has(o.actionId) &&
              o.error?.code === "ACTION_FAILED",
          ) ?? false;

          // ...and the benign flow must survive (masking detection).
          const maskingProbeEvidence = await this.probeEvidence(workspace);
          const probeBroken = !isCleanExecuted(maskingProbeEvidence);
          const patchVerification = {
            postPatch: summarizeEvidence(postPatchEvidence),
            maskingProbe: summarizeEvidence(maskingProbeEvidence),
          };

          if (stillFails || flowLost || probeBroken) {
            const reason = maskingByActionFailure
              ? "masking suspected: a previously crashing action became an automation miss after patch (behavior disabled instead of repaired)"
              : stillFails
                ? `post-patch replay is not clean: ${postPatchEvidence.disposition} (${postPatchEvidence.reason})`
                : flowLost
                  ? "masking suspected: a previously crashing action still fails after patch (behavior disabled instead of repaired)"
                  : "masking probe failed: benign flow broken (patch masks or breaks)";
            this.appendAttempt(
              attempts,
              this.attempt(
                index,
                agent.id,
                "REJECTED",
                reason,
                certifiedPatch.rationale,
                certifiedPatch.files.map((f) => f.path),
                certifiedPatch,
                patchVerification,
              ),
            );
            sawConcretePatch = true;
            await workspace.rollback();
            this.findingEngine.transition(finding, "CONFIRMED");
            continue;
          }

          this.appendAttempt(
            attempts,
            this.attempt(
              index,
              agent.id,
              "ACCEPTED",
              undefined,
              certifiedPatch.rationale,
              certifiedPatch.files.map((f) => f.path),
              certifiedPatch,
              patchVerification,
            ),
          );
          // Required proof is committed before the lifecycle transition. A
          // missing artifact or record therefore cannot expose RESOLVED.
          const resolvedRecord = await this.finish({
            finding,
            outcome: "RESOLVED",
            attempts,
            startedAt,
            regressionArtifact: check.artifactPath,
            workspace,
            worktreeCommit,
            verification,
          });
          this.findingEngine.transition(finding, "RESOLVED");
          return resolvedRecord;
        } catch (err) {
          if (err instanceof RequiredRepairEvidenceError) throw err;
          try {
            await workspace.rollback();
          } catch (rollbackErr) {
            this.appendAttempt(
              attempts,
              this.attempt(
                index,
                "engine",
                "ABORTED",
                `attempt ${index} rollback failed; refusing to continue with a contaminated workspace: ${errorMessage(rollbackErr)}`,
              ),
            );
            throw new ProvenanceError(
              `repair attempt ${index} could not restore its certified base`,
              { cause: rollbackErr },
            );
          }
          this.restoreConfirmed(finding);
          if (err instanceof PathPolicyError) {
            this.appendAttempt(
              attempts,
              this.attempt(index, agent.id, "REJECTED", `source-write policy: ${err.message}`),
            );
            sawConcretePatch = true;
            sawPolicyBlock = true;
            continue;
          }
          this.appendAttempt(
            attempts,
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
        verification,
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
        verification,
        reason: `repair pipeline failed: ${errorMessage(err)}`,
      });
    } finally {
      this.evaluationSink = null;
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
    const expectedRevision = record.worktreeCommit;
    if (!expectedRevision) {
      throw new ProvenanceError("accepted patch has no certified worktree commit");
    }

    const { mkdir: mkdirRaw, writeFile: writeFileRaw } =
      await import("node:fs/promises");
    const snapshots: FileSnapshot[] = [];
    const directories: string[] = [];
    const written: string[] = [];
    let touched = false;

    try {
      const checkout = await assertCleanCheckout(targetRepoRoot, expectedRevision);
      const targetRoot = checkout.root;
      const seen = new Set<string>();

      // Complete preflight before the first write: exact revision, clean
      // checkout, unique contained paths, safe filesystem objects, and
      // certified preimages all have to agree.
      for (const file of accepted.patch.files) {
        const normalized = normalizeRelPath(file.path);
        const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
        if (seen.has(identity)) {
          throw new ProvenanceError(`accepted patch contains duplicate path: ${file.path}`);
        }
        seen.add(identity);
        if (typeof file.preimageExists !== "boolean" || !("preimageSha256" in file)) {
          throw new ProvenanceError(
            `accepted patch lacks a certified preimage for ${file.path}`,
          );
        }
        const full = resolveContainedPath(targetRoot, file.path);
        let stat: ReturnType<typeof lstatSync> | undefined;
        try {
          stat = lstatSync(full);
        } catch (err) {
          if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
        }
        if (stat?.isSymbolicLink()) {
          throw new PathPolicyError(`symlink targets are not patchable: ${file.path}`);
        }
        if (stat && !stat.isFile()) {
          throw new ProvenanceError(`accepted patch target is not a regular file: ${file.path}`);
        }
        const actual = stat ? readFileSync(full) : null;
        const actualExists = actual !== null;
        if (actualExists !== file.preimageExists) {
          throw new ProvenanceError(`target preimage existence changed for ${file.path}`);
        }
        const actualHash = actual ? sha256(actual) : null;
        if (actualHash !== file.preimageSha256) {
          throw new ProvenanceError(`target preimage hash mismatch for ${file.path}`);
        }
        snapshots.push({ full, existed: actualExists, bytes: actual });

        let parent = dirname(full);
        while (parent !== targetRoot) {
          if (existsSync(parent)) {
            const parentStat = lstatSync(parent);
            if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
              throw new PathPolicyError(`patch parent is not a real directory: ${file.path}`);
            }
            break;
          }
          directories.push(parent);
          parent = dirname(parent);
        }
      }

      const uniqueDirectories = [...new Set(directories)].sort(
        (a, b) => a.length - b.length,
      );
      for (const directory of uniqueDirectories) {
        touched = true;
        if (this.opts.application?.mkdir) await this.opts.application.mkdir(directory);
        else await mkdirRaw(directory);
      }

      for (const [index, file] of accepted.patch.files.entries()) {
        const full = snapshots[index]!.full;
        touched = true;
        if (this.opts.application?.writeFile) {
          await this.opts.application.writeFile(full, file.content);
        } else {
          await writeFileRaw(full, file.content, "utf8");
        }
        written.push(file.path);
      }

      record.application = {
        status: "APPLIED",
        paths: [...written],
        rollbackSucceeded: true,
        at: new Date().toISOString(),
      };
      try {
        this.persistRepairRecord(record);
      } catch (err) {
        const rollbackSucceeded = await rollbackFiles(snapshots, uniqueDirectories);
        record.application = {
          status: "ROLLED_BACK",
          paths: [...written],
          rollbackSucceeded,
          reason: `application audit could not be persisted: ${errorMessage(err)}`,
          at: new Date().toISOString(),
        };
        try {
          this.persistRepairRecord(record);
        } catch {
          /* The returned record still carries the rollback truth. */
        }
        throw new ProvenanceError(
          `accepted patch was rolled back because application evidence could not be persisted`,
          { cause: err },
        );
      }
      return written;
    } catch (err) {
      if (touched && record.application?.status !== "ROLLED_BACK") {
        const rollbackSucceeded = await rollbackFiles(snapshots, directories);
        record.application = {
          status: "ROLLED_BACK",
          paths: [...written],
          rollbackSucceeded,
          reason: `application failed: ${errorMessage(err)}`,
          at: new Date().toISOString(),
        };
        try {
          this.persistRepairRecord(record);
        } catch {
          /* Preserve the in-memory rollback result if the audit sink is down. */
        }
      } else if (!record.application) {
        record.application = {
          status: "REFUSED",
          paths: [],
          rollbackSucceeded: true,
          reason: errorMessage(err),
          at: new Date().toISOString(),
        };
        try {
          this.persistRepairRecord(record);
        } catch {
          /* Refusal remains fail-closed even when optional audit persistence fails. */
        }
      }
      throw err;
    }
  }

  private async certifyPatchPreimages(
    workspace: RepairWorkspace,
    patch: Patch,
  ): Promise<Patch> {
    const seen = new Set<string>();
    const files = patch.files.map((file) => {
      const normalized = normalizeRelPath(file.path);
      const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
      if (seen.has(identity)) {
        throw new PathPolicyError(`patch contains duplicate path: ${file.path}`);
      }
      seen.add(identity);
      const full = resolveContainedPath(workspace.path, file.path);
      let stat: ReturnType<typeof lstatSync> | undefined;
      try {
        stat = lstatSync(full);
      } catch (err) {
        if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
      }
      if (stat?.isSymbolicLink()) {
        throw new PathPolicyError(`symlink targets are not patchable: ${file.path}`);
      }
      if (stat && !stat.isFile()) {
        throw new ProvenanceError(`patch target is not a regular file: ${file.path}`);
      }
      const bytes = stat ? readFileSync(full) : null;
      return {
        ...file,
        preimageExists: bytes !== null,
        preimageSha256: bytes === null ? null : sha256(bytes),
      };
    });
    return { ...patch, files };
  }

  /** True when the benign flow still works in the given workspace state. */
  private async probeEvidence(workspace: RepairWorkspace): Promise<ReplayEvidence> {
    try {
      const driver = await this.opts.driverFor(workspace);
      const result = await driver.replay(this.opts.maskingProbe);
      return assessReplayEvidence(
        result,
        this.opts.oracleSuite.evaluateStrict(result),
        this.opts.maskingProbe,
        "clean",
      );
    } catch (err) {
      return replayExceptionEvidence(err, "clean", this.opts.maskingProbe.length);
    }
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
    verification?: PatchAttempt["verification"],
  ): PatchAttempt {
    return {
      index,
      agentId,
      verdict,
      reason,
      patchRationale: rationale,
      filesTouched,
      patch,
      verification,
      at: new Date().toISOString(),
    };
  }

  private appendAttempt(attempts: PatchAttempt[], attempt: PatchAttempt): void {
    attempts.push(attempt);
    this.opts.onAttempt?.(attempt, attempts.length);
  }

  private async finish(opts: {
    finding: Finding;
    outcome: RepairOutcome;
    attempts: PatchAttempt[];
    startedAt: string;
    regressionArtifact?: string;
    workspace?: RepairWorkspace;
    worktreeCommit?: string | null;
    verification?: RepairVerification;
    reason?: string;
  }): Promise<RepairRecord> {
    const { finding, outcome, attempts, startedAt, regressionArtifact, workspace, reason } = opts;

    const requiresEvidence = outcome === "RESOLVED";
    // Evidence durability: the workspace is disposed right after this, so
    // copy artifacts out to the evidence directory before returning. A
    // RESOLVED result is fail-closed when either required artifact is absent
    // or any atomic persistence boundary fails.
    let durableArtifact: string | undefined;
    if (regressionArtifact) {
      if (!workspace || !existsSync(regressionArtifact)) {
        if (requiresEvidence) {
          throw new RequiredRepairEvidenceError(
            "required regression evidence is missing before RESOLVED",
          );
        }
      } else {
        try {
          durableArtifact = this.persistRegressionArtifact(regressionArtifact, finding.id);
        } catch (err) {
          if (requiresEvidence) {
            throw new RequiredRepairEvidenceError(
              `required regression evidence could not be committed: ${errorMessage(err)}`,
              { cause: err },
            );
          }
        }
      }
    } else if (requiresEvidence) {
      throw new RequiredRepairEvidenceError(
        "RESOLVED requires a regression evidence artifact",
      );
    }

    const record: RepairRecord = {
      findingId: finding.id,
      revision: finding.revision,
      workspacePath: workspace ? workspace.path : this.opts.repoRoot,
      worktreeCommit: opts.worktreeCommit ?? null,
      outcome,
      attempts,
      ...(opts.verification ? { verification: opts.verification } : {}),
      regressionArtifact: durableArtifact,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    if (reason) this.appendAttempt(record.attempts, this.attempt(0, "engine", "ABORTED", reason));
    try {
      this.persistRepairRecord(record);
    } catch (err) {
      if (requiresEvidence) {
        throw new RequiredRepairEvidenceError(
          `required repair record could not be committed: ${errorMessage(err)}`,
          { cause: err },
        );
      }
      /* Optional diagnostics are intentionally best effort. */
    }
    return record;
  }

  private persistRegressionArtifact(source: string, findingId: string): string {
    mkdirSync(this.opts.evidenceDir, { recursive: true });
    const durable = join(this.opts.evidenceDir, `regression-${findingId}.json`);
    const temporary = `${durable}.tmp-${process.pid}-${Date.now()}`;
    try {
      (this.opts.persistence?.copyArtifact ?? copyFileSync)(source, temporary);
      this.fsyncPath(temporary);
      this.renamePath(temporary, durable);
      return durable;
    } catch (err) {
      rmSync(temporary, { force: true });
      throw err;
    }
  }

  private persistRepairRecord(record: RepairRecord): void {
    mkdirSync(this.opts.evidenceDir, { recursive: true });
    const destination = join(this.opts.evidenceDir, `repair-${record.findingId}.json`);
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    try {
      const content = JSON.stringify(record, null, 2);
      (this.opts.persistence?.writeRecord ?? writeFileSync)(temporary, content);
      this.fsyncPath(temporary);
      this.renamePath(temporary, destination);
    } catch (err) {
      rmSync(temporary, { force: true });
      throw err;
    }
  }

  private fsyncPath(path: string): void {
    if (this.opts.persistence?.fsync) {
      this.opts.persistence.fsync(path);
      return;
    }
    // Windows rejects fsync on a read-only handle; a read/write handle gives
    // the same flush semantics and remains valid for the temporary file.
    const fd = openSync(path, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private renamePath(source: string, destination: string): void {
    if (this.opts.persistence?.rename) {
      this.opts.persistence.rename(source, destination);
      return;
    }
    renameSync(source, destination);
  }
}

function summarizeEvidence(evidence: ReplayEvidence): ReplayEvidenceSummary {
  return {
    disposition: evidence.disposition,
    expectation: evidence.expectation,
    requiredActions: evidence.requiredActions,
    executedOutcomes: evidence.executedOutcomes,
    matchedOracleIds: [...evidence.matchedOracleIds],
    reason: evidence.reason,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FileSnapshot {
  full: string;
  existed: boolean;
  bytes: Buffer | null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function rollbackFiles(
  snapshots: FileSnapshot[],
  directories: string[],
): Promise<boolean> {
  const { rm, rmdir, writeFile } = await import("node:fs/promises");
  let succeeded = true;
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existed && snapshot.bytes) {
        await writeFile(snapshot.full, snapshot.bytes);
      } else {
        await rm(snapshot.full, { force: true });
      }
    } catch {
      succeeded = false;
    }
  }
  for (const directory of [...new Set(directories)].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(directory);
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}
