/** Work executed by a campaign worker (M7 S0/S5; extended by M12 F1/F2). */
export interface WorkItem {
  id: string;
  /** Deterministic ordering key: lower runs first. */
  priority: number;
  /**
   * Workflow kind. M7 legacy values are `hunt | regression | repair`;
   * M12 adds `explore | verify`. `regression` is kept as a durable alias of
   * `regress` so pre-M12 manifests/state remain loadable.
   */
  mode: "hunt" | "explore" | "verify" | "regress" | "repair" | "regression";
  /** Legacy M7 target id; `"fake"` for the deterministic fixture. */
  target: string;
  seed: number;
  /** Number of observe/act cycles the worker executes (fake fixture). */
  steps: number;
  /** M12 F1: adapter family override; defaults from `target`. */
  adapterFamily?: import("./executor.js").AdapterFamily;
  /** M12 F2: target URI/descriptor (e.g. http://127.0.0.1:PORT/, window title, package). */
  targetUri?: string;
  /** M12 F2: structured target configuration (create options / env deltas). */
  targetConfig?: Record<string, unknown>;
  /** M12 F2: exact source revision provenance when the item is revision-bound. */
  revision?: string | null;
  /** M12 F2: per-item budget ceilings charged through the shared ledger. */
  budgets?: Budget & { maxResets?: number; maxWallMs?: number };
  /** M12 F4: capability tags a worker must present to claim this item. */
  requiresCapabilities?: string[];
  /** M12 F2: item refuses co-scheduling with other work (reserved; default false). */
  exclusive?: boolean;
  /**
   * M12 F2: explicit repair authorization. Repair items are refused with
   * `policy-refusal` unless this is exactly true — discovery never implies
   * repair.
   */
  repairAuthorized?: boolean;
}

export interface LeaseRecord {
  itemId: string;
  workerId: string;
  /** Fencing token: bumped on every acquire/reclaim so stale holders are rejected. */
  generation: number;
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
