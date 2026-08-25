import type {
  ModelAttribution,
  ModelBudgetGate,
  ModelCallRecord,
  ModelCallSink,
  ModelProvider,
} from "@inspector/model-runtime";
import { ModelRuntime } from "@inspector/model-runtime";
import { ReservationModelBudgetGate } from "@inspector/scale";
import type { Store } from "@inspector/store-sqlite";
import type { SemanticPlannerConfig } from "@inspector/explore";

/**
 * Optional model-assistance wiring shared by CLI commands and campaign
 * executors (M13 F13/F15/F16). One construction path, one sink contract, one
 * budget gate — no duplicated runtime assembly per caller.
 */

export interface ModelAssistanceConfig {
  providers: ModelProvider[];
  /** Standalone (CLI) ceilings; campaign executions use ctx-bound gates. */
  budgets?: { maxRequests?: number; maxTokens?: number; maxCostUsd?: number };
  timeoutMs?: number;
  maxCallsPerRun?: number;
  planner?: boolean;
  semanticOracle?: boolean;
  summarize?: boolean;
}

export interface ModelSupportContext {
  stateDir?: string;
  gate?: ModelBudgetGate;
  sink?: ModelCallSink;
  attribution?: ModelAttribution;
}

/** Durable sink over a workspace store: started rows before inference,
 * terminal rows after; persistence failures never crash exploration. */
export class StoreModelCallSink implements ModelCallSink {
  constructor(private readonly store: Store) {}
  start(record: ModelCallRecord): void {
    try {
      this.store.putModelCall(record);
    } catch {
      /* observability is best-effort at the loop boundary */
    }
  }
  finish(record: ModelCallRecord): void {
    try {
      this.store.putModelCall(record);
    } catch {
      /* see start */
    }
  }
}

export interface ResolvedModelSupport {
  runtime: ModelRuntime;
  providers: ModelProvider[];
  gate?: ModelBudgetGate;
  sink: ModelCallSink;
  attribution?: ModelAttribution;
  plannerConfig?: SemanticPlannerConfig & { maxCalls?: number };
  summarize: boolean;
  semanticOracle: boolean;
  /** Standalone durable totals when a state-dir-backed gate was created. */
  standaloneTotals?(): { requests: number; tokens: number; costUsd: number; activeReservations: number } | undefined;
}

export function resolveModelSupport(
  cfg: ModelAssistanceConfig,
  ctx: ModelSupportContext = {},
): ResolvedModelSupport {
  const runtime = new ModelRuntime();
  for (const provider of cfg.providers) runtime.register(provider);
  let gate = ctx.gate;
  let standalone: ReservationModelBudgetGate | undefined;
  if (gate === undefined && ctx.stateDir !== undefined && cfg.budgets) {
    standalone = new ReservationModelBudgetGate(ctx.stateDir, {
      global: {
        ...(cfg.budgets.maxRequests !== undefined ? { maxModelRequests: cfg.budgets.maxRequests } : {}),
        ...(cfg.budgets.maxTokens !== undefined ? { maxTokens: cfg.budgets.maxTokens } : {}),
        ...(cfg.budgets.maxCostUsd !== undefined ? { maxCostUsd: cfg.budgets.maxCostUsd } : {}),
      },
    });
    gate = standalone;
  }
  return {
    runtime,
    providers: cfg.providers.slice(),
    ...(gate !== undefined ? { gate } : {}),
    sink: ctx.sink ?? { start() {}, finish() {} },
    ...(ctx.attribution !== undefined ? { attribution: ctx.attribution } : {}),
    ...((cfg.planner === true || cfg.timeoutMs !== undefined || cfg.maxCallsPerRun !== undefined)
      ? {
          plannerConfig: {
            ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
            ...(cfg.maxCallsPerRun !== undefined ? { maxCalls: cfg.maxCallsPerRun } : {}),
          },
        }
      : {}),
    summarize: cfg.summarize === true,
    semanticOracle: cfg.semanticOracle === true,
    ...(standalone
      ? {
          standaloneTotals: () => {
            const t = standalone!.totals();
            return { requests: t.requests, tokens: t.tokens, costUsd: t.costUsd, activeReservations: t.activeReservations };
          },
        }
      : {}),
  };
}
