import type { ModelProvider, ModelRole } from "./types.js";

export interface RouteResult {
  provider: ModelProvider;
  output: string;
  fallbacksUsed: string[];
}

/**
 * Provider-neutral model router (M7 S2). Routes by role, preferring the
 * highest-priority healthy provider; on provider failure it falls back down
 * the priority list and finally escalates (throws) per policy. No core
 * workflow depends on a specific vendor.
 */
export class ModelRouter {
  private readonly providers: ModelProvider[] = [];

  register(provider: ModelProvider): this {
    this.providers.push(provider);
    return this;
  }

  candidates(role: ModelRole): ModelProvider[] {
    return this.providers
      .filter((p) => p.roles.includes(role) && p.healthy)
      .sort((a, b) => b.priority - a.priority);
  }

  async complete(role: ModelRole, input: string): Promise<RouteResult> {
    const candidates = this.candidates(role);
    if (candidates.length === 0) throw new Error(`no healthy provider for role '${role}'`);
    const fallbacksUsed: string[] = [];
    for (const p of candidates) {
      try {
        const output = await p.complete(input);
        return { provider: p, output, fallbacksUsed };
      } catch {
        fallbacksUsed.push(p.id);
      }
    }
    throw new Error(`all providers for role '${role}' failed: ${fallbacksUsed.join(", ")}`);
  }
}
