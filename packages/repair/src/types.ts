import type { FindingStatus } from "@inspector/finding";
import type { ReplayEvidenceDisposition } from "./replay-evidence.js";

/** A single file rewrite proposed by a patch agent. */
export interface PatchFile {
  /** Workspace-relative path. */
  path: string;
  /** Full new file content (whole-file patches keep the contract simple). */
  content: string;
  /** Certified bytes in the repair worktree before the patch was written. */
  preimageSha256?: string | null;
  /** Whether the certified preimage existed as a regular file. */
  preimageExists?: boolean;
}

export interface Patch {
  files: PatchFile[];
  rationale: string;
}

/** Bounded context handed to a patch agent (M4 P3). */
export interface PatchContext {
  findingId: string;
  findingStatus: FindingStatus;
  errorMessage?: string;
  sourceFiles: Array<{ path: string; content: string }>;
}

export interface PatchAgent {
  readonly id: string;
  proposePatch(ctx: PatchContext): Promise<Patch | null>;
}

export type AttemptVerdict = "ACCEPTED" | "REJECTED" | "ABORTED";

export interface PatchAttempt {
  index: number;
  agentId: string;
  verdict: AttemptVerdict;
  reason?: string;
  patchRationale?: string;
  filesTouched: string[];
  /** Full proposed patch embedded for audit (accepted AND rejected attempts). */
  patch?: Patch;
  /** Positive/negative replay evidence associated with a patch decision. */
  verification?: {
    postPatch: ReplayEvidenceSummary;
    maskingProbe: ReplayEvidenceSummary;
  };
  at: string;
}

/** Redacted, durable summary of a replay gate; raw driver output is not copied. */
export interface ReplayEvidenceSummary {
  disposition: ReplayEvidenceDisposition;
  expectation: "reproduction" | "clean";
  requiredActions: number;
  executedOutcomes: number;
  matchedOracleIds: string[];
  reason: string;
}

export interface RepairVerification {
  prePatch: ReplayEvidenceSummary;
}

export interface PatchApplication {
  status: "APPLIED" | "REFUSED" | "ROLLED_BACK";
  paths: string[];
  rollbackSucceeded: boolean;
  reason?: string;
  at: string;
}

export type RepairOutcome =
  | "RESOLVED"
  | "NO_PATCH"
  | "VERIFICATION_FAILED"
  | "POLICY_BLOCKED"
  | "NO_FAILING_REGRESSION"
  | "PROBE_INVALID"
  | "ERROR";

export interface RepairRecord {
  findingId: string;
  revision: string | null;
  /**
   * Identity of the isolated worktree the repair ran in (per
   * ARCHITECTURE.md "Repository isolation"). The worktree is disposed after
   * the repair; durable copies live in the evidence directory.
   */
  workspacePath: string;
  /** Detached HEAD commit of that worktree, when a workspace was created. */
  worktreeCommit?: string | null;
  outcome: RepairOutcome;
  attempts: PatchAttempt[];
  /** Verification summaries that support the repair conclusion. */
  verification?: RepairVerification;
  /** Durable truth about explicit application to an operator checkout. */
  application?: PatchApplication;
  regressionArtifact?: string;
  startedAt: string;
  finishedAt: string;
}
