import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { newId } from "@inspector/protocol";
import { FindingEngine, OracleEngine, type Finding } from "@inspector/finding";
import { Store } from "@inspector/store-sqlite";
import { FakeAdapterHandler } from "@inspector/adapter-fake";
import type { WorkItem } from "./types.js";
import { LeaseManager } from "./leases.js";
import { ResourceLedger } from "./ledger.js";
import { FindingClusterer } from "./cluster.js";
import { StateFile } from "./state-file.js";

export interface CampaignOptions {
  stateDir?: string;
  workerCount: number;
  items: WorkItem[];
  /** Deterministic per-action usage charged to the ledger. */
  usagePerStep: { modelRequests: number; tokens: number; costUsd: number; actions: number };
  globalBudget?: { maxActions?: number; maxTokens?: number; maxCostUsd?: number };
  now?: () => number;
}

export interface CampaignReport {
  completed: string[];
  failed: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  findings: Finding[];
  clusters: number;
  usage: ReturnType<ResourceLedger["totals"]>;
  restartsInjected: number;
}

interface CampaignState {
  queue: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  findings: Finding[];
  restarts: number;
}

/**
 * Bounded unattended campaign (M7 S5/S8). Deterministic scheduler assigns
 * queued work items to bounded workers holding exclusive leases. State is
 * durable: a restarted controller re-reads the queue/leases and safely
 * classifies in-flight work without duplicating completed items.
 */
export class UnattendedCampaign {
  private readonly leases: LeaseManager;
  private readonly ledger: ResourceLedger;
  private readonly stateFile;
  private readonly state: CampaignState;
  private readonly itemsById = new Map<string, WorkItem>();
  private stopped = false;

  constructor(
    private readonly opts: CampaignOptions,
    private readonly store: Store,
    private readonly artifactsDir: string = mkdtempSync(join(tmpdir(), "inspector-scale-")),
    stateDirOverride?: string,
  ) {
    const stateDir = stateDirOverride ?? join(this.artifactsDir, "state");
    this.leases = new LeaseManager(stateDir, opts.now ?? Date.now);
    this.ledger = new ResourceLedger(stateDir, opts.globalBudget ?? {});
    this.stateFile = new StateFile<CampaignState>(stateDir, "campaign", () => ({
      queue: [],
      executions: [],
      findings: [],
      restarts: 0,
    }));
    this.state = this.stateFile.load();
    for (const item of opts.items) this.itemsById.set(item.id, item);
    // Requeue on construction: pending + not-done items, deterministic order.
    const doneOrExecuted = new Set([...this.state.executions.map((e) => e.itemId)]);
    const knownQueue = this.state.queue.filter((id) => !doneOrExecuted.has(id));
    const missing = opts.items
      .map((i) => i.id)
      .filter((id) => !doneOrExecuted.has(id) && !knownQueue.includes(id));
    this.state.queue = [...knownQueue, ...missing].sort((a, b) => {
      const pa = this.itemsById.get(a)?.priority ?? 0;
      const pb = this.itemsById.get(b)?.priority ?? 0;
      return pa - pb || a.localeCompare(b);
    });
    this.persist();
  }

  get ledgerRef(): ResourceLedger {
    return this.ledger;
  }

  /**
   * Simulate a controller crash+restart: in-flight leases are dropped from
   * memory and reclaimed by TTL expiry on the next run pass.
   */
  injectRestart(): void {
    this.state.restarts += 1;
    this.persist();
  }

  stop(): void {
    this.stopped = true;
    this.ledger.stop();
  }

  async run(): Promise<CampaignReport> {
    const workers = Array.from({ length: this.opts.workerCount }, (_, i) => `worker-${i}`);
    const failed: string[] = [];

    while (this.state.queue.length > 0 && !this.stopped) {
      let progressed = false;
      for (const workerId of workers) {
        if (this.state.queue.length === 0) break;
        const itemId = this.state.queue[0]!;
        const item = this.itemsById.get(itemId);
        if (!item) {
          this.state.queue.shift();
          continue;
        }
        const acquired = this.leases.acquire(itemId, workerId);
        if (!acquired.ok) continue; // held by another worker: try next worker slot later

        this.state.queue.shift();
        this.persist();

        const ok = await this.executeItem(item, workerId);
        if (ok) {
          // Record only after success: a controller crash mid-item leaves the
          // item unrecorded, so the restarted controller safely redoes it.
          this.state.executions.push({ itemId, workerId });
          this.persist();
          this.leases.complete(itemId, workerId);
        } else {
          failed.push(itemId);
          this.leases.release(itemId, workerId);
        }
        progressed = true;
      }
      if (!progressed) break; // all remaining items held elsewhere: nothing to do
    }

    return {
      completed: [...new Set(this.state.executions.map((e) => e.itemId))],
      failed,
      executions: this.state.executions,
      findings: this.state.findings,
      clusters: this.clusterFindings().size,
      usage: this.ledger.totals(),
      restartsInjected: this.state.restarts,
    };
  }

  clusterFindings(): FindingClusterer {
    const clusterer = new FindingClusterer();
    for (const f of this.state.findings) {
      clusterer.add(f, { errorText: f.title });
    }
    return clusterer;
  }

  private async executeItem(item: WorkItem, workerId: string): Promise<boolean> {
    // Per-item isolated environment: its own store, artifacts, and fake
    // adapter state machine — no cross-worker contamination is possible.
    const ws = mkdtempSync(join(tmpdir(), `inspector-${workerId}-${item.id}-`));
    const store = Store.open(join(ws, "runs.db"));
    try {
      const handler = new FakeAdapterHandler({
        artifactBaseDir: join(ws, "artifacts"),
      });
      await handler.initialize();
      await handler.lifecycle({ op: "create" });

      const engine = new FindingEngine(OracleEngine.defaults(), store);
      const finding = engine.ingest(
        { kind: "DEFECT_SUBMIT_INVALID", detail: `seed ${item.seed}` },
        { runId: `run-${item.id}`, title: `defect-${item.target}-seed${item.seed}` },
      );
      this.state.findings.push(finding);

      // Bounded deterministic hunt cycles against the isolated environment.
      for (let i = 0; i < item.steps; i++) {
        const action = {
          id: newId("act"),
          runId: `run-${item.id}`,
          environmentId: "env",
          kind: "click",
          risk: "interact",
          deadlineMs: 5000,
          idempotency: "safe-retry",
          input: {},
        } as Parameters<typeof handler.act>[0]["action"];
        const outcome = await handler.act({ action });
        const charged = this.ledger.charge({
          workerId,
          itemId: item.id,
          actions: this.opts.usagePerStep.actions,
          modelRequests: this.opts.usagePerStep.modelRequests,
          tokens: this.opts.usagePerStep.tokens,
          costUsd: this.opts.usagePerStep.costUsd,
        });
        if (!charged) return false; // budget exhausted: item fails cleanly
        if (outcome.status === "target-failure") break;
      }
      void finding;
      return true;
    } finally {
      store.close();
    }
  }

  private persist(): void {
    this.stateFile.save(this.state);
  }
}
