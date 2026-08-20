import type {
  Action,
  ActionOutcome,
  Observation,
} from "@inspector/protocol";

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
}

export interface Oracle {
  id: string;
  detect(result: ReplayResult): boolean;
}

export interface ReproductionPolicy {
  attempts: number;
  minSuccesses: number;
}

export interface ReproductionStats {
  attempts: number;
  successes: number;
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
}

export interface EvidenceBundle {
  schema: "inspector-evidence/1";
  finding: Finding;
  revision: string | null;
  environment: Record<string, unknown>;
  originalSteps: Action[];
  minimizedSteps: Action[];
  oracleEvidence: OracleSignal[];
  artifactRefs: string[];
  replayCommand: string;
}

export interface RegressionScenario {
  schema: "inspector-regression/1";
  findingId: string;
  adapter: string;
  steps: Action[];
  expectOracle: OracleSignalKind;
}
