import type { Action } from "@inspector/protocol";

export type RiskKey = Action["risk"];

export interface PolicyCapabilities {
  observe: boolean;
  interact: boolean;
  mutate_test_state: boolean;
  modify_source: boolean;
  publish: boolean;
}

export interface PolicyBudgets {
  wall_clock_minutes: number;
  max_actions: number;
  max_environment_resets: number;
  max_concurrent_environments: number;
  max_artifact_megabytes: number;
  max_model_requests: number;
  max_repairs_per_finding: number;
}

export interface Policy {
  name: string;
  capabilities: PolicyCapabilities;
  budgets: PolicyBudgets;
}

export type PolicyRejectionCode =
  | "CAPABILITY_DENIED"
  | "BUDGET_EXHAUSTED"
  | "DEADLINE_MISSING"
  | "CONCURRENCY_EXCEEDED";

export interface PolicyDecision {
  allowed: boolean;
  code?: PolicyRejectionCode;
  reason?: string;
}

const RISK_CAPABILITY: Record<RiskKey, keyof PolicyCapabilities> = {
  observe: "observe",
  interact: "interact",
  "mutate-test-state": "mutate_test_state",
  "modify-source": "modify_source",
  publish: "publish",
};

export const DEFAULT_POLICY: Policy = {
  name: "default-local-safe",
  capabilities: {
    observe: true,
    interact: true,
    mutate_test_state: false,
    modify_source: false,
    publish: false,
  },
  budgets: {
    wall_clock_minutes: 60,
    max_actions: 2000,
    max_environment_resets: 100,
    max_concurrent_environments: 1,
    max_artifact_megabytes: 2048,
    max_model_requests: 1000,
    max_repairs_per_finding: 0,
  },
};

export interface BudgetCounters {
  actions: number;
  resets: number;
  artifactBytes: number;
  modelRequests: number;
  repairs: number;
  openEnvironments: number;
}

export class PolicyEngine {
  readonly counters: BudgetCounters = {
    actions: 0,
    resets: 0,
    artifactBytes: 0,
    modelRequests: 0,
    repairs: 0,
    openEnvironments: 0,
  };

  constructor(public readonly policy: Policy = DEFAULT_POLICY) {}

  evaluate(action: Action): PolicyDecision {
    const capKey = RISK_CAPABILITY[action.risk];
    if (!this.policy.capabilities[capKey]) {
      return {
        allowed: false,
        code: "CAPABILITY_DENIED",
        reason: `capability '${capKey}' is not granted by policy '${this.policy.name}'`,
      };
    }
    if (!action.deadlineMs || action.deadlineMs < 1) {
      return { allowed: false, code: "DEADLINE_MISSING", reason: "action has no positive deadline" };
    }
    if (this.counters.actions + 1 > this.policy.budgets.max_actions) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "max_actions budget exhausted" };
    }
    return { allowed: true };
  }

  /** Record that an action was admitted and executed. */
  recordAction(): void {
    this.counters.actions += 1;
  }

  /**
   * Seed the action counter from durable state (committed action count for a
   * run). A restart with a fresh engine must not reset max_actions, or
   * crash-looping runs could evade the budget forever. Takes the maximum so
   * an engine shared across runs stays monotonic.
   */
  seedActionCount(count: number): void {
    this.counters.actions = Math.max(this.counters.actions, count);
  }

  recordReset(): PolicyDecision {
    if (this.counters.resets + 1 > this.policy.budgets.max_environment_resets) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "max_environment_resets exhausted" };
    }
    this.counters.resets += 1;
    return { allowed: true };
  }

  /** Seed reset budget from durable exploration reset admissions after restart. */
  seedResetCount(count: number): void {
    this.counters.resets = Math.max(this.counters.resets, count);
  }

  /** Seed artifact accounting from the durable observation index on restart. */
  seedArtifactBytes(bytes: number): void {
    this.counters.artifactBytes = Math.max(this.counters.artifactBytes, bytes);
  }

  recordArtifactBytes(bytes: number): PolicyDecision {
    const limit = this.policy.budgets.max_artifact_megabytes * 1024 * 1024;
    if (this.counters.artifactBytes + bytes > limit) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "artifact megabyte budget exhausted" };
    }
    this.counters.artifactBytes += bytes;
    return { allowed: true };
  }

  openEnvironment(): PolicyDecision {
    if (this.counters.openEnvironments + 1 > this.policy.budgets.max_concurrent_environments) {
      return { allowed: false, code: "CONCURRENCY_EXCEEDED", reason: "max_concurrent_environments exceeded" };
    }
    this.counters.openEnvironments += 1;
    return { allowed: true };
  }

  closeEnvironment(): void {
    if (this.counters.openEnvironments > 0) this.counters.openEnvironments -= 1;
  }
}
