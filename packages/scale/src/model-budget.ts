import type {
  ModelBudgetAdmission,
  ModelBudgetGate,
  ModelBudgetSettlement,
} from "@inspector/model-runtime";
import type { Budget } from "./types.js";
import { StateFile } from "./state-file.js";

/**
 * Durable reservation-based model budget gate (M13 F4/F5, ADR-0013 s4).
 *
 * HARDENING_2 established that budget permission precedes consumption. Model
 * calls strain the simple admit/charge pattern because final token/cost usage
 * is unknown until a provider responds — and a response may already be spent
 * when Inspector dies before recording it. This gate therefore holds an
 * explicit bounded RESERVATION for the duration of every attempt:
 *
 *   admit(): atomically reserve an estimate (or configured default bound)
 *            against global/worker/item ceilings, projected over settled
 *            usage PLUS every active reservation — concurrent workers cannot
 *            collectively oversubscribe a shared ceiling.
 *   settle(): replace the reservation with actuals when known (including
 *            honest overage); convert it to CONSUMED truth when unknown —
 *            deadline/cancel/crash windows never silently refund a possibly
 *            charged call.
 *
 * Abandoned reservations (controller death between admit and settle) are
 * reconciled conservatively on construction and before every admission: past
 * a TTL they become settled consumption at their reserved bound. Reservations
 * are idempotent by attemptId. State is cross-process serialized through the
 * same StateFile lock as the resource ledger, and semantically impossible
 * durable state fails closed (HARDENING_2 D9 pattern).
 */

export interface ModelReservationRecord {
  requestId: string;
  attemptId: string;
  role: string;
  requestClass: string;
  workerId?: string;
  itemId?: string;
  requests: number;
  tokens: number;
  costUsd: number;
  /** Wall-clock creation stamp used for conservative TTL reconciliation. */
  atMs: number;
}

export interface ConsumptionTotals {
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface ModelBudgetState {
  schemaVersion: 1;
  /** Settled consumption truth (all scopes). */
  settled: ConsumptionTotals;
  /** Settled consumption attributable per worker / per item. */
  byWorker: Record<string, ConsumptionTotals>;
  byItem: Record<string, ConsumptionTotals>;
  /** Active holds between admit and settle. */
  reservations: ModelReservationRecord[];
}

export interface ModelBudgetGateOptions {
  global?: Budget;
  worker?: Record<string, Budget>;
  item?: Record<string, Budget>;
  /**
   * Conservative reservation defaults applied when neither the request nor
   * the provider supplies an estimate. A cost-bounded gate WITHOUT any way to
   * estimate refuses cost-bounded admission instead of pretending the bound
   * is enforceable.
   */
  defaultReserveTokens?: number;
  defaultReserveCostUsd?: number;
  /** Age after which an unsettled reservation is treated as consumed. */
  reservationTtlMs?: number;
  now?: () => number;
}

export const DEFAULT_RESERVE_TOKENS = 4096;
export const DEFAULT_RESERVATION_TTL_MS = 10 * 60_000;

function emptyState(): ModelBudgetState {
  return {
    schemaVersion: 1,
    settled: emptyTotals(),
    byWorker: {},
    byItem: {},
    reservations: [],
  };
}

function emptyTotals(): ConsumptionTotals {
  return { requests: 0, tokens: 0, costUsd: 0 };
}

/** Fail-closed semantic validation (HARDENING_2 D9 pattern): syntactically
 * valid JSON with impossible values must corrupt-stop, not silently reset. */
export function validateModelBudgetState(raw: unknown): ModelBudgetState {
  if (typeof raw !== "object" || raw === null) throw new TypeError("model-budget state must be an object");
  const state = raw as Record<string, unknown>;
  if (state.schemaVersion !== 1) throw new TypeError("unsupported model-budget schemaVersion");
  validateTotals(state.settled, "settled");
  if (!Array.isArray(state.reservations)) throw new TypeError("model-budget reservations must be an array");
  for (const entry of state.reservations) {
    const r = entry as Record<string, unknown>;
    if (typeof r.requestId !== "string" || typeof r.attemptId !== "string") {
      throw new TypeError("model-budget reservation requires ids");
    }
    if (
      !finiteNonNegative(r.requests) ||
      !finiteNonNegative(r.tokens) ||
      typeof r.costUsd !== "number" ||
      r.costUsd < 0
    ) {
      throw new TypeError("model-budget reservation amounts are impossible");
    }
    if (typeof r.atMs !== "number" || !Number.isFinite(r.atMs)) {
      throw new TypeError("model-budget reservation timestamp is impossible");
    }
  }
  const buckets = [
    ["byWorker", state.byWorker],
    ["byItem", state.byItem],
  ] as const;
  for (const [name, bucket] of buckets) {
    if (bucket === undefined || bucket === null) continue;
    if (typeof bucket !== "object" || Array.isArray(bucket)) {
      throw new TypeError(`model-budget ${name} must be an object`);
    }
    for (const totals of Object.values(bucket as Record<string, unknown>)) {
      validateTotals(totals, name);
    }
  }
  return raw as unknown as ModelBudgetState;
}

function validateTotals(value: unknown, what: string): void {
  const t = value as Record<string, unknown> | undefined;
  if (
    !t ||
    !finiteNonNegative(t.requests) ||
    !finiteNonNegative(t.tokens) ||
    typeof t.costUsd !== "number" ||
    !Number.isFinite(t.costUsd) ||
    t.costUsd < 0
  ) {
    throw new TypeError(`model-budget ${what} totals are missing or impossible`);
  }
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export class ReservationModelBudgetGate implements ModelBudgetGate {
  private readonly file: StateFile<ModelBudgetState>;
  private readonly opts: Required<Pick<ModelBudgetGateOptions, "defaultReserveTokens" | "reservationTtlMs">> &
    Pick<ModelBudgetGateOptions, "global" | "worker" | "item" | "defaultReserveCostUsd">;
  private readonly now: () => number;

  constructor(stateDir: string, options: ModelBudgetGateOptions = {}) {
    this.opts = {
      ...(options.global !== undefined ? { global: options.global } : {}),
      ...(options.worker !== undefined ? { worker: options.worker } : {}),
      ...(options.item !== undefined ? { item: options.item } : {}),
      defaultReserveTokens: options.defaultReserveTokens ?? DEFAULT_RESERVE_TOKENS,
      ...(options.defaultReserveCostUsd !== undefined
        ? { defaultReserveCostUsd: options.defaultReserveCostUsd }
        : {}),
      reservationTtlMs: options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS,
    };
    this.now = options.now ?? (() => Date.now());
    this.file = new StateFile(stateDir, "model-budget", emptyState, validateModelBudgetState);
    // Fail loud on corrupt durable state, then reconcile abandoned holds from
    // earlier lives into consumed truth BEFORE anything else can run.
    this.file.load();
    this.reconcileAbandoned();
  }

  get isCostBounded(): boolean {
    return (
      this.opts.global?.maxCostUsd !== undefined ||
      Object.values(this.opts.worker ?? {}).some((b) => b.maxCostUsd !== undefined) ||
      Object.values(this.opts.item ?? {}).some((b) => b.maxCostUsd !== undefined)
    );
  }

  admit(admission: ModelBudgetAdmission): boolean {
    return this.file.update((state) => {
      this.reconcileStaleInPlace(state);
      const tokens =
        admission.estimateTokens !== undefined && admission.estimateTokens > 0
          ? Math.ceil(admission.estimateTokens)
          : this.opts.defaultReserveTokens;
      let cost = admission.estimateCostUsd ?? this.opts.defaultReserveCostUsd;
      if (cost === undefined) {
        if (this.isCostBounded) {
          // No truthful way to reserve against a cost ceiling: refuse rather
          // than pretend the bound is enforceable (SPEC-013 F4).
          return false;
        }
        cost = 0;
      }
      if (state.reservations.some((r) => r.attemptId === admission.attemptId)) {
        return true; // idempotent re-admission of the same attempt
      }
      const hold: ConsumptionTotals = { requests: 1, tokens, costUsd: cost };
      const active = sumReservations(state.reservations);
      const scopes: Array<{ bounds?: Budget; subset: ConsumptionTotals }> = [
        { bounds: this.opts.global, subset: add(active, state.settled) },
      ];
      if (admission.workerId !== undefined && this.opts.worker?.[admission.workerId]) {
        scopes.push({
          bounds: this.opts.worker[admission.workerId],
          subset: add(
            sumReservations(state.reservations.filter((r) => r.workerId === admission.workerId)),
            state.byWorker[admission.workerId] ?? emptyTotals(),
          ),
        });
      }
      if (admission.itemId !== undefined && this.opts.item?.[admission.itemId]) {
        scopes.push({
          bounds: this.opts.item[admission.itemId],
          subset: add(
            sumReservations(state.reservations.filter((r) => r.itemId === admission.itemId)),
            state.byItem[admission.itemId] ?? emptyTotals(),
          ),
        });
      }
      for (const scope of scopes) {
        if (!scope.bounds) continue;
        const projected = add(scope.subset, hold);
        if (scope.bounds.maxModelRequests !== undefined && projected.requests > scope.bounds.maxModelRequests) {
          return false;
        }
        if (scope.bounds.maxTokens !== undefined && projected.tokens > scope.bounds.maxTokens) {
          return false;
        }
        if (scope.bounds.maxCostUsd !== undefined && projected.costUsd > scope.bounds.maxCostUsd + 1e-9) {
          return false;
        }
      }
      state.reservations.push({
        requestId: admission.requestId,
        attemptId: admission.attemptId,
        role: admission.role,
        requestClass: admission.requestClass,
        ...(admission.workerId !== undefined ? { workerId: admission.workerId } : {}),
        ...(admission.itemId !== undefined ? { itemId: admission.itemId } : {}),
        ...hold,
        atMs: this.now(),
      });
      return true;
    });
  }

  settle(settlement: ModelBudgetSettlement): void {
    this.file.update((state) => {
      this.reconcileStaleInPlace(state);
      const index = state.reservations.findIndex((r) => r.attemptId === settlement.attemptId);
      if (index === -1) return; // unknown/idempotent settle: nothing held
      const reservation = state.reservations[index]!;
      state.reservations.splice(index, 1);
      const actual = actualUsage(settlement.usage);
      const charged: ConsumptionTotals = actual
        ? // Truthful reconciliation — including honest overage beyond the
          // reserved bound, which the next projection will see.
          { requests: 1, tokens: actual.tokens, costUsd: actual.costUsd }
        : // Unknown outcome (deadline/cancel/crash/no-provider-usage): the
          // hold was possibly consumed. Conservative conversion, never a
          // silent refund.
          { requests: reservation.requests, tokens: reservation.tokens, costUsd: reservation.costUsd };
      state.settled = add(state.settled, charged);
      if (reservation.workerId) {
        state.byWorker[reservation.workerId] = add(state.byWorker[reservation.workerId] ?? emptyTotals(), charged);
      }
      if (reservation.itemId) {
        state.byItem[reservation.itemId] = add(state.byItem[reservation.itemId] ?? emptyTotals(), charged);
      }
    });
  }

  /** Settled truth plus live holds — what observability should report. */
  totals(): ConsumptionTotals & { activeReservations: number } {
    const state = this.file.load();
    const active = sumReservations(state.reservations);
    return { ...add(active, state.settled), activeReservations: state.reservations.length };
  }

  /** Crash-window reconciliation; returns the number of holds converted. */
  reconcileAbandoned(): number {
    return this.file.update((state) => this.reconcileStaleInPlace(state));
  }

  private reconcileStaleInPlace(state: ModelBudgetState): number {
    const cutoff = this.now() - this.opts.reservationTtlMs;
    const fresh: ModelReservationRecord[] = [];
    let converted = 0;
    for (const reservation of state.reservations) {
      if (reservation.atMs <= cutoff) {
        const charged: ConsumptionTotals = {
          requests: reservation.requests,
          tokens: reservation.tokens,
          costUsd: reservation.costUsd,
        };
        state.settled = add(state.settled, charged);
        if (reservation.workerId) {
          state.byWorker[reservation.workerId] = add(state.byWorker[reservation.workerId] ?? emptyTotals(), charged);
        }
        if (reservation.itemId) {
          state.byItem[reservation.itemId] = add(state.byItem[reservation.itemId] ?? emptyTotals(), charged);
        }
        converted += 1;
      } else {
        fresh.push(reservation);
      }
    }
    state.reservations = fresh;
    return converted;
  }
}

function actualUsage(
  usage?: { inputTokens?: number; outputTokens?: number; totalChargedTokens?: number; costUsd?: number },
): { tokens: number; costUsd: number } | null {
  if (!usage) return null;
  const tokens =
    usage.totalChargedTokens !== undefined
      ? usage.totalChargedTokens
      : usage.inputTokens !== undefined || usage.outputTokens !== undefined
        ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        : undefined;
  if (tokens === undefined && usage.costUsd === undefined) return null;
  return { tokens: tokens ?? 0, costUsd: usage.costUsd ?? 0 };
}

function sumReservations(reservations: ModelReservationRecord[]): ConsumptionTotals {
  const t = emptyTotals();
  for (const r of reservations) {
    t.requests += r.requests;
    t.tokens += r.tokens;
    t.costUsd += r.costUsd;
  }
  return t;
}

function add(a: ConsumptionTotals, b: ConsumptionTotals): ConsumptionTotals {
  return { requests: a.requests + b.requests, tokens: a.tokens + b.tokens, costUsd: a.costUsd + b.costUsd };
}
