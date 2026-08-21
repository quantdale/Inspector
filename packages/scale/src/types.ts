/** Work executed by a campaign worker (M7 S0/S5). */
export interface WorkItem {
  id: string;
  /** Deterministic ordering key: lower runs first. */
  priority: number;
  mode: "hunt" | "regression" | "repair";
  /** Target adapter spawn descriptor id registered in the AdapterRegistry. */
  target: string;
  seed: number;
  /** Number of observe/act cycles the worker executes. */
  steps: number;
}

export interface LeaseRecord {
  itemId: string;
  workerId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

/** Resource accounting entry (M7 S3). */
export interface UsageEntry {
  workerId: string;
  itemId?: string;
  modelRequests?: number;
  tokens?: number;
  costUsd?: number;
  actions?: number;
  resets?: number;
  artifactBytes?: number;
}

export interface Budget {
  maxModelRequests?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxActions?: number;
}

/** Model routing (M7 S2). */
export type ModelRole = "planner" | "summarizer" | "repairer";

export interface ModelProvider {
  id: string;
  roles: ModelRole[];
  priority: number; // higher preferred
  costPer1kTokens: number;
  healthy: boolean;
  complete(input: string): Promise<string>;
}
