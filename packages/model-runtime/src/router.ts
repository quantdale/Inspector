import { createHash } from "node:crypto";
import {
  ProviderFailure,
  newModelRequestId,
  type ModelBudgetGate,
  type ModelCallRecord,
  type ModelCallResult,
  type ModelCallSink,
  type ModelFailureClass,
  type ModelProvider,
  type ModelRequestSpec,
  type ModelRole,
  type ModelRuntimeStats,
  type ModelUsage,
} from "./types.js";

export interface InvokeOptions {
  signal?: AbortSignal;
  gate?: ModelBudgetGate;
  sink?: ModelCallSink;
}

type AttemptOutcome =
  | {
      kind: "invoked";
      text: string;
      usage?: ModelUsage;
      providerRequestId?: string;
    }
  | {
      kind: "failed";
      classification: ModelFailureClass;
      detail: string;
    };

/**
 * Provider-neutral model runtime (M13 F1/F2, ADR-0013). Routes by role,
 * preferring the highest-priority healthy provider with deterministic
 * tie-breaking (provider id ascending). Transport/provider failures fall
 * back down the priority list; response-validation outcomes
 * (`malformed-response`, `schema-invalid`) are terminal for the call —
 * retrying another provider cannot change a deterministic contract violation
 * and would only double-spend.
 *
 * Per attempt, in order: budget reservation BEFORE invocation (when a gate
 * is configured), durable `started` sink row BEFORE external inference,
 * settlement with actual usage afterwards — conservatively when usage is
 * unknown or the outcome raced a deadline/cancel. Deadlines and cooperative
 * cancellation are enforced through an internal AbortController even for
 * providers that ignore signals; a late provider resolution after
 * deadline/cancel is discarded, and its possible consumption was already
 * settled conservatively (never silently refunded).
 */
export class ModelRuntime {
  private readonly providers: ModelProvider[] = [];
  private readonly unhealthy = new Map<string, string>();
  private readonly statsInternal: Required<Omit<ModelRuntimeStats, "failuresByClass">> & {
    failuresByClass: Partial<Record<ModelFailureClass, number>>;
  } = {
    requests: 0,
    attempts: 0,
    completed: 0,
    failed: 0,
    fallbacksUsed: 0,
    denials: 0,
    storeErrors: 0,
    failuresByClass: {},
  };

  register(provider: ModelProvider): this {
    if (!provider.meta || typeof provider.meta.id !== "string" || provider.meta.id.length === 0) {
      throw new TypeError("model provider requires meta.id");
    }
    if (!Array.isArray(provider.meta.roles) || provider.meta.roles.length === 0) {
      throw new TypeError(`model provider '${provider.meta.id}' declares no roles`);
    }
    if (typeof provider.invoke !== "function" || typeof provider.healthy !== "function") {
      throw new TypeError(`model provider '${provider.meta.id}' must implement healthy()/invoke()`);
    }
    this.providers.push(provider);
    return this;
  }

  /** Operator/test hook: exclude a provider until explicitly restored. */
  markUnhealthy(providerId: string, reason: string): void {
    this.unhealthy.set(providerId, reason);
  }

  markHealthy(providerId: string): void {
    this.unhealthy.delete(providerId);
  }

  /** Truthful health = provider's own claim AND not operator-excluded. */
  isHealthy(provider: ModelProvider): boolean {
    if (this.unhealthy.has(provider.meta.id)) return false;
    try {
      return provider.healthy() === true;
    } catch {
      return false;
    }
  }

  candidates(role: ModelRole): ModelProvider[] {
    return this.providers
      .filter((p) => p.meta.roles.includes(role) && this.isHealthy(p))
      .sort((a, b) => b.meta.priority - a.meta.priority || a.meta.id.localeCompare(b.meta.id));
  }

  get stats(): Readonly<ModelRuntimeStats> {
    return this.statsInternal;
  }

  /**
   * Execute one logical model request with bounded attempts, reservations,
   * sink persistence, and classified outcomes. Never throws: every failure
   * is returned as a structured result so optional intelligence degrades
   * instead of crashing deterministic workflows.
   */
  async invoke(spec: ModelRequestSpec, opts: InvokeOptions = {}): Promise<ModelCallResult> {
    this.statsInternal.requests += 1;
    const requestId = newModelRequestId();
    // Cooperative cancellation observed before any work: nothing is admitted,
    // nothing is invoked, nothing is persisted.
    if (opts.signal?.aborted) {
      return this.failure(requestId, "cancelled", "cooperative cancellation observed before invocation");
    }
    const candidates = this.candidates(spec.role).map((provider, index) => ({
      provider,
      fallbackPosition: index,
    }));
    if (candidates.length === 0) {
      const anyForRole = this.providers.some((p) => p.meta.roles.includes(spec.role));
      const classification: ModelFailureClass = anyForRole ? "provider-unhealthy" : "no-provider";
      return this.failure(requestId, classification, `role '${spec.role}' has no callable provider`);
    }

    const fallbacksUsed: string[] = [];
    let lastFailure: { classification: ModelFailureClass; detail: string } | null = null;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const { provider, fallbackPosition } = candidate;
      this.statsInternal.attempts += 1;
      const attemptNumber = fallbackPosition + 1;
      const attemptId = `${requestId}/a${attemptNumber}`;
      const startedAt = new Date().toISOString();
      const contextSha256 = sha256Hex(spec.prompt);
      const promptBytes = byteLength(spec.prompt);

      let reservedTokens: number | undefined;
      let reservedCostUsd: number | undefined;
      if (opts.gate) {
        const estimate = this.resolveEstimate(provider, spec);
        reservedTokens = estimate.tokens;
        reservedCostUsd = estimate.costUsd;
        let admitted: boolean;
        try {
          admitted = opts.gate.admit({
          requestId,
          attemptId,
          role: spec.role,
          requestClass: spec.requestClass,
          workerId: spec.attribution?.workerId,
          itemId: spec.attribution?.itemId,
          estimateTokens: reservedTokens,
          estimateCostUsd: reservedCostUsd,
          attribution: spec.attribution,
          });
        } catch (err) {
          // Fail-closed containment (HARDENING_3 H3-D5): a throwing budget
          // gate is an accounting-boundary fault — never a reason to crash
          // deterministic callers and never a license for unaccounted spend.
          // No invocation happens; no reservation is assumed held.
          void err;
          this.recordTo(
            opts.sink,
            spec,
            attemptId,
            requestId,
            attemptNumber,
            fallbackPosition,
            provider,
            "failed",
            "budget-gate-error",
            { contextSha256, promptBytes, startedAt },
          );
          return this.failure(
            requestId,
            "budget-gate-error",
            "model budget gate threw during admission; invocation refused fail-closed",
            {
              providerId: provider.meta.id,
              modelId: provider.meta.modelId,
              attemptNumber,
              fallbacksUsed,
            },
          );
        }
        if (!admitted) {
          this.statsInternal.denials += 1;
          this.recordTo(
            opts.sink,
            spec,
            attemptId,
            requestId,
            attemptNumber,
            fallbackPosition,
            provider,
            "denied",
            "budget-denied",
            { contextSha256, promptBytes, startedAt },
          );
          return this.failure(requestId, "budget-denied", "model budget admission denied before invocation", {
            providerId: provider.meta.id,
            modelId: provider.meta.modelId,
            attemptNumber,
            fallbacksUsed,
          });
        }
      }

      if (opts.sink) {
        try {
          opts.sink.start(
            row({
              id: attemptId,
              requestId,
              attemptNumber,
              fallbackPosition,
              status: "started",
              role: spec.role,
              requestClass: spec.requestClass,
              providerId: provider.meta.id,
              modelId: provider.meta.modelId ?? null,
              errorClassification: null,
              attribution: spec.attribution ?? {},
              contextSha256,
              responseSha256: null,
              promptBytes,
              responseBytes: null,
              startedAt,
              completedAt: null,
              metadataJson: spec.metadata ?? null,
            }),
          );
        } catch {
          // Fail-closed BEFORE external inference (HARDENING_3 H3-D5): an
          // unpersistable `started` row means the attempt would spend without
          // durable observability. The provider is not invoked; the just-made
          // reservation converts conservatively (never silently refunded).
          settleGate(opts.gate, { requestId, attemptId, outcome: "failed" });
          this.count("model-store-error");
          return this.failure(
            requestId,
            "model-store-error",
            "durable model-call persistence failed before invocation; attempt aborted fail-closed",
            {
              providerId: provider.meta.id,
              modelId: provider.meta.modelId,
              attemptNumber,
              fallbacksUsed,
            },
          );
        }
      }

      const startedMs = Date.now();
      const outcome = await this.raceAttempt(provider, spec, requestId, attemptId, attemptNumber, opts);
      const latencyMs = Date.now() - startedMs;

      if (outcome.kind === "invoked") {
        const usage = outcome.usage ?? {};
        const validated = validateResponse(spec, outcome.text);
        if (!validated.ok) {
          // The response was really produced (and likely charged); settle
          // actuals truthfully before classifying.
          settleGate(opts.gate, { requestId, attemptId, usage, outcome: "failed" });
          this.recordTo(
            opts.sink,
            spec,
            attemptId,
            requestId,
            attemptNumber,
            fallbackPosition,
            provider,
            "failed",
            validated.classification,
            {
              contextSha256,
              promptBytes,
              startedAt,
              latencyMs,
              responseBytes: byteLength(outcome.text),
              responseSha256: sha256Hex(outcome.text),
              usage,
            },
          );
          return this.failure(requestId, validated.classification, validated.detail, {
            providerId: provider.meta.id,
            modelId: provider.meta.modelId,
            attemptNumber,
            fallbacksUsed,
          });
        }
        settleGate(opts.gate, { requestId, attemptId, usage, outcome: "completed" });
        this.statsInternal.completed += 1;
        this.recordTo(
          opts.sink,
          spec,
          attemptId,
          requestId,
          attemptNumber,
          fallbackPosition,
          provider,
          "completed",
          null,
          {
            contextSha256,
            promptBytes,
            startedAt,
            latencyMs,
            responseBytes: byteLength(outcome.text),
            responseSha256: sha256Hex(outcome.text),
            usage,
          },
        );
        return {
          requestId,
          ok: true,
          text: outcome.text,
          ...(validated.json !== undefined ? { json: validated.json } : {}),
          usage,
          latencyMs,
          attempt: {
            providerId: provider.meta.id,
            modelId: provider.meta.modelId,
            attemptNumber,
            fallbacksUsed,
          },
        };
      }

      // Failure: consumption state may be unknown (deadline/cancel/transport).
      // Settling without usage lets the gate convert the reservation
      // conservatively instead of pretending the call was free.
      settleGate(opts.gate, { requestId, attemptId, outcome: "failed" });
      this.statsInternal.failed += 1;
      this.recordTo(opts.sink, spec, attemptId, requestId, attemptNumber, fallbackPosition, provider, outcome.classification === "cancelled" ? "cancelled" : "failed", outcome.classification, {
        contextSha256,
        promptBytes,
        startedAt,
        latencyMs,
      });
      fallbacksUsed.push(provider.meta.id);
      lastFailure = { classification: outcome.classification, detail: outcome.detail };
      const retriable =
        outcome.classification === "transport-error" ||
        outcome.classification === "provider-error" ||
        outcome.classification === "deadline";
      const hasNext = candidateIndex < candidates.length - 1;
      // HARDENING_4 H4.6: `fallbacksUsed` counts REAL fallbacks — moving to
      // the next candidate. A terminal failure on the last candidate is a
      // failure, not a fallback.
      if (retriable && hasNext) this.statsInternal.fallbacksUsed += 1;
      if (!retriable) {
        return this.failure(requestId, outcome.classification, outcome.detail, {
          providerId: provider.meta.id,
          modelId: provider.meta.modelId,
          attemptNumber,
          fallbacksUsed,
        });
      }
      if (!hasNext) break; // Exhausted: report via the exhaustion block below.
    }
    // Exhausted every candidate: report the LAST failure's classification
    // truthfully (deadline exhaustion stays a deadline, etc.) with full
    // fallback provenance.
    const final = lastFailure ?? { classification: "provider-error" as ModelFailureClass, detail: "no attempts were made" };
    return this.failure(
      requestId,
      final.classification,
      `all providers for role '${spec.role}' failed (${fallbacksUsed.join(", ")}): ${final.detail}`,
      {
        providerId: fallbacksUsed[fallbacksUsed.length - 1],
        attemptNumber: fallbacksUsed.length,
        fallbacksUsed,
      },
    );
  }

  private resolveEstimate(
    provider: ModelProvider,
    spec: ModelRequestSpec,
  ): { tokens?: number; costUsd?: number } {
    if (spec.estimate && (spec.estimate.tokens !== undefined || spec.estimate.costUsd !== undefined)) {
      return { tokens: spec.estimate.tokens, costUsd: spec.estimate.costUsd };
    }
    try {
      const provided = provider.estimate?.(spec);
      if (provided && (provided.tokens !== undefined || provided.costUsd !== undefined)) {
        return { tokens: provided.tokens, costUsd: provided.costUsd };
      }
    } catch {
      /* estimation is best-effort; the gate's configured default bound applies */
    }
    return {};
  }

  private async raceAttempt(
    provider: ModelProvider,
    spec: ModelRequestSpec,
    requestId: string,
    attemptId: string,
    attemptNumber: number,
    opts: InvokeOptions,
  ): Promise<AttemptOutcome> {
    const controller = new AbortController();
    let timedOut = false;
    let externallyCancelled = opts.signal?.aborted === true;
    const onExternalAbort = () => {
      externallyCancelled = true;
      controller.abort();
    };
    if (opts.signal) {
      opts.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer =
      spec.deadlineMs && spec.deadlineMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, spec.deadlineMs)
        : null;
    timer?.unref?.();
    try {
      // The runtime owns the outcome even when a provider ignores signals:
      // deadline/external-cancel win the race immediately, and a late
      // settlement of the underlying promise is discarded (its possible
      // consumption was already settled conservatively).
      const attempted = provider.invoke({
        requestId,
        attemptId,
        attemptNumber,
        spec,
        signal: controller.signal,
      });
      const invoked = attempted.then(
        (outcome): AttemptOutcome | { kind: "thrown"; error: unknown } => ({
          kind: "invoked",
          text: outcome.text,
          usage: outcome.usage,
          providerRequestId: outcome.providerRequestId,
        }),
        (error: unknown): AttemptOutcome | { kind: "thrown"; error: unknown } => ({
          kind: "thrown",
          error,
        }),
      );
      const aborted = new Promise<{ kind: "aborted" }>((resolve) => {
        if (controller.signal.aborted) resolve({ kind: "aborted" });
        else controller.signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
      });
      const raced = await Promise.race([invoked, aborted]);
      if (raced.kind === "aborted") {
        return externallyCancelled
          ? { kind: "failed", classification: "cancelled", detail: "cooperative cancellation observed" }
          : timedOut
            ? { kind: "failed", classification: "deadline", detail: `attempt exceeded ${String(spec.deadlineMs)}ms deadline` }
            : { kind: "failed", classification: "cancelled", detail: "attempt aborted" };
      }
      if (raced.kind === "thrown") {
        const err = raced.error;
        if (externallyCancelled) {
          return { kind: "failed", classification: "cancelled", detail: "cooperative cancellation observed" };
        }
        if (timedOut) {
          return { kind: "failed", classification: "deadline", detail: `attempt exceeded ${String(spec.deadlineMs)}ms deadline` };
        }
        if (controller.signal.aborted) {
          return { kind: "failed", classification: "cancelled", detail: "attempt aborted" };
        }
        if (err instanceof ProviderFailure) {
          return { kind: "failed", classification: err.classification, detail: err.message };
        }
        return {
          kind: "failed",
          classification: "transport-error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      return raced;
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private recordTo(
    sink: ModelCallSink | undefined,
    spec: ModelRequestSpec,
    attemptId: string,
    requestId: string,
    attemptNumber: number,
    fallbackPosition: number,
    provider: ModelProvider,
    status: ModelCallRecord["status"],
    errorClassification: ModelFailureClass | null,
    parts: {
      contextSha256: string;
      promptBytes: number;
      startedAt: string;
      latencyMs?: number;
      responseBytes?: number;
      responseSha256?: string;
      usage?: ModelUsage;
    },
  ): void {
    if (errorClassification && errorClassification !== "budget-denied") this.count(errorClassification);
    else if (errorClassification === "budget-denied") this.count(errorClassification);
    if (!sink) return;
    try {
      sink.finish(
        row({
          id: attemptId,
          requestId,
          attemptNumber,
          fallbackPosition,
          status,
          role: spec.role,
          requestClass: spec.requestClass,
          providerId: provider.meta.id,
          modelId: provider.meta.modelId ?? null,
          errorClassification,
          attribution: spec.attribution ?? {},
          contextSha256: parts.contextSha256,
          responseSha256: parts.responseSha256 ?? null,
          promptBytes: parts.promptBytes,
          responseBytes: parts.responseBytes ?? null,
          ...(parts.usage?.inputTokens !== undefined ? { inputTokens: parts.usage.inputTokens } : {}),
          ...(parts.usage?.outputTokens !== undefined ? { outputTokens: parts.usage.outputTokens } : {}),
          ...(parts.usage?.cachedInputTokens !== undefined
            ? { cachedInputTokens: parts.usage.cachedInputTokens }
            : {}),
          ...(parts.usage?.totalChargedTokens !== undefined
            ? { totalChargedTokens: parts.usage.totalChargedTokens }
            : {}),
          ...(parts.usage?.costUsd !== undefined ? { costUsd: parts.usage.costUsd } : {}),
          ...(parts.latencyMs !== undefined ? { latencyMs: parts.latencyMs } : {}),
          startedAt: parts.startedAt,
          completedAt: new Date().toISOString(),
          metadataJson: spec.metadata ?? null,
        }),
      );
    } catch {
      // Terminal-persistence failure (HARDENING_3 H3-D5): the call outcome is
      // already decided and must not be corrupted, but the loss of durable
      // truth becomes observable runtime state instead of an escape.
      this.statsInternal.storeErrors += 1;
    }
  }

  private count(classification: ModelFailureClass): void {
    const current = this.statsInternal.failuresByClass[classification] ?? 0;
    this.statsInternal.failuresByClass[classification] = current + 1;
  }

  private failure(
    requestId: string,
    classification: ModelFailureClass,
    detail: string,
    attempt?: { providerId?: string; modelId?: string; attemptNumber?: number; fallbacksUsed?: string[] },
  ): ModelCallResult {
    if (classification === "no-provider" || classification === "provider-unhealthy") {
      this.count(classification);
    }
    return {
      requestId,
      ok: false,
      usage: {},
      failure: { classification, detail },
      ...(attempt && attempt.providerId !== undefined
        ? {
            attempt: {
              providerId: attempt.providerId,
              ...(attempt.modelId !== undefined ? { modelId: attempt.modelId } : {}),
              attemptNumber: attempt.attemptNumber ?? 0,
              fallbacksUsed: attempt.fallbacksUsed ?? [],
            },
          }
        : {}),
    };
  }
}

function validateResponse(
  spec: ModelRequestSpec,
  text: string,
): { ok: true; json?: unknown } | { ok: false; classification: ModelFailureClass; detail: string } {
  const format = spec.format;
  if (!format || format.kind === "text") return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, classification: "malformed-response", detail: "response is not valid JSON" };
  }
  if (format.validate) {
    const verdict = format.validate(parsed);
    if (!verdict.ok) {
      return {
        ok: false,
        classification: "schema-invalid",
        detail: `schema ${format.schemaId ?? "(unnamed)"} rejected response: ${verdict.detail}`,
      };
    }
  }
  return { ok: true, json: parsed };
}

function settleGate(gate: ModelBudgetGate | undefined, settlement: Parameters<ModelBudgetGate["settle"]>[0]): void {
  try {
    gate?.settle(settlement);
  } catch {
    /* settlement must never crash deterministic callers; the durable journal
       reconciles abandoned reservations conservatively on restart */
  }
}

type ModelCallRowInput = Partial<Omit<ModelCallRecord, "schemaVersion">> &
  Pick<
    ModelCallRecord,
    | "id"
    | "requestId"
    | "attemptNumber"
    | "fallbackPosition"
    | "status"
    | "role"
    | "requestClass"
    | "providerId"
    | "modelId"
    | "errorClassification"
    | "attribution"
    | "contextSha256"
    | "promptBytes"
    | "startedAt"
  >;

function row(input: ModelCallRowInput): ModelCallRecord {
  // Nullable columns are materialized explicitly: unknown stays NULL, never
  // zero-fabricated, and every record carries the full stable shape.
  return {
    schemaVersion: "inspector-model-call/1",
    id: input.id,
    requestId: input.requestId,
    attemptNumber: input.attemptNumber,
    fallbackPosition: input.fallbackPosition,
    status: input.status,
    role: input.role,
    requestClass: input.requestClass,
    providerId: input.providerId,
    modelId: input.modelId,
    errorClassification: input.errorClassification,
    attribution: input.attribution,
    contextSha256: input.contextSha256,
    responseSha256: input.responseSha256 ?? null,
    responseBytes: input.responseBytes ?? null,
    promptBytes: input.promptBytes,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    totalChargedTokens: input.totalChargedTokens ?? null,
    costUsd: input.costUsd ?? null,
    latencyMs: input.latencyMs ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    metadataJson: input.metadataJson ?? null,
  };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
