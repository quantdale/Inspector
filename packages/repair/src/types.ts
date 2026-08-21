import type { FindingStatus } from "@inspector/finding";

/** A single file rewrite proposed by a patch agent. */
export interface PatchFile {
  /** Workspace-relative path. */
  path: string;
  /** Full new file content (whole-file patches keep the contract simple). */
  content: string;
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
  regressionArtifact?: string;
  startedAt: string;
  finishedAt: string;
}
