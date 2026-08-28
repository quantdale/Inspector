import type {
  Action,
  ActionOutcome,
  Observation,
} from "@inspector/protocol";
import type { OracleEvaluationRecord } from "@inspector/store-sqlite";

export type { Action, ActionOutcome, Observation } from "@inspector/protocol";

export type OracleSignalKind =
  | "TARGET_FAILURE"
  | "PAGE_ERROR"
  | "DEFECT_SUBMIT_INVALID"
  | "IMPOSSIBLE_STATE"
  | "ADAPTER_CRASH";

export interface OracleSignal {
  kind: OracleSignalKind;
  detail?: unknown;
}

export interface ReplayResult {
  outcomes: ActionOutcome[];
  signals: OracleSignal[];
  observations: Observation[];
}

export interface ReplayDriver {
  replay(actions: Action[]): Promise<ReplayResult>;
  /**
   * M12 F9: optional lifecycle hook. Drivers that keep a persistent adapter
   * process across replays (a runtime-efficiency optimization) release it
   * here; the explorer calls this after every confirmation cycle. Optional
   * for backward compatibility.
   */
  dispose?(): Promise<void>;
}

export interface Oracle {
  id: string;
  detect(result: ReplayResult): boolean;
  /**
   * Optional descriptor metadata for oracle provenance records. Plain
   * detectors may omit them; the fields stay nullable in persisted evidence.
   */
  kind?: string;
  strength?: "hard" | "soft";
  confidence?: number;
  description?: string;
}

export interface ReproductionPolicy {
  attempts: number;
  minSuccesses: number;
  /**
   * Optional bounded wall-clock timeout per replay attempt (ms). A hung
   * driver attempt is counted as a failed attempt instead of blocking the
   * reproduction forever.
   */
  perAttemptTimeoutMs?: number;
}

export interface ReproductionStats {
  attempts: number;
  successes: number;
  /** Attempts that failed because the driver threw or timed out. */
  errors?: number;
  /** Message of the last contained driver error, if any. */
  lastError?: string | null;
  /**
   * Ids of the oracles that fired on successful reproduction attempts
   * (union across attempts). Names the deciding detectors for audit.
   */
  matchedOracleIds?: string[];
}

/** Statistics recorded by a minimization run. */
export interface MinimizationStats {
  /** Replay probes spent by the minimization run (including the baseline). */
  probes: number;
  /** Actions removed relative to the original sequence. */
  removals: number;
  /**
   * True when the returned sequence was verified (under this run's own
   * probes) to reproduce the original defect signature. False means the
   * budget or environment did not allow verification.
   */
  verifiedReproduction: boolean;
}

/**
 * Extracts the defect signature of a replay result. The default extractor
 * canonicalizes the sorted distinct oracle signal kinds. Pluggable
 * extractors may use any vocabulary, but must be consistent: a reduction is
 * only accepted when the candidate's extracted signature equals the
 * original defect signature.
 */
export type SignatureExtractor = (result: ReplayResult) => string | null;

/** Audit metadata for a finding status transition. */
export interface TransitionMeta {
  from: FindingStatus;
  to: FindingStatus;
  at: string;
  reason?: string;
  actor?: string;
}

export type FindingStatus =
  | "OBSERVED"
  | "CANDIDATE"
  | "REPRODUCING"
  | "MINIMIZED"
  | "CONFIRMED"
  | "PATCHING"
  | "VERIFYING"
  | "RESOLVED"
  | "REGRESSED"
  | "REJECTED"
  | "FLAKY"
  | "NEEDS_HUMAN_ORACLE";

export interface Finding {
  id: string;
  runId: string | null;
  status: FindingStatus;
  title: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  revision: string | null;
  oracleIds: string[];
  reproduction: ReproductionStats | null;
  artifactRefs: string[];
  createdAt: string;
  updatedAt: string;
  /** Primary defect signature recorded at ingest (default: signal kind). */
  signature?: string | null;
  /** Stats from the last minimize() call on this finding. */
  minimization?: MinimizationStats | null;
  /** Audit metadata for the most recent transition. */
  lastTransition?: TransitionMeta | null;
  /** Adapter identity when known at ingest time. */
  adapter?: string | null;
  /** Autonomous exploration defect class, when the finding came from a hunt. */
  classKey?: string | null;
}

export interface EvidenceBundle {
  schema: "inspector-evidence/1";
  finding: Finding;
  revision: string | null;
  environment: Record<string, unknown>;
  originalSteps: Action[];
  minimizedSteps: Action[];
  oracleEvidence: OracleSignal[];
  /**
   * Persisted per-oracle evaluation history for this finding (reproduce,
   * minimize, repair-verify phases) so the bundle answers which oracles ran,
   * what they observed, and why the finding was promoted.
   */
  evaluations: OracleEvaluationRecord[];
  artifactRefs: string[];
  replayCommand: string;
}

export interface RegressionScenario {
  schema: "inspector-regression/1";
  findingId: string;
  adapter: string;
  /** Actual backend identity when a generic adapter has multiple backends. */
  backend?: string;
  /** Stable target identity when the provider exposes one. */
  target?: string;
  steps: Action[];
  expectOracle: OracleSignalKind;
}
