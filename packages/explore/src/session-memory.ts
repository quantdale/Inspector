import type {
  ModelAttribution,
  ModelBudgetGate,
  ModelCallSink,
  ModelRuntime,
} from "@inspector/model-runtime";

/**
 * Bounded session summarization memory (M13 F12).
 *
 * A digest is a DERIVED CACHE, never authoritative state: truth remains the
 * actions, observations, graph, findings, oracle evaluations, and durable
 * records. When the summarizer is unavailable, fails, budget-denied, or
 * returns anything but a valid verdict, {@link SessionSummarizer.digest}
 * returns null and callers continue from deterministic structured state.
 */

export const SESSION_DIGEST_SCHEMA = "inspector-session-digest/1";

export interface SessionDigestInput {
  actionsExecuted: number;
  statesVisited: number;
  recentActionKeys: string[];
  anomalies: Array<{ kind: string; message: string }>;
  rejectedSuggestions: string[];
  failedHypotheses?: string[];
}

export interface SessionSummarizerConfig {
  /** Refresh the digest at most every N executed actions. Default 25. */
  refreshIntervalActions?: number;
  timeoutMs?: number;
}

const DEFAULTS = { refreshIntervalActions: 25, timeoutMs: 8000 };

interface DigestJson {
  summary: string;
  openQuestions?: string[];
}

function validateDigest(value: unknown): value is DigestJson {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string" || v.summary.length === 0 || v.summary.length > 1200) return false;
  if (v.openQuestions !== undefined) {
    if (!Array.isArray(v.openQuestions) || v.openQuestions.some((q) => typeof q !== "string")) return false;
    if (v.openQuestions.length > 8) return false;
  }
  return true;
}

export class SessionSummarizer {
  private cachedDigest: string | null = null;
  private cachedAtAction = -1;
  private readonly config: Required<SessionSummarizerConfig>;

  constructor(
    private readonly runtime: ModelRuntime,
    config: SessionSummarizerConfig = {},
    private readonly gate?: ModelBudgetGate,
    private readonly sink?: ModelCallSink,
    private readonly attribution?: ModelAttribution,
  ) {
    this.config = { ...DEFAULTS, ...config };
  }

  get lastRefreshAtAction(): number {
    return this.cachedAtAction;
  }

  /**
   * Return the current digest (refreshing on interval when due) or null when
   * summarization is unavailable — never throw, never block determinism.
   */
  async digest(
    input: SessionDigestInput,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (
      this.cachedDigest !== null &&
      input.actionsExecuted - this.cachedAtAction < this.config.refreshIntervalActions
    ) {
      return this.cachedDigest;
    }
    const packet = {
      schema: SESSION_DIGEST_SCHEMA,
      counters: {
        actionsExecuted: input.actionsExecuted,
        statesVisited: input.statesVisited,
      },
      recentActions: input.recentActionKeys.slice(-20),
      anomalies: input.anomalies.slice(-5),
      rejectedSuggestions: input.rejectedSuggestions.slice(-10),
      ...(input.failedHypotheses !== undefined ? { failedHypotheses: input.failedHypotheses.slice(-8) } : {}),
    };
    try {
      const result = await this.runtime.invoke(
        {
          role: "summarizer",
          requestClass: "session-digest",
          prompt: [
            "Compress the exploration session data below into a short digest.",
            'Respond with ONLY: {"summary": string <=1200 chars, "openQuestions": string[] <=8}.',
            "The digest is advisory context for a later planning step.",
            "",
            `DATA BLOCK: ${JSON.stringify(packet)}`,
          ].join("\n"),
          format: {
            kind: "json",
            schemaId: SESSION_DIGEST_SCHEMA,
            validate: (value) => (validateDigest(value) ? { ok: true as const } : { ok: false as const, detail: "digest must be {summary<=1200, openQuestions?<=8}" }),
          },
          deadlineMs: this.config.timeoutMs,
          ...(this.attribution !== undefined ? { attribution: this.attribution } : {}),
        },
        {
          signal,
          gate: this.gate,
          sink: this.sink,
        },
      );
      if (!result.ok || !result.json || !validateDigest(result.json)) {
        // Any failure leaves the previous cache intact; null when none.
        return this.cachedDigest;
      }
      const digestJson = result.json as DigestJson;
      this.cachedDigest = [
        digestJson.summary.slice(0, 1200),
        ...(digestJson.openQuestions ?? []).slice(0, 8).map((q) => `open question: ${q.slice(0, 200)}`),
      ].join("\n");
      this.cachedAtAction = input.actionsExecuted;
      return this.cachedDigest;
    } catch {
      // Summarization must never destabilize deterministic exploration.
      return this.cachedDigest;
    }
  }

  /** Restore a persisted digest verbatim (checkpoint continuity). */
  restore(digest: string | null, atAction: number): void {
    if (digest === null) {
      this.cachedDigest = null;
      this.cachedAtAction = -1;
      return;
    }
    this.cachedDigest = digest;
    this.cachedAtAction = Math.max(0, Math.floor(atAction));
  }

  snapshot(): { digest: string | null; atAction: number } {
    return { digest: this.cachedDigest, atAction: this.cachedAtAction };
  }
}
