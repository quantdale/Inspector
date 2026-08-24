/**
 * Cooperative execution control threaded into exploration loops
 * (HARDENING_2 D1/D3).
 *
 * Campaign executors supply this hook so long-running hunts/explores obtain
 * budget permission BEFORE consuming budgeted resources, record actual
 * consumption as it happens, and observe cooperative cancellation at safe
 * boundaries — instead of executors discovering overruns after the fact.
 *
 * Semantics:
 * - `stopRequested()` becomes true when the operator, SIGINT, or the campaign
 *   wall clock asked the item to stop cooperatively.
 * - `admit(kind)` is a projection-only permission check; a `false` return
 *   means the budget cannot cover one more unit and the loop must stop with
 *   a structured `budget-exhausted` outcome BEFORE starting the unit.
 * - `commit(kind)` records one actually-executed unit. Policy-rejected or
 *   failed submissions consumed nothing and must NOT be committed. A `false`
   * return (a concurrent worker spent the last allowance mid-flight) stops
 *   the loop immediately; the overshoot is bounded by the worker count.
 */
export interface ExplorationControl {
  stopRequested(): boolean;
  admit(kind: "action" | "reset"): boolean;
  commit(kind: "action" | "reset"): boolean;
}
