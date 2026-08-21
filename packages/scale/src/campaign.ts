import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
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
  /** Durable state directory shared by all campaign instances over one deployment. */
  stateDir?: string;
  workerCount: number;
  items: WorkItem[];
  /** Deterministic per-action usage charged to the ledger. */
  usagePerStep: { modelRequests: number; tokens: number; costUsd: number; actions: number };
  globalBudget?: { maxActions?: number; maxTokens?: number; maxCostUsd?: number };
  now?: () => number;
  /** Lease TTL; long items renew at half-TTL intervals while they run. */
  leaseTtlMs?: number;
}

export interface CampaignReport {
  completed: string[];
  failed: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  findings: Finding[];
  clusters: number;
  usage: ReturnType<ResourceLedger["totals"]>;
  restartsInjected: number;
  /** Completions rejected by lease fencing: logged and counted, never applied. */
  staleCompletions: number;
}

interface CampaignState {
  queue: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  findings: Finding[];
  failed: string[];
  restarts: number;
  staleCompletions: number;
}

/** Coerce legacy/partial on-disk state so pre-hardening files load safely. */
function normalizeInPlace(s: Partial<CampaignState>): asserts s is CampaignState {
  if (!Array.isArray(s.queue)) s.queue = [];
  if (!Array.isArray(s.executions)) s.executions = [];
  if (!Array.isArray(s.findings)) s.findings = [];
  if (!Array.isArray(s.failed)) s.failed = [];
  if (typeof s.restarts !== "number") s.restarts = 0;
  if (typeof s.staleCompletions !== "number") s.staleCompletions = 0;
}

/**
 * Bounded unattended campaign (M7 S5/S8). Deterministic scheduler assigns
 * queued work items to bounded workers holding exclusive leases. State is
 * durable: a restarted controller re-reads the queue/leases and safely
 * classifies in-flight work without duplicating completed items.
 *
 * Hardening: every state mutation runs inside the state file's cross-process
 * lock with a fresh disk read, so multiple campaign instances over one
 * stateDir serialize instead of overwriting each other. Item execution is
 * contained — an adapter throw records a durable failure, releases the lease,
 * and the run continues. Findings are persisted as soon as they are ingested,
 * per-item scratch dirs are cleaned up in `finally`, long items renew their
 * lease at half-TTL intervals, and completions are fenced: only a worker
 * still holding the current lease generation may record its execution.
 */
export class UnattendedCampaign {
  private readonly leases: LeaseManager;
  private readonly ledger: ResourceLedger;
  private readonly stateFile: StateFile<CampaignState>;
  private readonly itemsById = new Map<string, WorkItem>();
  private readonly artifactsPath: string;
  private readonly ownsArtifactsDir: boolean;
  private readonly ttlMs: number;
  private stopped = false;

  constructor(
    private readonly opts: CampaignOptions,
    artifactsDir?: string,
    stateDirOverride?: string,
  ) {
    this.ownsArtifactsDir = artifactsDir === undefined;
    this.artifactsPath = artifactsDir ?? mkdtempSync(join(tmpdir(), "inspector-scale-"));
    const stateDir = stateDirOverride ?? opts.stateDir ?? join(this.artifactsPath, "state");
    this.ttlMs = opts.leaseTtlMs ?? 60_000;
    this.leases = new LeaseManager(stateDir, opts.now ?? Date.now, this.ttlMs);
    this.ledger = new ResourceLedger(stateDir, opts.globalBudget ?? {});
    this.stateFile = new StateFile<CampaignState>(stateDir, "campaign", () => ({
      queue: [],
      executions: [],
      findings: [],
      failed: [],
      restarts: 0,
      staleCompletions: 0,
    }));
    for (const item of opts.items) this.itemsById.set(item.id, item);
    // Requeue on construction: pending + not-done items, deterministic order.
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      const doneOrExecuted = new Set(s.executions.map((e) => e.itemId));
      const knownQueue = s.queue.filter((id) => !doneOrExecuted.has(id));
      const missing = opts.items
        .map((i) => i.id)
        .filter((id) => !doneOrExecuted.has(id) && !knownQueue.includes(id));
      s.queue = [...knownQueue, ...missing].sort((a, b) => {
        const pa = this.itemsById.get(a)?.priority ?? 0;
        const pb = this.itemsById.get(b)?.priority ?? 0;
        return pa - pb || a.localeCompare(b);
      });
    });
  }

  get ledgerRef(): ResourceLedger {
    return this.ledger;
  }

  get leasesRef(): LeaseManager {
    return this.leases;
  }

  get artifactDir(): string {
    return this.artifactsPath;
  }

  /**
   * Simulate a controller crash+restart: in-flight leases are dropped from
   * memory and reclaimed by TTL expiry on the next run pass.
   */
  injectRestart(): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.restarts += 1;
    });
  }

  /** Cooperative stop: session-scoped halt plus a durable ledger stop that survives restart. */
  stop(): void {
    this.stopped = true;
    this.ledger.stop();
  }

  /** Operator path: clear both the session halt and the durable stop. */
  resume(): void {
    this.stopped = false;
    this.ledger.resume();
  }

  /**
   * Terminal cleanup: removes the auto-created scratch directory (including
   * any state under it). A caller-provided artifacts dir is never touched.
   */
  dispose(): void {
    if (this.ownsArtifactsDir) {
      rmSync(this.artifactsPath, { recursive: true, force: true });
    }
  }

  async run(): Promise<CampaignReport> {
    const workers = Array.from({ length: this.opts.workerCount }, (_, i) => `worker-${i}`);

    if (!(this.stopped || this.ledger.isStopped)) {
      for (;;) {
        if (this.stopped) break;
        if (this.stateFile.load().queue.length === 0) break;
        let progressed = false;
        for (const workerId of workers) {
          if (this.stopped) break;
          const itemId = this.stateFile.load().queue[0];
          if (itemId === undefined) break;
          const item = this.itemsById.get(itemId);
          if (!item) {
            this.removeFromQueue(itemId);
            continue;
          }
          const acquired = this.leases.acquire(itemId, workerId);
          if (!acquired.ok) continue; // held/done elsewhere: try the next slot

          this.removeFromQueue(itemId);

          try {
            const ok = await this.executeItem(item, workerId, acquired.lease.generation);
            if (ok && this.leases.complete(itemId, workerId, acquired.lease.generation)) {
              // Record only after a fenced successful completion.
              this.recordExecution(itemId, workerId);
            } else if (ok) {
              // Our lease expired and was reclaimed mid-run: the current
              // holder owns the outcome; our work is never double-recorded.
              this.recordStaleCompletion(itemId, workerId);
            } else {
              this.recordFailure(itemId);
              this.leases.release(itemId, workerId);
            }
          } catch (err) {
            // Contain adapter crashes: durable failure, lease released, run continues.
            console.warn(
              `[scale] item ${itemId} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            this.recordFailure(itemId);
            this.leases.release(itemId, workerId);
          }
          progressed = true;
        }
        if (!progressed) break; // all remaining items held elsewhere: nothing to do
      }
    }

    return this.report();
  }

  clusterFindings(): FindingClusterer {
    const clusterer = new FindingClusterer();
    for (const f of this.stateFile.load().findings) {
      clusterer.add(f, { errorText: f.title });
    }
    return clusterer;
  }

  private report(): CampaignReport {
    const s = this.current();
    return {
      completed: [...new Set(s.executions.map((e) => e.itemId))],
      failed: [...s.failed],
      executions: s.executions.map((e) => ({ ...e })),
      findings: s.findings,
      clusters: this.clusterFindings().size,
      usage: this.ledger.totals(),
      restartsInjected: s.restarts,
      staleCompletions: s.staleCompletions,
    };
  }

  private current(): CampaignState {
    const s: Partial<CampaignState> = this.stateFile.load();
    normalizeInPlace(s);
    return s;
  }

  private removeFromQueue(itemId: string): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.queue = s.queue.filter((id) => id !== itemId);
    });
  }

  private recordExecution(itemId: string, workerId: string): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.executions.push({ itemId, workerId });
      s.failed = s.failed.filter((id) => id !== itemId);
    });
  }

  private recordFailure(itemId: string): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      if (!s.failed.includes(itemId)) s.failed.push(itemId);
    });
  }

  private recordStaleCompletion(itemId: string, workerId: string): void {
    console.warn(`[scale] stale completion ignored: item=${itemId} worker=${workerId}`);
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.staleCompletions += 1;
    });
  }

  private async executeItem(item: WorkItem, workerId: string, generation?: number): Promise<boolean> {
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
      // Persist evidence before proceeding: a crash later in the item must
      // not lose work already done.
      this.stateFile.update((s) => {
        normalizeInPlace(s);
        s.findings.push(finding);
      });

      let lastRenewMs = this.nowMs();
      // Bounded deterministic hunt cycles against the isolated environment.
      for (let i = 0; i < item.steps; i++) {
        // Renewal at half-TTL keeps long items from expiring mid-run; the
        // generation fence remains the backstop if renewal ever fails.
        const t = this.nowMs();
        if (t - lastRenewMs >= this.ttlMs / 2) {
          this.leases.renew(item.id, workerId, generation);
          lastRenewMs = t;
        }
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
      return true;
    } finally {
      store.close();
      rmSync(ws, { recursive: true, force: true });
    }
  }

  private nowMs(): number {
    return this.opts.now?.() ?? Date.now();
  }
}
