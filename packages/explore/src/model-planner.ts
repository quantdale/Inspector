import type {
  ModelAttribution,
  ModelBudgetGate,
  ModelCallSink,
  ModelFailureClass,
  ModelRuntime,
} from "@inspector/model-runtime";
import {
  assembleModelPrompt,
  buildPlannerPacket,
  enforcePacketCeiling,
  serializePacket,
} from "./model-context.js";
import type { CandidateAction } from "./inventory.js";

export const PLANNER_SUGGESTION_SCHEMA = "inspector-planner-suggestion/1";

/** Activation/cadence/bound configuration (M13 F7). Defaults keep the
 * planner a bounded adviser: it is consulted on ambiguity or stall, never on
 * every action. */
export interface SemanticPlannerConfig {
  /** Minimum actions between planner calls (hard cadence floor). Default 6. */
  minActionsBetweenCalls?: number;
  /** Stall trigger: actions since the last new state at/above this value. Default 8. */
  stallThreshold?: number;
  /** Ambiguity trigger: at least N equally-scored top candidates. Default 4. */
  nearTieCount?: number;
  /** Suggestions below this confidence fall back deterministically. Default 0.5. */
  confidenceThreshold?: number;
  /** Absolute cap of planner invocations per exploration run. Default 24. */
  maxCalls?: number;
  /** Per-call deadline in ms. Default 8000. */
  timeoutMs?: number;
}

const DEFAULTS: Required<SemanticPlannerConfig> = {
  minActionsBetweenCalls: 6,
  stallThreshold: 8,
  nearTieCount: 4,
  confidenceThreshold: 0.5,
  maxCalls: 24,
  timeoutMs: 8000,
};

/** Pure activation policy — a function of counters only, so it is testable
 * and checkpoint-restorable without touching the RNG. */
export function shouldInvokePlanner(
  state: {
    actionsSincePlannerCall: number;
    actionsSinceNewState: number;
    topCandidateCount: number;
    plannerCallsTotal: number;
  },
  config: SemanticPlannerConfig = {},
): boolean {
  const c = { ...DEFAULTS, ...config };
  if (state.plannerCallsTotal >= c.maxCalls) return false;
  if (state.actionsSincePlannerCall < c.minActionsBetweenCalls) return false;
  return state.actionsSinceNewState >= c.stallThreshold || state.topCandidateCount >= c.nearTieCount;
}

export interface SemanticPlannerRequest {
  objective?: string;
  stateFingerprint: string;
  screenSummary: string;
  /** The EXACT usable legal inventory with deterministic scores attached. */
  usableCandidates: Array<CandidateAction & { score: number }>;
  nearbyStates?: Array<{ stateId: string; visitCount: number }>;
  recentActionKeys?: string[];
  recentFailures?: Array<{ actionKey: string; reason: string }>;
  anomalyHints?: string[];
  rejectedSuggestions?: string[];
  capabilities?: string[];
  budgetsRemaining?: { actions: number; resets: number };
  actionsSinceNewState?: number;
  signal?: AbortSignal;
}

export interface SemanticPlannerDecision {
  accepted: boolean;
  actionKey?: string;
  reason: string;
  classification?:
    | ModelFailureClass
    | "low-confidence"
    | "unknown-action"
    | "blocked-action";
}

export interface SemanticPlannerDeps {
  runtime: ModelRuntime;
  gate?: ModelBudgetGate;
  sink?: ModelCallSink;
  config?: SemanticPlannerConfig;
  attribution?: ModelAttribution;
  instruction?: string;
}

/**
 * Goal-directed model-assisted exploration adviser (M13 F7).
 *
 * Central invariant: the model may select ONLY from the candidate action ids
 * Inspector offered in the packet. Every response is schema-validated, then
 * matched against the exact usable inventory passed by the caller; anything
 * else is a recorded rejection and the caller falls back to deterministic
 * selection. The planner NEVER touches the exploration RNG and never becomes
 * the sole executor.
 */
export class SemanticPlanner {
  readonly calls = { total: 0, accepted: 0, rejected: 0 };
  private readonly config: Required<SemanticPlannerConfig>;

  constructor(private readonly deps: SemanticPlannerDeps) {
    this.config = { ...DEFAULTS, ...deps.config };
  }

  get conf(): Readonly<Required<SemanticPlannerConfig>> {
    return this.config;
  }

  async suggest(request: SemanticPlannerRequest): Promise<SemanticPlannerDecision> {
    const { packet } = buildPlannerPacket({
      objective: request.objective,
      stateFingerprint: request.stateFingerprint,
      screenSummary: request.screenSummary,
      candidates: request.usableCandidates.map((c) => ({
        actionKey: c.actionKey,
        kind: c.kind,
        risk: c.risk,
        score: c.score,
      })),
      nearbyStates: request.nearbyStates,
      recentActionKeys: request.recentActionKeys,
      recentFailures: request.recentFailures,
      anomalyHints: request.anomalyHints,
      rejectedSuggestions: request.rejectedSuggestions,
      capabilities: request.capabilities,
      budgetsRemaining: request.budgetsRemaining,
      actionsSinceNewState: request.actionsSinceNewState,
    });
    const ceiling = enforcePacketCeiling(packet, [
      "candidateActions",
      "recentActions",
      "nearbyStates",
      "anomalyHints",
      "rejectedSuggestions",
    ], 24 * 1024, ["deterministicScores"]);
    const prompt = assembleModelPrompt(
      this.deps.instruction ??
        [
          "You are the exploration planner inside Inspector, an autonomous QA engine.",
          `Choose exactly ONE next action from packet.candidateActions and respond with ONLY a JSON object:`,
          `{"actionKey": string (must equal one packet.candidateActions[].actionKey),`,
          ` "goal": string (<=200 chars), "rationale": string (<=300 chars), "confidence": number 0..1}`,
          "Never invent action keys, selectors, commands, URLs, or tools outside that list.",
          "Prefer actions likely to reveal behavior consistent with the objective.",
        ].join("\n"),
      serializePacket(ceiling.packet),
    );
    this.calls.total += 1;
    const result = await this.deps.runtime.invoke(
      {
        role: "planner",
        requestClass: "exploration-planner",
        prompt,
        format: {
          kind: "json",
          schemaId: PLANNER_SUGGESTION_SCHEMA,
          validate: validateSuggestionJson,
        },
        deadlineMs: this.config.timeoutMs,
        ...(this.deps.attribution ? { attribution: this.deps.attribution } : {}),
        metadata: {
          candidatesOffered: packet.candidateActions.length,
          packetTruncated: ceiling.shrunk,
        },
      },
      {
        signal: request.signal,
        gate: this.deps.gate,
        sink: this.deps.sink,
      },
    );
    if (!result.ok) {
      this.calls.rejected += 1;
      return {
        accepted: false,
        classification: result.failure?.classification ?? "provider-error",
        reason: result.failure?.detail ?? "planner invocation failed",
      };
    }
    const parsed = result.json as SuggestionJson | undefined;
    if (!parsed) {
      this.calls.rejected += 1;
      return { accepted: false, classification: "schema-invalid", reason: "planner response missing validated JSON" };
    }
    // Inventory containment: the suggested key must be an EXACT member of the
    // usable legal inventory offered in this same call.
    const match = request.usableCandidates.find((c) => c.actionKey === parsed.actionKey);
    if (!match) {
      this.calls.rejected += 1;
      return {
        accepted: false,
        classification: "unknown-action",
        reason: `suggested action '${parsed.actionKey}' is not in the current legal inventory; ignored`,
      };
    }
    if ((parsed.confidence ?? 0) < this.config.confidenceThreshold) {
      this.calls.rejected += 1;
      return {
        accepted: false,
        classification: "low-confidence",
        reason: `suggestion confidence ${String(parsed.confidence)} below threshold ${String(this.config.confidenceThreshold)}`,
      };
    }
    this.calls.accepted += 1;
    return {
      accepted: true,
      actionKey: match.actionKey,
      reason: typeof parsed.rationale === "string" && parsed.rationale.length > 0
        ? parsed.rationale.slice(0, 300)
        : "accepted planner suggestion",
    };
  }
}

interface SuggestionJson {
  actionKey: string;
  goal?: string;
  rationale?: string;
  confidence?: number;
}

/** Strict runtime validation of externally supplied model output. */
function validateSuggestionJson(value: unknown): { ok: true } | { ok: false; detail: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, detail: "suggestion must be a JSON object" };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.actionKey !== "string" || v.actionKey.length === 0 || v.actionKey.length > 200) {
    return { ok: false, detail: "actionKey must be a non-empty string (<=200 chars)" };
  }
  for (const key of ["goal", "rationale"] as const) {
    if (v[key] !== undefined && (typeof v[key] !== "string" || String(v[key]).length > 400)) {
      return { ok: false, detail: `${key} must be a string <=400 chars` };
    }
  }
  if (
    v.confidence !== undefined &&
    (typeof v.confidence !== "number" || !Number.isFinite(v.confidence) || v.confidence < 0 || v.confidence > 1)
  ) {
    return { ok: false, detail: "confidence must be a finite number in [0,1]" };
  }
  return { ok: true };
}
