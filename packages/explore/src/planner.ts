import type { CandidateAction } from "./inventory.js";
import type { UiElement } from "./state.js";

export interface PlannerContext {
 screen: string;
 uiTree: UiElement[];
 recentActionKeys: string[];
 discoveredKinds: string[];
}

/**
 * Planner fallback (M3 E5). A planner may *suggest* a goal/action when
 * deterministic exploration stalls, but every suggestion must resolve to a
 * member of the legal action inventory before execution, and still passes
 * policy/validation. This guarantees a planner can never bypass the allowed
 * action inventory.
 */
export interface Planner {
 propose(ctx: PlannerContext): CandidateAction | null;
}

export class NoopPlanner implements Planner {
 propose(_ctx?: PlannerContext): CandidateAction | null {
  return null;
 }
}

/**
 * Inventory-bound planner stub. It can only propose actions that already exist
 * in the legal inventory, demonstrating the "planner cannot bypass allowed
 * action inventory" invariant. A real LLM planner would populate this from a
 * model response, but the same validation applies.
 */
export class InventoryBoundPlanner implements Planner {
 constructor(
  private readonly inventoryProvider: () => CandidateAction[],
  private readonly rng: () => number,
 ) {}

 propose(_ctx?: PlannerContext): CandidateAction | null {
  const inventory = this.inventoryProvider();
  if (inventory.length === 0) return null;
  const i = Math.floor(this.rng() * inventory.length);
  return inventory[i] ?? null;
 }
}
