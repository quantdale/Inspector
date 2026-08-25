import { legacyProviderAdapter, ModelRuntime } from "@inspector/model-runtime";
import type { ModelProvider, ModelRole } from "./types.js";

export interface RouteResult {
  provider: ModelProvider;
  output: string;
  fallbacksUsed: string[];
}

/**
 * Provider-neutral model routing (M7 S2; M13 F1 re-platformed onto
 * @inspector/model-runtime per ADR-0013). The public surface
 * (`register`/`candidates`/`complete`) is unchanged for existing consumers:
 * routing, health filtering, priority ordering, deterministic tie-breaking,
 * and fallback escalation now live in the shared runtime so exploration,
 * oracle, repair, workflows, and CLI use ONE model boundary instead of an
 * ad hoc fleet-local one.
 */
export class ModelRouter {
  private readonly runtime = new ModelRuntime();
  private readonly legacy = new Map<string, ModelProvider>();

  register(provider: ModelProvider): this {
    this.runtime.register(legacyProviderAdapter(provider));
    this.legacy.set(provider.id, provider);
    return this;
  }

  /** Shared runtime access for callers that want the richer M13 contract. */
  get modelRuntime(): ModelRuntime {
    return this.runtime;
  }

  candidates(role: ModelRole): ModelProvider[] {
    const out: ModelProvider[] = [];
    for (const adapted of this.runtime.candidates(role)) {
      const original = this.legacy.get(adapted.meta.id);
      if (original && original.roles.includes(role)) out.push(original);
    }
    return out;
  }

  async complete(role: ModelRole, input: string): Promise<RouteResult> {
    const result = await this.runtime.invoke({
      role,
      requestClass: `legacy:${role}`,
      prompt: input,
    });
    if (!result.ok || result.text === undefined || !result.attempt) {
      throw new Error(
        result.failure?.classification === "no-provider" ||
        result.failure?.classification === "provider-unhealthy"
          ? `no healthy provider for role '${role}'`
          : `all providers for role '${role}' failed: ${(result.attempt?.fallbacksUsed ?? []).join(", ")}`,
      );
    }
    const provider = this.legacy.get(result.attempt.providerId);
    if (!provider) throw new Error(`routing lost provider '${result.attempt.providerId}'`);
    return { provider, output: result.text, fallbacksUsed: [...result.attempt.fallbacksUsed] };
  }
}
