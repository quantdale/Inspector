import type { Budget, UsageEntry } from "./types.js";
import { StateFile } from "./state-file.js";

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
    this.file = new StateFile(stateDir, "ledger", () => ({ entries: [], stopped: false }));
    // Fail loud at construction if durable state is corrupt.
    this.file.load();
  }

  /**
   * Attempt to charge usage; returns false when a budget would be exceeded.
   * Pass `allowWhenStopped` for work that already consumed resources while a
   * stop was racing it — the usage is real and must be accounted, and the
   * caller distinguishes stop-from-budget through other means.
   */
  charge(entry: UsageEntry, options: { allowWhenStopped?: boolean } = {}): boolean {
    assertValidUsage(entry);
    return this.file.update((state) => {
      if (state.stopped && !options.allowWhenStopped) return false;
      const nextGlobal = this.project(
        this.add(this.sumOf(state.entries), entry),
        this.globalBudget,
      );
      if (!nextGlobal.ok) return false;
      const wb = entry.workerId ? this.workerBudgets[entry.workerId] : undefined;
      if (wb) {
        const workerTotals = this.sumOf(
          state.entries.filter((e) => e.workerId === entry.workerId),
        );
        const nextWorker = this.project(this.add(workerTotals, entry), wb);
        if (!nextWorker.ok) return false;
      }
      state.entries.push(entry);
      return true;
    });
  }

  totals(filter?: { workerId?: string }): Required<Pick<UsageEntry, "modelRequests" | "tokens" | "costUsd" | "actions" | "resets" | "artifactBytes">> {
    const entries = this.file.load().entries;
    return this.sumOf(this.filterEntries(entries, filter));
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

  private filterEntries(entries: UsageEntry[], filter?: { workerId?: string }): UsageEntry[] {
    if (!filter?.workerId) return entries;
    return entries.filter((e) => e.workerId === filter.workerId);
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

  private project(t: ReturnType<ResourceLedger["totals"]>, b: Budget): { ok: boolean } {
    if (b.maxModelRequests !== undefined && t.modelRequests > b.maxModelRequests) return { ok: false };
    if (b.maxTokens !== undefined && t.tokens > b.maxTokens) return { ok: false };
    if (b.maxCostUsd !== undefined && t.costUsd > b.maxCostUsd + 1e-9) return { ok: false };
    if (b.maxActions !== undefined && t.actions > b.maxActions) return { ok: false };
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
