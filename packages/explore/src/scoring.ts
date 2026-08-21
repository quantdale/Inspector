import type { CandidateAction } from "./inventory.js";
import type { StateGraph } from "./state.js";

export interface ScoringWeights {
 novelty: number;
 unvisitedEdge: number;
 boundary: number;
 rarity: number;
 cyclePenalty: number;
 riskPenalty: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
 novelty: 1.0,
 unvisitedEdge: 0.8,
 boundary: 0.6,
 rarity: 0.5,
 cyclePenalty: 1.2,
 riskPenalty: 0.2,
};

export interface ScoringContext {
 graph: StateGraph;
 currentState: string;
 currentScreen: string;
 recentActionKeys: string[];
 totalActions: number;
 weights?: Partial<ScoringWeights>;
}

/**
 * Curiosity-driven action scoring. Higher is better. Combines:
 *  - novelty (untried actions),
 *  - unvisited state/action edges,
 *  - boundary-value opportunity,
 *  - screen rarity,
 *  - cycle penalty (recent repeats are suppressed),
 *  - mild risk penalty for state-mutating actions.
 */
export function scoreAction(c: CandidateAction, ctx: ScoringContext): number {
 const w = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
 let s = 0;

 const edgeTried = ctx.graph.edgeCount(ctx.currentState, c.actionKey) > 0;
 // Novelty and unvisited-edge are the same predicate; weight them once.
 s += (w.novelty + w.unvisitedEdge) * (edgeTried ? 0 : 1);
 s += w.boundary * (c.isBoundary ? 1 : 0);

 const screenVisits = ctx.graph.screenCounts.get(ctx.currentScreen) ?? 0;
 s += w.rarity * (screenVisits <= 1 ? 1 : 0);

 const recentRepeats = ctx.recentActionKeys.filter(
  (k) => k === c.actionKey,
 ).length;
 s -= w.cyclePenalty * Math.min(recentRepeats, 3);

 s -= w.riskPenalty * (c.risk === "mutate-test-state" ? 1 : 0);
 s += c.priority * 0.05;

 return s;
}
