import {
  ProviderFailure,
  type ModelFailureClass,
  type ModelProvider,
  type ModelProviderMetadata,
  type ModelRequestSpec,
  type ModelRole,
  type ModelUsage,
} from "./types.js";

/** What a scripted provider does for one invocation (M13 F18). */
export type ScriptedOutcome =
  | { text: string; usage?: ModelUsage; providerRequestId?: string; delayMs?: number }
  | { failure: Extract<ModelFailureClass, "provider-error" | "transport-error">; detail: string; delayMs?: number }
  /** Never resolves on its own; only deadline/cancel ends the attempt. */
  | { hangMs: number };

export interface ScriptedCallRecord {
  spec: ModelRequestSpec;
  requestId: string;
  attemptId: string;
  at: string;
}

export interface ScriptedModelProviderOptions {
  id: string;
  modelId?: string;
  roles?: ModelRole[];
  priority?: number;
  estimatesUsage?: boolean;
  /** Conservative pre-call estimate, when this fixture should claim one. */
  estimate?: { tokens?: number; costUsd?: number } | null;
  /**
   * Response script. May be a fixed outcome or a per-call function over the
   * received spec (call order = invocation order). Thrown errors from the
   * script are surfaced as `transport-error`.
   */
  respond: ScriptedOutcome | ((spec: ModelRequestSpec, callIndex: number) => ScriptedOutcome);
}

/**
 * Deterministic scripted model provider used by the entire M13 test matrix
 * AND available as an offline example provider. Zero network, zero
 * credentials: the whole intelligence layer is provable without any external
 * inference service.
 */
export class ScriptedModelProvider implements ModelProvider {
  readonly meta: ModelProviderMetadata;
  private healthyFlag = true;
  private readonly script: ScriptedModelProviderOptions["respond"];
  readonly calls: ScriptedCallRecord[] = [];

  constructor(options: ScriptedModelProviderOptions) {
    this.meta = {
      id: options.id,
      ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      roles: options.roles ?? ["planner", "oracle", "summarizer", "repairer"],
      priority: options.priority ?? 10,
      modalities: ["text"],
      ...(options.estimatesUsage !== undefined ? { estimatesUsage: options.estimatesUsage } : {}),
      deadlineAware: true,
      implementationVersion: "scripted/1",
    };
    this.script = options.respond;
    if (options.estimate) this.estimateFixture = options.estimate;
  }

  private estimateFixture?: { tokens?: number; costUsd?: number } | null;

  healthy(): boolean {
    return this.healthyFlag;
  }

  setHealthy(value: boolean): void {
    this.healthyFlag = value;
  }

  estimate(_spec: ModelRequestSpec): { tokens?: number; costUsd?: number } | null {
    return this.estimateFixture ?? null;
  }

  async invoke(invocation: {
    requestId: string;
    attemptId: string;
    attemptNumber: number;
    spec: ModelRequestSpec;
  }): Promise<{ text: string; usage?: ModelUsage; providerRequestId?: string }> {
    const index = this.calls.length;
    this.calls.push({
      spec: invocation.spec,
      requestId: invocation.requestId,
      attemptId: invocation.attemptId,
      at: new Date().toISOString(),
    });
    const outcome =
      typeof this.script === "function" ? this.script(invocation.spec, index) : this.script;
    if ("hangMs" in outcome) {
      await delay(outcome.hangMs);
      // Still hanging unless the runtime aborted us; surface cancellation by
      // rejecting with transport-error only if truly never aborted.
      throw new ProviderFailure("transport-error", "scripted provider hang elapsed");
    }
    if ("failure" in outcome) {
      if (outcome.delayMs) await delay(outcome.delayMs);
      throw new ProviderFailure(outcome.failure, outcome.detail);
    }
    if (outcome.delayMs) await delay(outcome.delayMs);
    return {
      text: outcome.text,
      ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
      ...(outcome.providerRequestId !== undefined ? { providerRequestId: outcome.providerRequestId } : {}),
    };
  }
}

/** Convenience builders for structured fixtures. */
export function jsonOutcome(value: unknown, extra: { usage?: ModelUsage; delayMs?: number } = {}): ScriptedOutcome {
  return {
    text: JSON.stringify(value),
    ...(extra.usage !== undefined ? { usage: extra.usage } : {}),
    ...(extra.delayMs !== undefined ? { delayMs: extra.delayMs } : {}),
  };
}

export function malformedJsonOutcome(extra: { usage?: ModelUsage; delayMs?: number } = {}): ScriptedOutcome {
  return { text: "{\"actionKey\": not-json", ...(extra.usage !== undefined ? { usage: extra.usage } : {}) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}
