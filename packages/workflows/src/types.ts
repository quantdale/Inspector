/** Progress sink; stderr so stdout stays parseable. */
export type ProgressFn = (line: string) => void;

/**
 * Campaign execution control threaded into the exploration loops
 * (HARDENING_2 D1/D3). Structurally `@inspector/explore`'s hook so CLI and
 * fleet callers share one shape.
 */
export type ExplorationControl = import("@inspector/explore").ExplorationControl;

/** Adapter families an exploration workflow can drive. */
export type ExplorationAdapter = "web" | "fake" | "cli" | "windows" | "android";

export interface HuntRequest {
  adapter: ExplorationAdapter;
  targetUrl?: string;
  /** Native target hint: UIA title substring, android launchPackage, or CLI
   * program name — interpreted per adapter (SPEC-009 W4). */
  target?: string;
  seed: number;
  maxActions: number;
  maxMinutes: number;
  maxFindings: number;
  resumeRunId?: string;
}

export interface HuntOutcomeEntry {
  classKey: string;
  outcome: string;
  detail?: string;
  findingId?: string;
}

export type ExplorationWorkflow = "hunt" | "explore";

/** M13: additive model-assistance summary on hunt/explore results. */
export interface HuntModelSummary {
  providers: string[];
  planner?: { calls: number; accepted: number; rejected: number };
  suspicions?: Array<{
    classKey: string;
    disposition: string;
    confidence: number;
    summary: string;
    classification?: string;
  }>;
  runtimeStats: {
    requests: number;
    attempts: number;
    completed: number;
    failed: number;
    denials: number;
  };
  budgetTotals?: { requests: number; tokens: number; costUsd: number; activeReservations: number };
}

/** Shape shared by the web (ExploreController) and fake (walker) hunts. */
export interface HuntRunResult {
  runId: string;
  seed: number;
  stoppedReason: string;
  actionsExecuted: number;
  statesVisited: number;
  resets: number;
  anomalyCount: number;
  findings: import("@inspector/finding").Finding[];
  evidenceBundles: import("@inspector/finding").EvidenceBundle[];
  findingOutcomes: HuntOutcomeEntry[];
  warnings: string[];
  /** M13: present only when model assistance was configured. */
  model?: HuntModelSummary;
}
