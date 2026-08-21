import type { Budget, UsageEntry } from "./types.js";
import { StateFile } from "./state-file.js";

interface LedgerState {
  entries: UsageEntry[];
  stopped: boolean;
}

/**
 * Resource ledger (M7 S3). Tracks model requests/tokens/cost, actions,
 * resets, and artifact bytes per worker and globally. Budget checks are
 * deterministic: a charge is admitted iff the resulting total stays within
 * every configured bound.
 */
export class ResourceLedger {
  private state: LedgerState;
  private readonly file: StateFile<LedgerState>;

  constructor(
    stateDir: string,
    private readonly globalBudget: Budget = {},
    private readonly workerBudgets: Record<string, Budget> = {},
  ) {
    this.file = new StateFile(stateDir, "ledger", () => ({ entries: [], stopped: false }));
    this.state = this.file.load();
  }

  /** Attempt to charge usage; returns false when a budget would be exceeded. */
  charge(entry: UsageEntry): boolean {
    if (this.state.stopped) return false;
    const nextGlobal = this.project(
      this.add(this.sumOf(this.state.entries), entry),
      this.globalBudget,
    );
    if (!nextGlobal.ok) return false;
    const wb = entry.workerId ? this.workerBudgets[entry.workerId] : undefined;
    if (wb) {
      const workerTotals = this.sumOf(
        this.state.entries.filter((e) => e.workerId === entry.workerId),
      );
      const nextWorker = this.project(this.add(workerTotals, entry), wb);
      if (!nextWorker.ok) return false;
    }
    this.state.entries.push(entry);
    this.persist();
    return true;
  }

  totals(filter?: { workerId?: string }): Required<Pick<UsageEntry, "modelRequests" | "tokens" | "costUsd" | "actions" | "resets" | "artifactBytes">> {
    return this.sumOf(this.filterEntries(filter));
  }

  stop(): void {
    this.state.stopped = true;
    this.persist();
  }

  get isStopped(): boolean {
    return this.state.stopped;
  }

  private filterEntries(filter?: { workerId?: string }): UsageEntry[] {
    if (!filter?.workerId) return this.state.entries;
    return this.state.entries.filter((e) => e.workerId === filter.workerId);
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

  private persist(): void {
    this.file.save(this.state);
  }
}
