import type { Budget, UsageEntry } from "./types.js";
import { StateFile } from "./state-file.js";
import { validateLedgerState } from "./state-validation.js";

interface LedgerState {
  entries: UsageEntry[];
  stopped: boolean;
}

const NUMERIC_FIELDS = [
  "modelRequests",
  "tokens",
  "costUsd",
  "actions",
  "resets",
  "artifactBytes",
] as const;

/**
 * Resource ledger (M7 S3). Tracks model requests/tokens/cost, actions,
 * resets, and artifact bytes per worker and globally. Budget checks are
 * deterministic: a charge is admitted iff the resulting total stays within
 * every configured bound.
 *
 * Hardening: charges run inside the state file's cross-process lock with a
 * fresh disk read, so two ledger instances cannot both spend one budget;
 * malformed usage amounts (negative or non-finite) are rejected loudly.
 */
export class ResourceLedger {
  private readonly file: StateFile<LedgerState>;

  constructor(
    stateDir: string,
    private readonly globalBudget: Budget = {},
    private readonly workerBudgets: Record<string, Budget> = {},
  ) {
    this.file = new StateFile(stateDir, "ledger", () => ({ entries: [], stopped: false }), (raw) =>
      validateLedgerState(raw),
    );
    // Fail loud at construction if durable state is corrupt.
    this.file.load();
  }

  /**
   * Attempt to charge usage; returns false when a budget would be exceeded.
   * Pass `allowWhenStopped` for work that already consumed resources while a
   * stop was racing it — the usage is real and must be accounted, and the
   * caller distinguishes stop-from-budget through other means.
   *
   * `itemBudget` (HARDENING_2 D14) enforces per-item ceilings atomically in
   * the same serialized critical section, so concurrent workers cannot
   * oversubscribe one item's declared budget.
   */
  charge(
    entry: UsageEntry,
    options: { allowWhenStopped?: boolean; itemBudget?: Budget & { maxResets?: number } } = {},
  ): boolean {
    assertValidUsage(entry);
    return this.file.update((state) => {
      if (state.stopped && !options.allowWhenStopped) return false;
      if (!this.project(this.add(this.sumOf(state.entries), entry), this.globalBudget).ok) {
        return false;
      }
      const wb = entry.workerId ? this.workerBudgets[entry.workerId] : undefined;
      if (wb && !this.project(this.add(this.sumOf(state.entries.filter((e) => e.workerId === entry.workerId)), entry), wb).ok) {
        return false;
      }
      if (options.itemBudget && !this.project(this.add(this.sumOf(state.entries.filter((e) => e.itemId === entry.itemId)), entry), options.itemBudget).ok) {
        return false;
      }
      state.entries.push(entry);
      return true;
    });
  }

  /**
   * Permission check WITHOUT accounting (HARDENING_2 D1): would this usage be
   * admitted right now against global/worker/item bounds? Used to obtain
   * budget permission BEFORE budgeted resources are consumed;
   * {@link charge} remains the authoritative recording step and re-enforces
   * every bound inside the lock.
   */
  wouldAdmit(
    entry: UsageEntry,
    options: { itemBudget?: Budget & { maxResets?: number } } = {},
  ): boolean {
    assertValidUsage(entry);
    return this.file.update((state) => {
      if (state.stopped) return false;
      if (!this.project(this.add(this.sumOf(state.entries), entry), this.globalBudget).ok) return false;
      const wb = entry.workerId ? this.workerBudgets[entry.workerId] : undefined;
      if (wb && !this.project(this.add(this.sumOf(state.entries.filter((e) => e.workerId === entry.workerId)), entry), wb).ok) {
        return false;
      }
      if (options.itemBudget && !this.project(this.add(this.sumOf(state.entries.filter((e) => e.itemId === entry.itemId)), entry), options.itemBudget).ok) {
        return false;
      }
      return true;
    });
  }

  totals(filter?: { workerId?: string; itemId?: string }): Required<Pick<UsageEntry, "modelRequests" | "tokens" | "costUsd" | "actions" | "resets" | "artifactBytes">> {
    const entries = this.file.load().entries;
    return this.sumOf(this.filterEntries(entries, filter));
  }

  /**
   * Projection-only budget check (HARDENING_2 D1): would this charge be
   * admitted against the configured global/worker bounds WITHOUT recording
   * it? Used to obtain permission BEFORE budgeted resources are consumed;
   * {@link charge} remains the authoritative accounting step.
   */
  wouldAdmitGlobal(entry: UsageEntry): boolean {
    return this.wouldAdmit(entry);
  }

  stop(): void {
    this.file.update((state) => {
      state.stopped = true;
    });
  }

  /** Operator path: clear a durable stop so a restarted campaign can charge again. */
  resume(): void {
    this.file.update((state) => {
      state.stopped = false;
    });
  }

  get isStopped(): boolean {
    return this.file.load().stopped;
  }

  private filterEntries(entries: UsageEntry[], filter?: { workerId?: string; itemId?: string }): UsageEntry[] {
    let out = entries;
    if (filter?.workerId) out = out.filter((e) => e.workerId === filter.workerId);
    if (filter?.itemId) out = out.filter((e) => e.itemId === filter.itemId);
    return out;
  }

  private sumOf(entries: UsageEntry[]) {
    const t = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 0, resets: 0, artifactBytes: 0 };
    for (const e of entries) {
      t.modelRequests += e.modelRequests ?? 0;
      t.tokens += e.tokens ?? 0;
      t.costUsd += e.costUsd ?? 0;
      t.actions += e.actions ?? 0;
      t.resets += e.resets ?? 0;
      t.artifactBytes += e.artifactBytes ?? 0;
    }
    return t;
  }

  private add(a: ReturnType<ResourceLedger["totals"]>, e: UsageEntry) {
    return {
      modelRequests: a.modelRequests + (e.modelRequests ?? 0),
      tokens: a.tokens + (e.tokens ?? 0),
      costUsd: a.costUsd + (e.costUsd ?? 0),
      actions: a.actions + (e.actions ?? 0),
      resets: a.resets + (e.resets ?? 0),
      artifactBytes: a.artifactBytes + (e.artifactBytes ?? 0),
    };
  }

  private project(t: ReturnType<ResourceLedger["totals"]>, b: Budget & { maxResets?: number }): { ok: boolean } {
    if (b.maxModelRequests !== undefined && t.modelRequests > b.maxModelRequests) return { ok: false };
    if (b.maxTokens !== undefined && t.tokens > b.maxTokens) return { ok: false };
    if (b.maxCostUsd !== undefined && t.costUsd > b.maxCostUsd + 1e-9) return { ok: false };
    if (b.maxActions !== undefined && t.actions > b.maxActions) return { ok: false };
    if (b.maxResets !== undefined && t.resets > b.maxResets) return { ok: false };
    return { ok: true };
  }
}

/** Negative or non-finite amounts would silently corrupt accounting; reject them. */
function assertValidUsage(entry: UsageEntry): void {
  for (const field of NUMERIC_FIELDS) {
    const value = entry[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`invalid usage amount for '${field}': ${String(value)}`);
    }
  }
}
