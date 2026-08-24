import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Finding } from "@inspector/finding";
import type { Budget, WorkItem as LegacyWorkItem } from "./types.js";
import { LeaseManager } from "./leases.js";
import { ResourceLedger } from "./ledger.js";
import { FindingClusterer } from "./cluster.js";
import { StateFile } from "./state-file.js";
import {
  ItemCancelledError,
  type AdapterFamily,
  type ExecutionContext,
  type WorkItemExecutor,
  type WorkItemFailureClass,
  type WorkItemResult,
  type WorkerCapabilitySnapshot,
} from "./executor.js";
import { FakeItemExecutor } from "./fake-executor.js";

export interface CampaignOptions {
  /** Durable state directory shared by all campaign instances over one deployment. */
  stateDir?: string;
  workerCount: number;
  items: LegacyWorkItem[];
  /** Deterministic per-action usage charged to the ledger by the default fake executor. */
  usagePerStep: { modelRequests: number; tokens: number; costUsd: number; actions: number };
  globalBudget?: { maxActions?: number; maxTokens?: number; maxCostUsd?: number };
  workerBudgets?: Record<string, Budget>;
  now?: () => number;
  /** Lease TTL; long items renew at half-TTL intervals while they run. */
  leaseTtlMs?: number;
  /** Durable lease backend; SQLite is recommended for cross-process CLI use. */
  leaseBackend?: "json" | "sqlite";
  /**
   * M12 F1: pluggable execution. When omitted, the deterministic
   * {@link FakeItemExecutor} preserves the historical behavior exactly.
   */
  executor?: WorkItemExecutor;
  /**
   * Keep per-item workspace directories under the campaign artifacts root
   * after execution (needed when the executor persists evidence there).
   * Default false removes them like the historical scratch behavior.
   */
  keepItemWorkspaces?: boolean;
  /** Poll interval when runnable work exists only behind external holds. */
  claimPollMs?: number;
  /** Progress sink for executor progress lines (stderr in the CLI). */
  onProgress?: (line: string) => void;
}

export interface CampaignRefusal {
  itemId: string;
  class: WorkItemFailureClass;
  detail: string;
  at: string;
}

export interface CampaignAssignmentRecord {
  itemId: string;
  workerId: string;
  attempt: number;
  generation?: number;
  at: string;
  executorId: string;
  /** Capability tags the assigning worker presented at claim time. */
  capabilities: string[];
}

interface ExecutionRecord {
  itemId: string;
  workerId: string;
  runIds?: string[];
  workspaceDir?: string;
}

export interface CampaignReport {
  completed: string[];
  failed: string[];
  executions: ExecutionRecord[];
  findings: Finding[];
  clusters: number;
  usage: ReturnType<ResourceLedger["totals"]>;
  restartsInjected: number;
  /** Completions rejected by lease fencing: logged and counted, never applied. */
  staleCompletions: number;
  /** M12 additive: routing/execution refusals with stable classifications. */
  refusals: CampaignRefusal[];
  /** M12 additive: durable assignment decisions for audit/recovery. */
  assignments: CampaignAssignmentRecord[];
  /** M12 additive: per-item failure classification detail. */
  failureDetails: Record<string, { class: WorkItemFailureClass; detail: string }>;
  /** M12 additive: why scheduling stopped (null = queue drained). */
  stopReason: string | null;
  /** M12 additive: wall-clock elapsed for the whole campaign (ms). */
  elapsedMs: number;
  /** M12 additive: finding aggregation over the standard lifecycle. */
  findingSummary?: FindingSummary;
}

interface CampaignState {
  queue: string[];
  executions: ExecutionRecord[];
  findings: Finding[];
  failed: string[];
  failureDetails: Record<string, { class: WorkItemFailureClass; detail: string }>;
  refusals: CampaignRefusal[];
  assignments: CampaignAssignmentRecord[];
  restarts: number;
  staleCompletions: number;
  stopReason: string | null;
  startedAtMs: number | null;
  workerCaps: Record<string, WorkerCapabilitySnapshot>;
}

/** Coerce legacy/partial on-disk state so pre-M12 files load safely. */
function normalizeInPlace(s: Partial<CampaignState>): asserts s is CampaignState {
  if (!Array.isArray(s.queue)) s.queue = [];
  if (!Array.isArray(s.executions)) s.executions = [];
  if (!Array.isArray(s.findings)) s.findings = [];
  if (!Array.isArray(s.failed)) s.failed = [];
  if (typeof s.restarts !== "number") s.restarts = 0;
  if (typeof s.staleCompletions !== "number") s.staleCompletions = 0;
  if (!s.failureDetails || typeof s.failureDetails !== "object") s.failureDetails = {};
  if (!Array.isArray(s.refusals)) s.refusals = [];
  if (!Array.isArray(s.assignments)) s.assignments = [];
  if (s.stopReason === undefined) s.stopReason = null;
  if (s.startedAtMs === undefined) s.startedAtMs = null;
  if (!s.workerCaps || typeof s.workerCaps !== "object") s.workerCaps = {};
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "__");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded unattended campaign (M7 S5/S8; M12 F1 re-architecture).
 *
 * The scheduler owns queueing, priorities, worker ownership, leasing/fencing,
 * budgets, cancellation, resume, lifecycle state, and durable accounting.
 * Item EXECUTION is delegated to a pluggable {@link WorkItemExecutor}; the
 * scheduler imports no specific adapter handler or workflow engine. Workers
 * run genuinely concurrently: each scheduling pass claims at most one new
 * item per idle worker in deterministic priority order, then executes claims
 * in parallel. Assignment is capability-aware — a worker only receives items
 * its executor can genuinely run; work no available worker can execute is
 * durably refused with a stable classification instead of being faked.
 *
 * Durability: every state mutation runs inside the state file's cross-process
 * lock with a fresh disk read, so multiple campaign instances over one
 * stateDir serialize instead of overwriting each other. Executor failures are
 * contained as classified durable failures; findings are persisted through
 * ctx.persistPartial as soon as executors commit them; long items renew their
 * lease via ctx.renewLease(); completions are fenced by lease generation so a
 * stale holder can never record work.
 */
export class UnattendedCampaign {
  private readonly leases: LeaseManager;
  private readonly ledger: ResourceLedger;
  private readonly stateFile: StateFile<CampaignState>;
  private readonly executor: WorkItemExecutor;
  private readonly itemsById = new Map<string, LegacyWorkItem>();
  private readonly artifactsPath: string;
  private readonly ownsArtifactsDir: boolean;
  private readonly ttlMs: number;
  private readonly claimPollMs: number;
  private readonly keepItemWorkspaces: boolean;
  private stopped = false;
  private stopReason: string | null = null;
  private abort = new AbortController();
  private activeClaims = new Set<string>();
  private capsCache: WorkerCapabilitySnapshot | null = null;

  constructor(
    private readonly opts: CampaignOptions,
    artifactsDir?: string,
    stateDirOverride?: string,
  ) {
    this.executor =
      opts.executor ??
      new FakeItemExecutor({
        usagePerStep: opts.usagePerStep,
        ...(opts.leaseTtlMs !== undefined ? { leaseTtlMs: opts.leaseTtlMs } : {}),
      });
    this.ownsArtifactsDir = artifactsDir === undefined;
    this.artifactsPath = artifactsDir ?? mkdtempSync(join(tmpdir(), "inspector-scale-"));
    const stateDir = stateDirOverride ?? opts.stateDir ?? join(this.artifactsPath, "state");
    this.ttlMs = opts.leaseTtlMs ?? 60_000;
    this.claimPollMs = opts.claimPollMs ?? 10;
    this.keepItemWorkspaces = opts.keepItemWorkspaces ?? false;
    this.leases = new LeaseManager(stateDir, opts.now ?? Date.now, this.ttlMs, {
      backend: opts.leaseBackend,
    });
    this.ledger = new ResourceLedger(stateDir, opts.globalBudget ?? {}, opts.workerBudgets ?? {});
    this.stateFile = new StateFile<CampaignState>(stateDir, "campaign", () => ({
      queue: [],
      executions: [],
      findings: [],
      failed: [],
      failureDetails: {},
      refusals: [],
      assignments: [],
      restarts: 0,
      staleCompletions: 0,
      stopReason: null,
      startedAtMs: null,
      workerCaps: {},
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
      if (s.startedAtMs === null) s.startedAtMs = this.nowMs();
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

  /** Resolved executor id (exposed for observability/tests). */
  get executorId(): string {
    return this.executor.id;
  }

  /**
   * Simulate a controller crash+restart: in-flight claims are dropped from
   * memory and reclaimed by TTL expiry on the next run pass.
   */
  injectRestart(): void {
    this.abort = new AbortController();
    this.activeClaims.clear();
    this.capsCache = null;
    this.stopped = false;
    this.stopReason = null;
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.restarts += 1;
    });
  }

  /** Cooperative stop: session-scoped halt plus a durable ledger stop that survives restart. */
  stop(reason = "stopped"): void {
    this.stopped = true;
    this.stopReason = reason;
    this.abort.abort();
    this.ledger.stop();
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.stopReason = reason;
    });
  }

  /** Operator path: clear both the session halt and the durable stop. */
  resume(): void {
    this.stopped = false;
    this.stopReason = null;
    this.abort = new AbortController();
    this.ledger.resume();
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.stopReason = null;
    });
  }

  /**
   * Terminal cleanup: removes the auto-created scratch directory (including
   * any state under it). A caller-provided artifacts dir is never touched.
   */
  dispose(): void {
    this.close();
    if (this.ownsArtifactsDir) {
      rmSync(this.artifactsPath, { recursive: true, force: true });
    }
  }

  /** Release backend handles while retaining durable campaign state. */
  close(): void {
    this.leases.close();
  }

  async run(): Promise<CampaignReport> {
    const workers = Array.from({ length: this.opts.workerCount }, (_, i) => `worker-${i}`);

    if (!(this.stopped || this.ledger.isStopped)) {
      await this.scheduleAll(workers);
    }

    return this.report();
  }

  /**
   * Event-driven scheduler: every pass claims at most one item per idle
   * worker (deterministic priority order), launches those claims in parallel,
   * and waits until at least one finishes before the next pass. Items no
   * worker can route are refused durably exactly once, up front.
   */
  private async scheduleAll(workers: string[]): Promise<void> {
    await this.recordRoutingRefusals(workers[0]!);

    interface Run {
      workerId: string;
      done: boolean;
      promise: Promise<void>;
    }
    const inflight = new Map<string, Run>();
    let idleSpins = 0;

    for (;;) {
      if (this.stopped || this.ledger.isStopped) break;
      // Reap finished runs.
      for (const [workerId, run] of [...inflight]) {
        if (run.done) inflight.delete(workerId);
      }
      const idle = workers.filter((w) => !inflight.has(w));

      for (const workerId of idle) {
        await this.ensureWorkerCapabilities(workerId);
        const claim = this.claimNext(workerId);
        if (claim === "empty") continue;
        const run: Run = { workerId, done: false, promise: Promise.resolve() };
        run.promise = (async () => {
          try {
            const result = await this.executeWithExecutor(claim.item, workerId, claim.attempt, claim.generation);
            this.settleResult(claim.item, workerId, claim.generation, result);
            } catch (err) {
              if (err instanceof ItemCancelledError || (err instanceof Error && err.name === "ItemCancelledError")) {
                // Cooperative cancel: reconcile against durable lease truth.
                this.reconcileCancellation(claim.item, workerId, claim.generation);
              } else {
              console.warn(
                `[scale] item ${claim.item.id} failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              this.recordFailure(claim.item.id, "execution-failure", err instanceof Error ? err.message : String(err));
              this.leases.release(claim.item.id, workerId);
            }
          } finally {
            this.activeClaims.delete(claim.item.id);
            run.done = true;
          }
        })();
        inflight.set(workerId, run);
      }
      if (inflight.size > 0) {
        idleSpins = 0;
        // Wait until at least one in-flight run settles, then reschedule.
        await Promise.race([...inflight.values()].map((r) => r.promise));
        continue;
      }
      const queue = this.stateFile.load().queue;
      if (queue.length === 0) break;
      // Remaining items exist but none acquirable: externally held (fresh
      // leases owned by other processes). Yield briefly, boundedly.
      idleSpins += 1;
      if (idleSpins > 200) break;
      await sleep(this.claimPollMs);
    }
    // Propagate cancellation into still-running executors on stop.
    if (this.stopped || this.ledger.isStopped) {
      await Promise.all([...inflight.values()].map((r) => r.promise));
    }
  }

  /**
   * Refuse (once, durably) every queued item that NO available worker can
   * execute. Environment limitations become classified records, never silent
   * hangs or fake executions.
   */
  private async recordRoutingRefusals(sampleWorkerId: string): Promise<void> {
    const caps = await this.ensureWorkerCapabilities(sampleWorkerId);
    const refuse: Array<{ itemId: string; cls: WorkItemFailureClass; detail: string }> = [];
    for (const itemId of this.current().queue) {
      const item = this.itemsById.get(itemId);
      if (!item) continue;
      const routed = this.routeForWorker(caps, item);
      if (!routed.ok) refuse.push({ itemId, cls: routed.class, detail: routed.detail });
    }
    if (refuse.length === 0) return;
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      for (const r of refuse) {
        if (s.refusals.some((x) => x.itemId === r.itemId)) continue;
        s.refusals.push({
          itemId: r.itemId,
          class: r.cls,
          detail: r.detail,
          at: new Date().toISOString(),
        });
        s.queue = s.queue.filter((id) => id !== r.itemId);
      }
    });
  }

  /** Claim the highest-priority routable, acquirable item for one worker. */
  private claimNext(
    workerId: string,
  ): "empty" | { item: LegacyWorkItem; generation: number | undefined; attempt: number } {
    const snapshot = this.stateFile.load();
    normalizeInPlace(snapshot);
    if (snapshot.queue.length === 0) return "empty";
    const attempts = this.attemptCounts(snapshot);
    for (const itemId of snapshot.queue) {
      if (this.activeClaims.has(itemId)) continue; // local worker owns it
      const item = this.itemsById.get(itemId);
      if (!item) {
        this.removeFromQueue(itemId);
        continue;
      }
      const acquired = this.leases.acquire(itemId, workerId);
      if (!acquired.ok) continue; // held/done elsewhere: next candidate
      this.removeFromQueue(itemId);
      this.activeClaims.add(itemId);
      const attempt = (attempts.get(itemId) ?? 0) + 1;
      this.recordAssignment(itemId, workerId, attempt, acquired.lease.generation);
      return { item, generation: acquired.lease.generation, attempt };
    }
    return "empty";
  }

  /**
   * Capability-aware routing decision for one (worker, item) pair.
   * F4 deepens this with per-family probing and persisted decisions.
   */
  private routeForWorker(
    caps: WorkerCapabilitySnapshot,
    item: LegacyWorkItem,
  ): { ok: true } | { ok: false; class: WorkItemFailureClass; detail: string } {
    if (!caps.available) {
      return { ok: false, class: "capability-unavailable", detail: caps.detail ?? "executor unavailable" };
    }
    const family = familyOf(item);
    if (!caps.families.includes(family)) {
      return {
        ok: false,
        class: "capability-unavailable",
        detail: `executor '${caps.executorId}' cannot execute adapter family '${family}'`,
      };
    }
    const missing = (item.requiresCapabilities ?? []).filter((c) => !caps.capabilities.includes(c));
    if (missing.length > 0) {
      return {
        ok: false,
        class: "capability-unavailable",
        detail: `missing required capabilities: ${missing.join(", ")}`,
      };
    }
    return { ok: true };
  }

  private attemptCounts(snapshot: CampaignState): Map<string, number> {
    const counts = new Map<string, number>();
    for (const a of snapshot.assignments) {
      counts.set(a.itemId, Math.max(counts.get(a.itemId) ?? 0, a.attempt));
    }
    for (const e of snapshot.executions) {
      counts.set(e.itemId, Math.max(counts.get(e.itemId) ?? 0, 1));
    }
    return counts;
  }

  private async ensureWorkerCapabilities(workerId: string): Promise<WorkerCapabilitySnapshot> {
    if (this.capsCache) return this.capsCache;
    const caps = await Promise.resolve(this.executor.capabilities());
    this.capsCache = caps;
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.workerCaps = { ...s.workerCaps, [workerId]: caps };
    });
    return caps;
  }

  private recordAssignment(
    itemId: string,
    workerId: string,
    attempt: number,
    generation: number | undefined,
  ): void {
    const caps = this.capsCache;
    const record: CampaignAssignmentRecord = {
      itemId,
      workerId,
      attempt,
      ...(generation !== undefined ? { generation } : {}),
      at: new Date().toISOString(),
      executorId: caps?.executorId ?? this.executor.id,
      capabilities: caps ? [...caps.capabilities] : [],
    };
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.assignments.push(record);
    });
  }

  private removeFromQueue(itemId: string): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.queue = s.queue.filter((id) => id !== itemId);
    });
  }

  private releaseAndRequeue(itemId: string, workerId: string): void {
    this.activeClaims.delete(itemId);
    if (this.leases.isDone(itemId)) return; // completed elsewhere: never resurrect
    this.leases.release(itemId, workerId);
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      if (!s.queue.includes(itemId) && !s.executions.some((e) => e.itemId === itemId)) {
        s.queue.push(itemId);
        s.queue.sort((a, b) => {
          const pa = this.itemsById.get(a)?.priority ?? 0;
          const pb = this.itemsById.get(b)?.priority ?? 0;
          return pa - pb || a.localeCompare(b);
        });
      }
    });
  }

  private settleResult(
    item: LegacyWorkItem,
    workerId: string,
    generation: number | undefined,
    result: WorkItemResult,
  ): void {
    if (result.ok) {
      this.persistFindings(result.findings);
      if (this.leases.complete(item.id, workerId, generation)) {
        this.recordExecution(item.id, workerId, result);
      } else {
        // Our lease expired and was reclaimed mid-run: the current holder owns
        // the outcome; our work is never double-recorded.
        this.recordStaleCompletion(item.id, workerId);
      }
      return;
    }
    // A stop request that raced the executor reconciles against durable lease
    // truth FIRST: a lost lease means the work was stale (never double-
    // recorded); our own lease means requeue-for-resume. Genuine budget
    // refusal keeps its classification only when no stop is in effect.
    const stoppedRacing =
      this.abort.signal.aborted && result.failureClass !== "budget-exhausted";
    const budgetRefusal =
      result.failureClass === "budget-exhausted" && !this.abort.signal.aborted;
    if (stoppedRacing) {
      this.reconcileCancellation(item, workerId, generation);
      return;
    }
    if (budgetRefusal) {
      this.recordFailure(item.id, "budget-exhausted", result.failureDetail ?? "budget exhausted");
      this.leases.release(item.id, workerId);
      return;
    }
    this.recordFailure(
      item.id,
      result.failureClass ?? "execution-failure",
      result.failureDetail ?? "execution failed",
    );
    this.leases.release(item.id, workerId);
  }

  /**
   * Reconcile a cooperatively-cancelled item against the durable lease:
   * requeue for resume when we still own the claim; record a fenced stale
   * completion when another holder took over; do nothing when the item
   * already completed elsewhere.
   */
  private reconcileCancellation(
    item: LegacyWorkItem,
    workerId: string,
    generation: number | undefined,
  ): void {
    if (this.leases.isDone(item.id)) {
      this.activeClaims.delete(item.id);
      return;
    }
    const current = this.leases
      .inFlight(this.nowMs())
      .find((l) => l.itemId === item.id);
    if (current && (current.workerId !== workerId || (generation !== undefined && current.generation !== generation))) {
      this.recordStaleCompletion(item.id, workerId);
      this.activeClaims.delete(item.id);
      return;
    }
    this.releaseAndRequeue(item.id, workerId);
  }

  private async executeWithExecutor(
    item: LegacyWorkItem,
    workerId: string,
    attempt: number,
    generation: number | undefined,
  ): Promise<WorkItemResult> {
    const ws = this.createWorkspace(item.id, attempt);
    const ctx: ExecutionContext = {
      itemId: item.id,
      workerId,
      attempt,
      ...(generation !== undefined ? { leaseGeneration: generation } : {}),
      workspaceDir: ws,
      artifactsDir: this.artifactsPath,
      charge: (usage) =>
        // Work already consumed resources: record usage even while a stop is
        // racing this item; only genuine budget overruns return false.
        this.ledger.charge(
          { workerId, itemId: item.id, ...usage },
          { allowWhenStopped: true },
        ),
      renewLease: () => this.leases.renew(item.id, workerId, generation),
      persistPartial: (findings) => this.persistFindings(findings),
      signal: this.abort.signal,
      progress: (line) => this.opts.onProgress?.(line),
      now: () => this.nowMs(),
    };
    try {
      return await this.executor.execute(item, ctx);
    } finally {
      if (!this.keepItemWorkspaces) {
        // Remove every attempt workspace of this item (parents included).
        rmSync(join(this.artifactsPath, "items", sanitize(item.id)), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  private createWorkspace(itemId: string, attempt: number): string {
    const dir = join(this.artifactsPath, "items", sanitize(itemId), String(attempt));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  clusterFindings(): FindingClusterer {
    const clusterer = new FindingClusterer();
    for (const f of this.current().findings) {
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
      refusals: [...s.refusals],
      assignments: [...s.assignments],
      failureDetails: { ...s.failureDetails },
      stopReason: this.resolveStopReason(s),
      elapsedMs: Math.max(0, this.nowMs() - (s.startedAtMs ?? this.nowMs())),
      findingSummary: summarizeFindings(s.findings, this.clusterFindings()),
    };
  }

  private resolveStopReason(s: CampaignState): string | null {
    if (this.stopped && this.stopReason) return this.stopReason;
    return s.stopReason;
  }

  private current(): CampaignState {
    const s: Partial<CampaignState> = this.stateFile.load();
    normalizeInPlace(s);
    return s;
  }

  private persistFindings(findings: Finding[]): void {
    if (findings.length === 0) return;
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      // Executors may report the same finding twice (mid-run persistPartial
      // plus the final result). Persistence is idempotent per finding id so
      // restart/reconciliation can never duplicate durable findings.
      const known = new Set(s.findings.map((f) => f.id));
      const fresh = findings.filter((f) => !known.has(f.id));
      if (fresh.length > 0) s.findings.push(...fresh);
    });
  }

  private recordExecution(itemId: string, workerId: string, result: WorkItemResult): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.executions.push({
        itemId,
        workerId,
        ...(result.runIds.length > 0 ? { runIds: [...result.runIds] } : {}),
      });
      s.failed = s.failed.filter((id) => id !== itemId);
      delete s.failureDetails[itemId];
    });
  }

  private recordFailure(itemId: string, failureClass: WorkItemFailureClass, detail: string): void {
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      if (!s.failed.includes(itemId)) s.failed.push(itemId);
      s.failureDetails[itemId] = { class: failureClass, detail };
    });
  }

  private recordStaleCompletion(itemId: string, workerId: string): void {
    console.warn(`[scale] stale completion ignored: item=${itemId} worker=${workerId}`);
    this.stateFile.update((s) => {
      normalizeInPlace(s);
      s.staleCompletions += 1;
    });
  }

  private nowMs(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

/** Adapter family an item targets; legacy fake-only items normalize to "fake". */
export function familyOf(item: LegacyWorkItem): AdapterFamily {
  const raw = item.adapterFamily ?? item.target;
  if (
    raw === "fake" ||
    raw === "web" ||
    raw === "cli" ||
    raw === "windows" ||
    raw === "android" ||
    raw === "electron"
  ) {
    return raw;
  }
  return "fake";
}

/** M12 F7: campaign-level finding aggregation over the standard lifecycle. */
export interface FindingSummary {
  /** Total durable findings recorded by the campaign. */
  total: number;
  candidates: number;
  confirmed: number;
  resolved: number;
  regressed: number;
  flaky: number;
  rejected: number;
  other: number;
  /** Findings collapsed into an existing signature cluster (evidence kept). */
  duplicateMembers: number;
  /** Distinct signature clusters. */
  clusters: number;
}

/**
 * Aggregate campaign findings by lifecycle status and the existing signature
 * clustering. Duplicates keep their provenance members; only the count here
 * collapses them, never the evidence.
 */
export function summarizeFindings(findings: Finding[], clusterer: FindingClusterer): FindingSummary {
  const byStatus = { candidates: 0, confirmed: 0, resolved: 0, regressed: 0, flaky: 0, rejected: 0, other: 0 };
  for (const f of findings) {
    switch (f.status) {
      case "CANDIDATE":
      case "REPRODUCING":
      case "MINIMIZED":
        byStatus.candidates += 1;
        break;
      case "CONFIRMED":
        byStatus.confirmed += 1;
        break;
      case "RESOLVED":
        byStatus.resolved += 1;
        break;
      case "REGRESSED":
        byStatus.regressed += 1;
        break;
      case "FLAKY":
        byStatus.flaky += 1;
        break;
      case "REJECTED":
        byStatus.rejected += 1;
        break;
      default:
        byStatus.other += 1;
    }
  }
  const clusters = clusterer.list();
  let duplicateMembers = 0;
  for (const c of clusters) duplicateMembers += Math.max(0, c.members.length - 1);
  return {
    total: findings.length,
    ...byStatus,
    duplicateMembers,
    clusters: clusters.length,
  };
}
