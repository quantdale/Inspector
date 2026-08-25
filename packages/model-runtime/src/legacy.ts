import type { ModelProvider, ModelRequestSpec, ProviderOutcome } from "./types.js";

/**
 * Back-compat adapter for the legacy M7 scale provider shape
 * (`{id, roles, priority, costPer1kTokens, healthy: boolean,
 * complete(input): Promise<string>}`). Existing `@inspector/scale`
 * consumers keep working while routing moves onto the model runtime
 * (ADR-0013 §1).
 */
export interface LegacyModelProvider {
  id: string;
  roles: Array<"planner" | "summarizer" | "repairer">;
  priority: number;
  costPer1kTokens: number;
  healthy: boolean;
  complete(input: string): Promise<string>;
}

export function legacyProviderAdapter(legacy: LegacyModelProvider): ModelProvider {
  return {
    meta: {
      id: legacy.id,
      roles: legacy.roles.slice(),
      priority: legacy.priority,
      estimatesUsage: false,
      deadlineAware: false,
    },
    healthy(): boolean {
      return legacy.healthy;
    },
    estimate(_spec: ModelRequestSpec): { tokens?: number; costUsd?: number } | null {
      // The legacy contract carries no estimation capability; reservations
      // fall back to the gate's configured conservative bound.
      void _spec;
      return null;
    },
    async invoke(invocation): Promise<ProviderOutcome> {
      const text = await legacy.complete(invocation.spec.prompt);
      const usage =
        legacy.costPer1kTokens > 0 && text.length >= 0
          ? undefined // no truthful token data exists in the legacy shape; never fabricate
          : undefined;
      return { text, ...(usage ? { usage } : {}) };
    },
  };
}
