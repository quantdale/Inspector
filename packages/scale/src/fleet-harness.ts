import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Action, CapabilityDoc } from "@inspector/protocol";
import { AdapterClient } from "@inspector/adapter-sdk";
import { ArtifactStore } from "@inspector/artifact-store";
import { DEFAULT_POLICY, PolicyEngine, RunController } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type {
  EvidenceBundle,
  Finding,
  OracleSignal,
  RegressionScenario,
} from "@inspector/finding";
import { ExploreController, WebReplayDriver } from "@inspector/explore";
import { ElectronAdapterHandler } from "@inspector/electron-adapter";
import { CliAdapterHandler, MockPtyBackend } from "@inspector/cli-adapter";
import type { PtyBackend } from "@inspector/cli-adapter";
import { AndroidAdapterHandler, AndroidReplayDriver, MockAdbBackend } from "@inspector/android";
import { MockUiaBackend, WindowsAdapterHandler } from "@inspector/windows-adapter";
import { Store } from "@inspector/store-sqlite";

import { LeaseManager } from "./leases.js";
import { ResourceLedger } from "./ledger.js";
import { StateFile, writeJsonAtomic } from "./state-file.js";
import { ModelRouter } from "./router.js";
import type { ModelProvider, ModelRole, UsageEntry } from "./types.js";

/**
 * Fleet campaign harness: drives several independent targets CONCURRENTLY
 * through an unattended, chaos-injected, lease-guarded campaign on one shared
 * durable state directory, using the @inspector/scale primitives directly
 * (LeaseManager, ResourceLedger, StateFile, FileLock indirectly, ModelRouter).
 *
 * HONEST LIMITS: the WEB and ELECTRON lanes drive REAL targets — actual
 * adapter subprocesses (`node --import tsx .../bin.ts`) running Playwright
 * Chromium against the seeded app. The CLI, Android, and Windows lanes run on
 * the project's injectable mock backends (MockPtyBackend, MockAdbBackend,
 * MockUiaBackend): production PTY/ADB/UIA bindings do not exist in this
 * environment (spec blocker policy), and the adapter contracts proven here
 * are identical to the production bindings'.
 */

const here = dirname(fileURLToPath(import.meta.url));
const WEB_BIN = join(here, "..", "..", "adapter-web", "src", "bin.ts");
const ELECTRON_BIN = join(here, "..", "..", "electron-adapter", "src", "bin.ts");

/** The dedicated lease-fencing chaos item; executed outside the queue. */
export const FENCE_ITEM_ID = "fence-probe";

export type LaneKind = "web" | "electron" | "cli" | "android" | "windows";

export interface FleetItem {
  id: string;
  lane: LaneKind;
  seed: number;
  /** Free-form lane script selector (e.g. "explore", "churn", "confirm-boom"). */
  kind: string;
  /** Deterministic ordering key: lower runs first. */
  priority: number;
  /** Items outside the durable queue (chaos chores) are not scheduled. */
  skipQueue?: boolean;
}

export type FailureReason =
  | { kind: "adapter-error"; detail: string }
  | { kind: "budget-exhausted"; detail: string }
  | { kind: "error"; detail: string };

export interface LaneFinding {
  itemId: string;
  lane: LaneKind;
  finding: Finding;
  bundle: EvidenceBundle;
  regression: RegressionScenario;
  /** Path of the frozen evidence bundle JSON on disk. */
  bundlePath: string;
}

export interface LaneOutcome {
  ok: boolean;
  failure?: FailureReason;
  findings?: LaneFinding[];
  notes?: Record<string, unknown>;
}

export interface FleetExecution {
  itemId: string;
  workerId: string;
  attempt: number;
}

export interface FleetFailureRecord {
  itemId: string;
  attempt: number;
  reason: FailureReason;
}

export interface FleetRotation {
  itemId: string;
  attempt: number;
  description: string;
  marker: string;
}

/** Durable campaign state (fleet.json). */
export interface FleetState {
  queue: string[];
  attempts: Record<string, number>;
  executions: FleetExecution[];
  failures: FleetFailureRecord[];
  terminalFailures: string[];
  staleCompletions: number;
  restarts: number;
  findings: LaneFinding[];
  rotations: FleetRotation[];
}

export function emptyFleetState(): FleetState {
  return {
    queue: [],
    attempts: {},
    executions: [],
    failures: [],
    terminalFailures: [],
    staleCompletions: 0,
    restarts: 0,
    findings: [],
    rotations: [],
  };
}

/** Non-critical observability sidecar (also the deliberate-truncation target is a separate probe file). */
export interface RouterTelemetryEvent {
  role: ModelRole;
  provider: string | null;
  fallbacksUsed: string[];
  latencyMs: number;
  tokens: number;
  escalated: boolean;
  error?: string;
}

export interface FleetTelemetry {
  settlements: number;
  routerEvents: RouterTelemetryEvent[];
}

export function emptyFleetTelemetry(): FleetTelemetry {
  return { settlements: 0, routerEvents: [] };
}

export interface SettleInfo {
  life: number;
  itemId: string;
  workerId: string;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Effects ledger: mechanically provable exactly-once externally visible work.
// ---------------------------------------------------------------------------

export type EffectWriteResult = "written" | "duplicate";

export class EffectsLedger {
  /** Marker names successfully created (O_EXCL). */
  readonly written: string[] = [];
  /** Marker names whose creation FAILED because they already exist. */
  readonly duplicates: string[] = [];

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /**
   * Record one externally visible side effect. The marker id is derived
   * deterministically from the effect content; creation uses 'wx' (O_EXCL)
   * semantics, so a duplicate attempt fails the write and is recorded as a
   * DUPLICATE-EFFECT instead of silently succeeding.
   */
  write(effectIdStr: string): EffectWriteResult {
    const name = `${sanitize(effectIdStr)}.effect`;
    let fd: number;
    try {
      fd = openSync(join(this.dir, name), "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        this.duplicates.push(name);
        return "duplicate";
      }
      throw err;
    }
    closeSync(fd);
    this.written.push(name);
    return "written";
  }
}

/** Deterministic externally-visible-effect id: item:kind:contentHash. */
export function effectId(itemId: string, kind: string, content: string): string {
  return `${itemId}:${kind}:${sha12(content)}`;
}

function sha12(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

/** Windows-safe marker file name (':' is not legal in NTFS file names). */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "__");
}

// ---------------------------------------------------------------------------
// Subprocess PID tracking + tracked adapter spawning (real lanes).
// ---------------------------------------------------------------------------

export class PidTracker {
  private readonly entries = new Map<number, string>();

  track(pid: number, label: string): void {
    this.entries.set(pid, label);
  }

  list(): Array<{ pid: number; label: string }> {
    return [...this.entries.entries()].map(([pid, label]) => ({ pid, label }));
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Cleanup proof: every tracked PID must be gone within the bound. */
  async assertAllExited(timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = [...this.entries.keys()].filter((pid) => this.isAlive(pid));
      if (remaining.length === 0) return;
      if (Date.now() > deadline) {
        const detail = remaining
          .map((pid) => `${pid}(${this.entries.get(pid) ?? "?"})`)
          .join(", ");
        throw new Error(`processes still alive after ${timeoutMs}ms: ${detail}`);
      }
      await sleep(250);
    }
  }
}

export interface SpawnedAdapter {
  pid: number;
  caps: CapabilityDoc;
  client: AdapterClient;
  /** Graceful shutdown: lifecycle close, channel close, then process kill. */
  close(): Promise<void>;
  /** Hard kill including the process tree (Playwright chromium children). */
  killTree(): Promise<void>;
}

/**
 * Spawn a REAL adapter subprocess the way AdapterClient.spawn does, but keep
 * the ChildProcess handle so the fleet can prove exit and kill mid-item.
 */
export function spawnTrackedAdapter(
  binPath: string,
  pids: PidTracker,
  label: string,
): Promise<SpawnedAdapter> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", binPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
    if (!proc.pid || !proc.stdout || !proc.stdin) {
      reject(new Error(`failed to spawn adapter subprocess: ${label}`));
      return;
    }
    const pid = proc.pid;
    pids.track(pid, label);
    const client = AdapterClient.overStreams(proc.stdout, proc.stdin);
    let settled = false;
    const bail = (err: Error): void => {
      if (settled) return;
      settled = true;
      void client.close().catch(() => {});
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      reject(err);
    };
    proc.once("error", bail);
    const timer = setTimeout(
      () => bail(new Error(`adapter ${label} did not answer initialize in time`)),
      30000,
    );
    client
      .request<CapabilityDoc>("initialize", {}, 25000)
      .then((caps) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({
          pid,
          caps,
          client,
          close: async () => {
            await client.request("lifecycle", { op: "close" }, 8000).catch(() => {});
            await client.close().catch(() => {});
            if (proc.exitCode === null && !proc.killed) proc.kill();
          },
          killTree: async () => {
            if (process.platform === "win32") {
              // Tree-kill so Playwright's chromium children cannot outlive the
              // adapter subprocess after the chaos injection.
              await new Promise<void>((res) => {
                const tk = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
                  stdio: "ignore",
                });
                tk.once("close", () => res());
                tk.once("error", () => res());
              });
            }
            try {
              proc.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          },
        });
      })
      .catch(bail);
  });
}

// ---------------------------------------------------------------------------
// Model routing with telemetry (chaos d: deterministic fallback + escalation).
// ---------------------------------------------------------------------------

export interface RouteSuccess {
  output: string;
  provider: string;
  fallbacksUsed: string[];
  tokens: number;
  latencyMs: number;
}

export class FleetRouter {
  readonly router = new ModelRouter();
  readonly events: RouterTelemetryEvent[] = [];
  private fastCalls = 0;

  constructor(
    private readonly telemetry: StateFile<FleetTelemetry>,
    private readonly failFirstK: number,
  ) {
    const fast: ModelProvider = {
      id: "prov-fast",
      roles: ["planner"],
      priority: 3,
      costPer1kTokens: 0.01,
      healthy: true,
      complete: async () => {
        this.fastCalls += 1;
        if (this.fastCalls <= this.failFirstK) {
          throw new Error("prov-fast deterministic outage window");
        }
        return "plan-ok";
      },
    };
    const mid: ModelProvider = {
      id: "prov-mid",
      roles: ["planner"],
      priority: 2,
      costPer1kTokens: 0.004,
      healthy: true,
      complete: async () => "mid-plan-ok",
    };
    const dead: ModelProvider = {
      id: "prov-dead",
      roles: ["summarizer"],
      priority: 1,
      costPer1kTokens: 0.002,
      healthy: true,
      complete: async () => {
        throw new Error("prov-dead permanently offline");
      },
    };
    this.router.register(fast).register(mid).register(dead);
  }

  /** Route one call; telemetry is recorded for success AND escalation. */
  async route(role: ModelRole, input: string): Promise<RouteSuccess> {
    const t0 = Date.now();
    const tokens = Math.max(1, Math.ceil(input.length / 4));
    try {
      const res = await this.router.complete(role, input);
      const latencyMs = Date.now() - t0;
      this.record({
        role,
        provider: res.provider.id,
        fallbacksUsed: res.fallbacksUsed,
        latencyMs,
        tokens,
        escalated: false,
      });
      return {
        output: res.output,
        provider: res.provider.id,
        fallbacksUsed: res.fallbacksUsed,
        tokens,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      this.record({
        role,
        provider: null,
        fallbacksUsed: [],
        latencyMs,
        tokens,
        escalated: true,
        error: errorMessage(err),
      });
      throw err;
    }
  }

  /** Escalation-contained variant: null instead of throwing on total outage. */
  async routeContained(role: ModelRole, input: string): Promise<RouteSuccess | null> {
    try {
      return await this.route(role, input);
    } catch {
      return null;
    }
  }

  private record(event: RouterTelemetryEvent): void {
    this.events.push(event);
    this.telemetry.update((t) => {
      t.routerEvents.push(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Fleet controller: durable queue + bounded concurrent lease-guarded workers.
// ---------------------------------------------------------------------------

export interface LaneContext {
  item: FleetItem;
  workerId: string;
  attempt: number;
  /** Per-attempt scratch directory (removed by the controller afterwards). */
  workspace: string;
  effects: EffectsLedger;
  router: FleetRouter;
  pids: PidTracker;
  chaos: ChaosState;
  bundlesDir: string;
  /** Ledger charge; false means the budget would be exceeded. */
  charge(entry: Omit<UsageEntry, "workerId" | "itemId">): boolean;
  /** Record an environment rotation as an externally visible effect. */
  recordRotation(description: string): Promise<void>;
}

export type LaneExecutor = (ctx: LaneContext) => Promise<LaneOutcome>;

/** Mutable chaos switches consulted by the lane executors mid-run. */
export interface ChaosState {
  /** Kill target: the executor for this item kills its own subprocess. */
  killTargetItemId: string | null;
  killArmed: boolean;
  killPid: number | null;
}

export interface FleetControllerOptions {
  stateDir: string;
  /** Controller life (1 = initial); incremented on every restart. */
  life: number;
  items: FleetItem[];
  executors: Partial<Record<LaneKind, LaneExecutor>>;
  workerCount: number;
  ttlMs?: number;
  globalBudget?: ConstructorParameters<typeof ResourceLedger>[1];
  onSettled?: (info: SettleInfo) => void;
}

export interface FleetDeps {
  effects: EffectsLedger;
  router: FleetRouter;
  pids: PidTracker;
  telemetry: StateFile<FleetTelemetry>;
  bundlesDir: string;
  chaos: ChaosState;
}

interface Claimed {
  item: FleetItem;
  generation: number;
  attempt: number;
}

export class FleetController {
  readonly leases: LeaseManager;
  readonly ledger: ResourceLedger;
  readonly stateFile: StateFile<FleetState>;

  private readonly itemsById = new Map<string, FleetItem>();
  private readonly ttlMs: number;
  private readonly workers: Promise<void>[] = [];
  private readonly opts: FleetControllerOptions;

  private abandoned = false;
  private donePromise: Promise<void> | null = null;

  constructor(opts: FleetControllerOptions, private readonly deps: FleetDeps) {
    this.opts = opts;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.leases = new LeaseManager(opts.stateDir, Date.now, this.ttlMs);
    this.ledger = new ResourceLedger(opts.stateDir, opts.globalBudget ?? {});
    this.stateFile = new StateFile<FleetState>(opts.stateDir, "fleet", emptyFleetState);
    for (const item of opts.items) this.itemsById.set(item.id, item);
    this.requeue();
  }

  /** Requeue pending work: not executed, not terminally failed. Retryable
   * failures stay queued so a restarted controller retries them. */
  private requeue(): void {
    this.stateFile.update((s) => {
      const executed = new Set(s.executions.map((e) => e.itemId));
      const terminal = new Set(s.terminalFailures);
      const known = new Set(s.queue);
      const missing = this.opts.items
        .filter((i) => !i.skipQueue)
        .map((i) => i.id)
        .filter((id) => !executed.has(id) && !terminal.has(id) && !known.has(id));
      s.queue = [
        ...s.queue.filter((id) => !executed.has(id) && !terminal.has(id)),
        ...missing,
      ].sort(
        (a, b) =>
          (this.itemsById.get(a)?.priority ?? 0) -
            (this.itemsById.get(b)?.priority ?? 0) ||
          a.localeCompare(b),
      );
    });
  }

  /** Durable restart counter (driver calls this on every resumed life). */
  markRestart(): void {
    this.stateFile.update((s) => {
      s.restarts += 1;
    });
  }

  /** Stop scheduling new work immediately; in-flight items finish as
   * detached orphans whose completions are fenced by the shared durable
   * lease state. run() resolves at once; idle() awaits the orphans. */
  abandon(): void {
    this.abandoned = true;
    this.stopResolve?.();
  }

  private stopResolve: (() => void) | null = null;
  private readonly stoppedPromise: Promise<void> = new Promise((resolve) => {
    this.stopResolve = resolve;
  });

  /** Resolves when the queue drained OR abandon() was honored (whichever is
   * first); detached in-flight claims keep running as orphans either way. */
  run(): Promise<void> {
    if (this.donePromise) return this.donePromise;
    const loops = Array.from({ length: this.opts.workerCount }, (_, i) =>
      this.workerLoop(`fleet-w${this.opts.life}-${i}`),
    );
    this.workers.push(...loops);
    this.donePromise = Promise.race([Promise.all(loops), this.stoppedPromise]).then(
      () => undefined,
    );
    return this.donePromise;
  }

  /** Resolves when every worker loop of this life (incl. orphaned claims) exited. */
  idle(): Promise<void> {
    return Promise.all(this.workers).then(() => undefined);
  }

  loadState(): FleetState {
    return normalize(this.stateFile.load());
  }

  private async workerLoop(workerId: string): Promise<void> {
    for (;;) {
      if (this.abandoned) return;
      const claimed = this.tryClaim(workerId);
      if (!claimed) {
        if (this.abandoned) return;
        if (this.loadState().queue.length === 0) return;
        await sleep(120);
        continue;
      }
      await this.executeClaimed(claimed, workerId);
    }
  }

  /** Scan the queue in priority order and claim the first freely leasable item. */
  private tryClaim(workerId: string): Claimed | null {
    if (this.abandoned) return null;
    for (const id of this.loadState().queue) {
      const acquired = this.leases.acquire(id, workerId);
      if (!acquired.ok) continue; // held elsewhere or already done
      const attempt = this.stateFile.update((s) => {
        s.attempts[id] = (s.attempts[id] ?? 0) + 1;
        return s.attempts[id]!;
      });
      const item = this.itemsById.get(id);
      if (!item) continue;
      return { item, generation: acquired.lease.generation, attempt };
    }
    return null;
  }

  private async executeClaimed(claim: Claimed, workerId: string): Promise<void> {
    const { item, generation, attempt } = claim;
    const ws = mkdtempSync(join(tmpdir(), `fleet-${sanitize(item.id)}-a${attempt}-`));
    const renew = setInterval(() => {
      this.leases.renew(item.id, workerId, generation);
    }, Math.max(500, Math.floor(this.ttlMs / 3)));
    let outcome: LaneOutcome;
    try {
      const executor = this.opts.executors[item.lane];
      if (!executor) throw new Error(`no executor registered for lane '${item.lane}'`);
      outcome = await executor(this.makeContext(item, workerId, attempt, ws));
    } catch (err) {
      outcome = { ok: false, failure: { kind: "error", detail: errorMessage(err) } };
    } finally {
      clearInterval(renew);
    }
    rmSync(ws, { recursive: true, force: true });
    this.settle(item, workerId, generation, attempt, outcome);
  }

  private makeContext(item: FleetItem, workerId: string, attempt: number, ws: string): LaneContext {
    return {
      item,
      workerId,
      attempt,
      workspace: ws,
      effects: this.deps.effects,
      router: this.deps.router,
      pids: this.deps.pids,
      chaos: this.deps.chaos,
      bundlesDir: this.deps.bundlesDir,
      charge: (entry) => this.ledger.charge({ ...entry, workerId, itemId: item.id }),
      recordRotation: async (description) => {
        const marker = this.deps.effects.write(
          effectId(item.id, "env-rotation", `${attempt}|${description}`),
        );
        this.stateFile.update((s) => {
          s.rotations.push({ itemId: item.id, attempt, description, marker });
        });
      },
    };
  }

  /**
   * Settlement is the ONLY path that records externally visible outcomes, and
   * it runs exclusively under a live lease generation: a stale holder's
   * completion is counted (staleCompletions) and never applied.
   */
  private settle(
    item: FleetItem,
    workerId: string,
    generation: number,
    attempt: number,
    outcome: LaneOutcome,
  ): void {
    if (outcome.ok) {
      const completed = this.leases.complete(item.id, workerId, generation);
      if (completed) {
        this.stateFile.update((s) => {
          s.executions.push({ itemId: item.id, workerId, attempt });
          for (const f of outcome.findings ?? []) s.findings.push(f);
          s.queue = s.queue.filter((q) => q !== item.id);
        });
        this.deps.effects.write(
          effectId(item.id, "item-completed", `${item.id}|${workerId}|${attempt}`),
        );
        this.deps.telemetry.update((t) => {
          t.settlements += 1;
        });
        this.opts.onSettled?.({ life: this.opts.life, itemId: item.id, workerId, ok: true });
      } else {
        // Our lease expired and was reclaimed mid-run: the current holder owns
        // the outcome. Count the stale completion; never apply the work.
        this.stateFile.update((s) => {
          s.staleCompletions += 1;
        });
        console.info(
          `[fleet] stale completion fenced out: item=${item.id} worker=${workerId} gen=${generation}`,
        );
      }
      return;
    }

    const terminal = outcome.failure?.kind === "budget-exhausted";
    this.leases.release(item.id, workerId);
    this.stateFile.update((s) => {
      s.failures.push({
        itemId: item.id,
        attempt,
        reason: outcome.failure ?? { kind: "error", detail: "unknown" },
      });
      if (terminal && !s.terminalFailures.includes(item.id)) {
        s.terminalFailures.push(item.id);
        s.queue = s.queue.filter((q) => q !== item.id);
      }
    });
    this.deps.telemetry.update((t) => {
      t.settlements += 1;
    });
    this.opts.onSettled?.({ life: this.opts.life, itemId: item.id, workerId, ok: false });
  }
}

function normalize(raw: FleetState): FleetState {
  const base = emptyFleetState();
  return {
    ...base,
    ...raw,
    attempts: raw.attempts ?? base.attempts,
  };
}

// ---------------------------------------------------------------------------
// Chaos chore (c): TTL expiry -> reclaim -> generation-fenced stale completion.
// ---------------------------------------------------------------------------

export interface FenceProbeResult {
  reclaimedByChaos: boolean;
  staleCompletionRejected: boolean;
}

/**
 * An artificially slowed worker acquires the probe item with a short-TTL
 * LeaseManager, stalls past the TTL, and a chaos reclaimer takes the item
 * over. The original's late complete() must be rejected by generation
 * fencing and only counted — the reclaimer's completion is the one
 * externally visible effect for this item.
 */
export async function runFenceProbe(opts: {
  stateDir: string;
  ttlMs: number;
  stallMs: number;
  effects: EffectsLedger;
}): Promise<FenceProbeResult> {
  const { stateDir, ttlMs, stallMs, effects } = opts;
  const shortLeases = new LeaseManager(stateDir, Date.now, ttlMs);
  const stateFile = new StateFile<FleetState>(stateDir, "fleet", emptyFleetState);

  const first = shortLeases.acquire(FENCE_ITEM_ID, "worker-slow");
  if (!first.ok) throw new Error(`fence probe: initial acquire failed (${first.reason})`);

  const reclaimer = (async (): Promise<boolean> => {
    while (Date.now() < first.lease.expiresAtMs + 25) await sleep(20);
    const second = shortLeases.acquire(FENCE_ITEM_ID, "chaos-reclaimer");
    if (!second.ok) return false;
    const done = shortLeases.complete(FENCE_ITEM_ID, "chaos-reclaimer", second.lease.generation);
    if (!done) return false;
    effects.write(effectId(FENCE_ITEM_ID, "item-completed", "chaos-reclaimer|1"));
    stateFile.update((s) => {
      s.executions.push({ itemId: FENCE_ITEM_ID, workerId: "chaos-reclaimer", attempt: 1 });
    });
    return true;
  })();

  await sleep(stallMs); // the artificially slowed worker
  const staleRejected = !shortLeases.complete(
    FENCE_ITEM_ID,
    "worker-slow",
    first.lease.generation,
  );
  if (staleRejected) {
    stateFile.update((s) => {
      s.staleCompletions += 1;
    });
  }
  const reclaimed = await reclaimer;
  return { reclaimedByChaos: reclaimed, staleCompletionRejected: staleRejected };
}

// ---------------------------------------------------------------------------
// Durable-state integrity audit (runs between controller lives and at end).
// ---------------------------------------------------------------------------

/** Every durable state file must parse as valid JSON at any observation point. */
export function auditStateFiles(stateDir: string, label: string): void {
  for (const name of ["fleet", "leases", "ledger"]) {
    const raw = readFileSync(join(stateDir, `${name}.json`), "utf8");
    JSON.parse(raw) as unknown;
  }
  const telemetryPath = join(stateDir, "telemetry.json");
  if (readdirSync(stateDir).includes("telemetry.json")) {
    JSON.parse(readFileSync(telemetryPath, "utf8")) as unknown;
  }
  console.info(`[fleet] audit(${label}): fleet/leases/ledger/telemetry parse clean`);
}

// ---------------------------------------------------------------------------
// Resource sampling (generous documented ceilings, not perf assertions).
// ---------------------------------------------------------------------------

export interface ResourceSample {
  rssMb: number;
  handles: number;
  tempRoots: number;
}

export function sampleResources(tempPrefix: string): ResourceSample {
  return {
    rssMb: process.memoryUsage().rss / (1024 * 1024),
    handles: process.getActiveResourcesInfo().length,
    tempRoots: readdirSync(tmpdir()).filter((f) => f.startsWith(tempPrefix)).length,
  };
}

// ---------------------------------------------------------------------------
// Lane executors.
// ---------------------------------------------------------------------------

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function expectLike(condition: boolean, message: string): void {
  if (!condition) throw new Error(`lane assertion failed: ${message}`);
}

/** Budget admission is part of lane logic: a refused charge fails the item
 * durably as a TERMINAL budget-exhaustion instead of silently continuing. */
function chargeOrBudgetFail(
  ctx: LaneContext,
  entry: Omit<UsageEntry, "workerId" | "itemId">,
): LaneOutcome | null {
  return ctx.charge(entry)
    ? null
    : { ok: false, failure: { kind: "budget-exhausted", detail: "resource budget exhausted mid-item" } };
}

/**
 * LANES 1: WEB-REAL. Spawns the real web adapter subprocess (fresh seeded app
 * instance on an ephemeral port + fresh browser context per attempt) and
 * drives a SHORT ExploreController campaign with reduced budgets.
 */
export function makeWebExecutor(common: {
  pids: PidTracker;
  effects: EffectsLedger;
  bundlesDir: string;
  chaos: ChaosState;
}): LaneExecutor {
  return async (ctx) => {
    const spawned = await spawnTrackedAdapter(
      WEB_BIN,
      common.pids,
      `web:${ctx.item.id}:a${ctx.attempt}`,
    );
    const store = Store.open(join(ctx.workspace, "runs.db"));
    let run: RunController | null = null;
    try {
      await spawned.client.request("lifecycle", { op: "create" }, 30000);

      // The direct RunController construction skips RunManager, so the durable
      // run/environment rows must exist before any step commit (FK enforced).
      const runId = `run-${ctx.item.id}-a${ctx.attempt}`;
      const envId = `env-${ctx.item.id}-a${ctx.attempt}`;
      store.createRun({ id: runId, adapter: spawned.caps.adapter });
      store.createEnvironment({ id: envId, runId, adapter: spawned.caps.adapter });

      // CHAOS (b): kill the adapter subprocess mid-item, exactly once. The
      // item must classify as adapter-error, stay durably recorded, and be
      // retried by a later worker with a FRESH environment.
      if (common.chaos.killArmed && common.chaos.killTargetItemId === ctx.item.id) {
        common.chaos.killArmed = false;
        common.chaos.killPid = spawned.pid;
        await spawned.killTree();
        return {
          ok: false,
          failure: {
            kind: "adapter-error",
            detail: `web adapter subprocess pid=${spawned.pid} killed mid-item by chaos injection`,
          },
        };
      }

      run = new RunController(
        store,
        new ArtifactStore(join(ctx.workspace, "artifacts")),
        new PolicyEngine(DEFAULT_POLICY),
        {
          runId,
          envId,
          adapter: spawned.client,
          caps: spawned.caps,
        },
      );
      const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
      const explorer = new ExploreController({
        run,
        store,
        findingEngine,
        config: {
          seed: ctx.item.seed,
          maxActions: 45,
          maxWallMs: 45000,
          maxFindings: 2,
          maxResets: 8,
          reproducibleAttempts: 1,
          reproducibleMinSuccesses: 1,
          noveltyPlateauLimit: 15,
          observeFields: ["url", "title", "uiTree", "storage", "pageErrors", "screenshot"],
        },
        replayDriverFactory: () =>
          new WebReplayDriver({ artifactBaseDir: join(ctx.workspace, "replay-artifacts") }),
      });

      // CHAOS (d): planner role routed through the flaky provider chain.
      const plan = await ctx.router.route("planner", `plan ${ctx.item.id} seed=${ctx.item.seed}`);
      const budgetFail = chargeOrBudgetFail(ctx, { modelRequests: 1, tokens: plan.tokens });
      if (budgetFail) return budgetFail;

      const result = await explorer.run_();
      await ctx.recordRotation(
        `fresh seeded-app subprocess pid=${spawned.pid}: ephemeral port + fresh browser context`,
      );

      // Real artifact refs captured at confirmation time from the live session.
      const shot = (await spawned.client.request(
        "observe",
        { observe: ["screenshot"] },
        20000,
      )) as { artifacts?: Array<{ sha256: string }> };
      const artifactRefs = (shot.artifacts ?? []).map((a) => a.sha256);

      const findings: LaneFinding[] = [];
      for (let i = 0; i < result.findings.length; i++) {
        const finding = result.findings[i]!;
        const rawBundle = result.evidenceBundles[i];
        const regression = result.regressionScenarios[i];
        if (!rawBundle || !regression) continue;
        // Re-freeze the bundle with the confirmation-time artifact refs.
        const bundle = findingEngine.buildBundle(
          finding,
          rawBundle.originalSteps,
          rawBundle.minimizedSteps,
          {
            signals: [...rawBundle.oracleEvidence],
            artifactRefs,
            replayCommand: rawBundle.replayCommand,
          },
        );
        const bundlePath = join(common.bundlesDir, `${finding.id}.json`);
        writeJsonAtomic(bundlePath, bundle);
        common.effects.write(effectId(ctx.item.id, "finding-confirmed", finding.signature ?? finding.id));
        common.effects.write(effectId(ctx.item.id, "evidence-bundle", finding.id));
        findings.push({ itemId: ctx.item.id, lane: "web", finding, bundle, regression, bundlePath });
      }

      await run.close();
      run = null;
      console.info(
        `[fleet] web item ${ctx.item.id} done: stopped=${result.stoppedReason} actions=${result.actionsExecuted} findings=${findings.length}`,
      );
      return {
        ok: true,
        findings,
        notes: {
          stoppedReason: result.stoppedReason,
          actionsExecuted: result.actionsExecuted,
          anomalies: result.anomalies.length,
        },
      };
    } catch (e) {
      return {
        ok: false,
        failure: {
          kind: "adapter-error",
          detail: `web item ${ctx.item.id} crashed: ${errorMessage(e)}`,
        },
      };
    } finally {
      store.close();
    }
  };
}

/**
 * LANES 2: ELECTRON-REAL. Drives the real electron adapter subprocess through
 * observe/act cycles against the seeded app, then classifies its one-shot
 * crash fault (the fault latch lives in the in-process handler; the stock bin
 * spawns without faults).
 */
export function makeElectronExecutor(common: { pids: PidTracker }): LaneExecutor {
  return async (ctx) => {
    const spawned = await spawnTrackedAdapter(
      ELECTRON_BIN,
      common.pids,
      `electron:${ctx.item.id}`,
    );
    try {
      expectLike(
        spawned.caps.adapter === "electron-chromium",
        `electron identity mismatch: ${String(spawned.caps.adapter)}`,
      );
      await spawned.client.request("lifecycle", { op: "create" }, 30000);
      await spawned.client.request(
        "act",
        { action: act("e1", "fill", { selector: "#username", value: "admin" }) },
        15000,
      );
      await spawned.client.request(
        "act",
        { action: act("e2", "fill", { selector: "#password", value: "admin" }) },
        15000,
      );
      await spawned.client.request(
        "act",
        { action: act("e3", "click", { selector: "#loginBtn" }) },
        15000,
      );
      const dash = (await spawned.client.request(
        "observe",
        { observe: ["uiTree", "screenshot"] },
        20000,
      )) as { summary: { uiTree: Array<{ id?: string; hidden?: boolean }> }; artifacts?: Array<{ sha256: string }> };
      const inc = dash.summary.uiTree.find((el) => el.id === "increment");
      expectLike(!!inc && inc.hidden === false, "electron lane: dashboard not reached");
      expectLike(
        (dash.artifacts ?? []).length > 0,
        "electron lane: no screenshot artifact captured",
      );
      await ctx.recordRotation(`fresh electron renderer context pid=${spawned.pid}`);
      await spawned.client.request("lifecycle", { op: "reset" }, 15000);
      const back = (await spawned.client.request(
        "observe",
        { observe: ["uiTree"] },
        20000,
      )) as { summary: { uiTree: Array<{ id?: string }> } };
      expectLike(
        back.summary.uiTree.some((el) => el.id === "loginBtn"),
        "electron lane: reset did not restore the seeded baseline",
      );
      const plan = await ctx.router.route("planner", `plan ${ctx.item.id}`);
      const budgetFail = chargeOrBudgetFail(ctx, { modelRequests: 1, tokens: plan.tokens });
      if (budgetFail) return budgetFail;
      // CHAOS (d): summarizer role has one permanently-dead provider -> the
      // route escalates; the lane contains the escalation per policy.
      const summary = await ctx.router.routeContained("summarizer", `summarize ${ctx.item.id}`);
      expectLike(summary === null, "summarizer total outage must escalate");
    } finally {
      await spawned.close();
    }

    // One-shot crash fault classification: FIRST act crashes (adapter-crash),
    // the latch is consumed, and the SECOND act reaches the app again.
    const crashing = new ElectronAdapterHandler(
      { crashApp: true },
      join(ctx.workspace, "crash-artifacts"),
    );
    try {
      await crashing.initialize();
      await crashing.lifecycle({ op: "create" });
      let firstError = "";
      try {
        await crashing.act({ action: act("c1", "click", { selector: "#loginBtn" }) });
      } catch (err) {
        firstError = errorMessage(err);
      }
      expectLike(
        /adapter-crash/.test(firstError),
        `electron one-shot crash misclassified: ${firstError || "no error raised"}`,
      );
      const second = await crashing.act({ action: act("c2", "click", { selector: "#loginBtn" }) });
      expectLike(second.status === "success", "electron post-crash act must recover");
    } finally {
      await crashing.shutdown().catch(() => {});
    }
    await ctx.recordRotation("electron relaunch after one-shot crash fault");
    return { ok: true, findings: [] };
  };
}

/**
 * LANES 3: CLI-MOCK (injectable MockPtyBackend; production PTY binding does
 * not exist in this environment). Action churn including the double-crash
 * freshness case, huge scrollback, and EOF.
 */
export function makeCliExecutor(): LaneExecutor {
  return async (ctx) => {
    const artBase = join(ctx.workspace, "artifacts");
    switch (ctx.item.kind) {
      case "churn": {
        const handler = new CliAdapterHandler(new MockPtyBackend(), artBase);
        await handler.lifecycle({
          op: "create",
          options: { runId: `run-${ctx.item.id}`, environmentId: `env-${ctx.item.id}` },
        });
        const m1 = await handler.act({ action: act("m1", "fill", { value: "definitely-not-a-command" }) });
        const m2 = await handler.act({ action: act("m2", "fill", { value: "definitely-not-a-command" }) });
        expectLike(
          m1.status === "target-failure" && m1.error?.code === "ACTION_FAILED",
          "cli automation miss must be ACTION_FAILED",
        );
        expectLike(
          m2.status === "target-failure" &&
            m2.error?.code === "ACTION_FAILED" &&
            m2.error?.message === m1.error?.message,
          "cli repeated miss must stay identically classified",
        );
        await handler.act({ action: act("l1", "fill", { value: "login admin admin" }) });
        const obs = await handler.observe({});
        expectLike(obs.runId === `run-${ctx.item.id}`, "cli attribution threading");
        const boom = await handler.act({ action: act("b1", "fill", { value: "boom" }) });
        expectLike(
          boom.status === "target-failure" &&
            boom.error?.code === "TARGET_FAILURE" &&
            /IntentionalAppCrash/.test(boom.error?.message ?? ""),
          "cli boom crash classification",
        );
        // Double-crash freshness: replaying after the fatal stays the SAME
        // fatal (never flips to a generic session-not-alive failure).
        const replay = await handler.act({ action: act("b2", "fill", { value: "count" }) });
        expectLike(
          replay.status === "target-failure" &&
            replay.error?.code === "TARGET_FAILURE" &&
            replay.error?.message === boom.error?.message,
          "cli double-crash freshness",
        );
        const budgetFail = chargeOrBudgetFail(ctx, { actions: 6, modelRequests: 1, tokens: 40 });
        if (budgetFail) return budgetFail;
        await ctx.router.route("planner", `plan ${ctx.item.id}`);
        await ctx.recordRotation("fresh PTY session (mock backend)");
        return { ok: true, findings: [] };
      }
      case "overflow": {
        const backend = new MockPtyBackend();
        const handler = new CliAdapterHandler(backend, artBase);
        await handler.lifecycle({ op: "create" });
        await handler.act({ action: act("l1", "fill", { value: "login admin admin" }) });
        let last = { status: "success" } as { status: string; error?: { code?: string; message?: string } };
        for (let i = 0; i < 9; i++) {
          last = (await handler.act({
            action: act(`inc${i}`, "fill", { value: "inc" }),
          })) as typeof last;
          if (last.status === "target-failure") break;
        }
        expectLike(
          last.status === "target-failure" &&
            last.error?.code === "TARGET_FAILURE" &&
            /IncrementOverflowCrash/.test(last.error?.message ?? ""),
          "cli counter overflow aborts at the boundary",
        );
        // Huge scrollback: observation stays bounded to the visible window.
        const spy = backend as unknown as { sessions?: Map<string, { lines: string[] }> };
        const session = [...(spy.sessions?.values() ?? [])][0];
        for (let i = 0; i < 5000; i++) session?.lines.push(`noise line ${i}`);
        const noisy = await handler.observe({});
        const tree = (noisy.summary as { uiTree: unknown[] }).uiTree;
        expectLike(tree.length <= 13, "huge scrollback must stay bounded");
        const overflowBudget = chargeOrBudgetFail(ctx, { actions: 10, modelRequests: 1, tokens: 40 });
        if (overflowBudget) return overflowBudget;
        await ctx.router.route("planner", `plan ${ctx.item.id}`);
        await ctx.recordRotation("fresh PTY session after overflow abort");
        return { ok: true, findings: [] };
      }
      case "eof": {
        // EOF mid-session: the screen model surfaces the fatal, classified as
        // a genuine target defect rather than an adapter error.
        const eofBackend: PtyBackend = {
          spawn: async () => ({ id: "pty-eof" }),
          write: async () => {},
          readScreen: async () => ["[process exited]", "FATAL IncrementOverflowCrash"],
          isAlive: async () => false,
          kill: async () => {},
        };
        const handler = new CliAdapterHandler(eofBackend, artBase);
        await handler.lifecycle({ op: "create" });
        const outcome = await handler.act({ action: act("e1", "fill", { value: "count" }) });
        expectLike(
          outcome.status === "target-failure" &&
            outcome.error?.code === "TARGET_FAILURE" &&
            /IncrementOverflowCrash/.test(outcome.error?.message ?? ""),
          "EOF mid-session crash classification",
        );
        const eofBudget = chargeOrBudgetFail(ctx, { actions: 2, modelRequests: 1, tokens: 20 });
        if (eofBudget) return eofBudget;
        await ctx.router.route("planner", `plan ${ctx.item.id}`);
        await ctx.recordRotation("fresh PTY session (EOF fixture)");
        return { ok: true, findings: [] };
      }
      default:
        throw new Error(`unknown cli item kind: ${ctx.item.kind}`);
    }
  };
}

/**
 * LANES 4: ANDROID-MOCK (injectable MockAdbBackend; production ADB binding
 * does not exist in this environment). Confirms both seeded defects through
 * AndroidReplayDriver + rotation/process-death/reset churn.
 */
/** Host path of the seeded Android fixture APK (mock backend treats it symbolically). */
const SEED_APK_PATH = "/fixtures/seeddroid.apk";

export function makeAndroidExecutor(common: { effects: EffectsLedger; bundlesDir: string }): LaneExecutor {
  return async (ctx) => {
    switch (ctx.item.kind) {
      case "confirm-boom":
        return androidConfirm(ctx, common, "boom");
      case "confirm-overflow":
        return androidConfirm(ctx, common, "overflow");
      case "rotation":
        return androidRotation(ctx);
      default:
        throw new Error(`unknown android item kind: ${ctx.item.kind}`);
    }
  };
}

async function androidConfirm(
  ctx: LaneContext,
  common: { effects: EffectsLedger; bundlesDir: string },
  defect: "boom" | "overflow",
): Promise<LaneOutcome> {
  const backend = new MockAdbBackend();
  const handler = new AndroidAdapterHandler(backend, {}, join(ctx.workspace, "artifacts"));
  try {
    // Seeded-conformance lane: install the seed APK explicitly (lifecycle
    // seeding is opt-in since the AndroidLifecycleOptions change).
    await handler.lifecycle({ op: "create", options: { seedApk: SEED_APK_PATH } });
    await handler.act({ action: act("a1", "fill", { selector: "#username", value: "admin" }) });
    await handler.act({ action: act("a2", "fill", { selector: "#password", value: "admin" }) });
    await handler.act({ action: act("a3", "click", { selector: "#login" }) });
    let trigger = { status: "success" } as { status: string; error?: { code?: string; message?: string } };
    if (defect === "boom") {
      trigger = (await handler.act({ action: act("a4", "click", { selector: "#boom" }) })) as typeof trigger;
    } else {
      for (let i = 0; i < 8; i++) {
        trigger = (await handler.act({
          action: act(`inc${i}`, "click", { selector: "#increment" }),
        })) as typeof trigger;
        if (trigger.status === "target-failure") break;
      }
    }
    const expectedToken = defect === "boom" ? "IntentionalAppCrash" : "IncrementOverflowCrash";
    expectLike(
      trigger.status === "target-failure" && trigger.error?.code === "TARGET_FAILURE",
      `android ${defect} must surface as TARGET_FAILURE`,
    );
    const serial = (await backend.devices())[0]!;
    expectLike(
      (await backend.appErrors(serial)).some((e) => e.includes(expectedToken)),
      `android ${defect} must appear in appErrors`,
    );

    // Real artifact: screenshot of the crashed device screen through the
    // project's artifact store.
    const png = await backend.screencap();
    const artifacts = new ArtifactStore(join(ctx.workspace, "confirm-artifacts"));
    const meta = artifacts.write({
      runId: `run-${ctx.item.id}`,
      content: png,
      mime: "image/png",
      name: `confirm-${defect}.png`,
    });

    // Standard reproduction policy against a FRESH mock device.
    const engine = new FindingEngine(OracleEngine.defaults());
    const signal: OracleSignal = { kind: "PAGE_ERROR", detail: expectedToken };
    const finding = engine.ingest(signal, {
      runId: `run-${ctx.item.id}`,
      title: `SeedDroid ${defect} crash`,
      adapter: "android-uiautomator",
    });
    const path: Action[] =
      defect === "boom"
        ? [
            act("s1", "fill", { selector: "#username", value: "admin" }),
            act("s2", "fill", { selector: "#password", value: "admin" }),
            act("s3", "click", { selector: "#login" }),
            act("s4", "click", { selector: "#boom" }),
          ]
        : [
            act("t1", "fill", { selector: "#username", value: "admin" }),
            act("t2", "fill", { selector: "#password", value: "admin" }),
            act("t3", "click", { selector: "#login" }),
            ...Array.from({ length: 8 }, (_, i) =>
              act(`i${i}`, "click", { selector: "#increment" }),
            ),
          ];
    const driver = new AndroidReplayDriver({
      artifactBaseDir: join(ctx.workspace, "replay-artifacts"),
      createOptions: { seedApk: SEED_APK_PATH },
    });
    const rep = await engine.reproduce(finding, path, driver, { attempts: 1, minSuccesses: 1 });
    expectLike(rep.finding.status === "CONFIRMED", `android ${defect} reproduction must confirm`);
    const minimized = await engine.minimize(rep.finding, path, driver);
    let confirmed = rep.finding;
    if (rep.finding.status === "MINIMIZED" && rep.finding.minimization?.verifiedReproduction === true) {
      confirmed = engine.transition(rep.finding, "CONFIRMED", {
        reason: "minimization verified reproduction",
      });
    }
    const bundle = engine.buildBundle(confirmed, path, minimized, {
      signals: [...rep.lastSignals, signal],
      artifactRefs: [meta.sha256],
      replayCommand: `inspector replay --finding ${confirmed.id}`,
    });
    const regression = engine.exportRegression(confirmed, minimized, "PAGE_ERROR", {
      adapter: "android-uiautomator",
    });
    const bundlePath = join(common.bundlesDir, `${confirmed.id}.json`);
    writeJsonAtomic(bundlePath, bundle);
    common.effects.write(effectId(ctx.item.id, "finding-confirmed", confirmed.signature ?? confirmed.id));
    common.effects.write(effectId(ctx.item.id, "evidence-bundle", confirmed.id));

    const confirmBudget = chargeOrBudgetFail(ctx, {
      actions: defect === "boom" ? 6 : 12,
      modelRequests: 1,
      tokens: 40,
    });
    if (confirmBudget) return confirmBudget;
    await ctx.router.route("planner", `plan ${ctx.item.id}`);
    await ctx.recordRotation(`fresh mock device for ${defect} confirmation`);
    return {
      ok: true,
      findings: [
        { itemId: ctx.item.id, lane: "android", finding: confirmed, bundle, regression, bundlePath },
      ],
    };
  } finally {
    await handler.lifecycle({ op: "close" }).catch(() => {});
  }
}

async function androidRotation(ctx: LaneContext): Promise<LaneOutcome> {
  const backendA = new MockAdbBackend();
  const handlerA = new AndroidAdapterHandler(backendA, {}, join(ctx.workspace, "artifacts"));
  await handlerA.lifecycle({ op: "create", options: { seedApk: SEED_APK_PATH } });
  await handlerA.act({ action: act("r1", "fill", { selector: "#username", value: "admin" }) });
  await handlerA.act({ action: act("r2", "fill", { selector: "#password", value: "admin" }) });
  await handlerA.act({ action: act("r3", "click", { selector: "#login" }) });
  await handlerA.act({ action: act("r4", "click", { selector: "#increment" }) });

  // Environment rotation: package-data reset restores the seeded baseline.
  await handlerA.lifecycle({ op: "reset", options: { seedApk: SEED_APK_PATH } });
  const baseline = await handlerA.observe({ observe: ["uiTree"] });
  const ids = (baseline.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((el) => el.id);
  expectLike(ids.includes("login") && !ids.includes("increment"), "android reset must restore baseline");
  await ctx.recordRotation("package-data reset to seeded baseline");

  // Process death: the device goes offline mid-session; the failure must
  // surface instead of a silent success.
  backendA.deviceCrashed = true;
  const dead = await handlerA.act({ action: act("r5", "click", { selector: "#increment" }) });
  expectLike(dead.status !== "success", "device-offline must not report success");
  await handlerA.lifecycle({ op: "close" }).catch(() => {});

  // Emulator process restart: a FRESH backend restores a working baseline.
  const backendB = new MockAdbBackend();
  const handlerB = new AndroidAdapterHandler(backendB, {}, join(ctx.workspace, "artifacts"));
  try {
    await handlerB.lifecycle({ op: "create", options: { seedApk: SEED_APK_PATH } });
    const revived = await handlerB.observe({ observe: ["uiTree"] });
    const revivedIds = (revived.summary as { uiTree: Array<{ id?: string }> }).uiTree.map(
      (el) => el.id,
    );
    expectLike(revivedIds.includes("login"), "fresh device must restore the baseline");
  } finally {
    await handlerB.lifecycle({ op: "close" }).catch(() => {});
  }
  await ctx.recordRotation("emulator process death + fresh device instance");

  const rotationBudget = chargeOrBudgetFail(ctx, { actions: 5, modelRequests: 1, tokens: 30 });
  if (rotationBudget) return rotationBudget;
  await ctx.router.route("planner", `plan ${ctx.item.id}`);
  return { ok: true, findings: [] };
}

/**
 * LANES 5: WINDOWS-MOCK (injectable MockUiaBackend; production UIA binding
 * does not exist in this environment). Basic churn: traversal, the counter
 * overflow defect, reset, and an automation miss.
 */
export function makeWindowsExecutor(): LaneExecutor {
  return async (ctx) => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), join(ctx.workspace, "artifacts"));
    try {
      await handler.lifecycle({ op: "create" });
      if (ctx.item.kind === "churn") {
        await handler.act({ action: act("w1", "fill", { selector: "#username", value: "admin" }) });
        await handler.act({ action: act("w2", "fill", { selector: "#password", value: "admin" }) });
        await handler.act({ action: act("w3", "click", { selector: "#loginBtn" }) });
        let last = { status: "success" } as { status: string; error?: { code?: string; message?: string } };
        for (let i = 0; i < 9; i++) {
          last = (await handler.act({
            action: act(`inc${i}`, "click", { selector: "#incrementBtn" }),
          })) as typeof last;
          if (last.status === "target-failure") break;
        }
        expectLike(
          last.status === "target-failure" &&
            last.error?.code === "TARGET_FAILURE" &&
            /IncrementOverflowCrash/.test(last.error?.message ?? ""),
          "windows counter overflow must surface through the UIA boundary",
        );
        await handler.lifecycle({ op: "reset" });
        const obs = await handler.observe({ observe: ["uiTree"] });
        const ids = (obs.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((el) => el.id);
        expectLike(ids.includes("loginBtn"), "windows reset must restore the baseline");
        const churnBudget = chargeOrBudgetFail(ctx, { actions: 12, modelRequests: 1, tokens: 30 });
        if (churnBudget) return churnBudget;
        await ctx.router.route("planner", `plan ${ctx.item.id}`);
        await ctx.recordRotation("fresh UIA dialog (mock backend)");
        return { ok: true, findings: [] };
      }
      if (ctx.item.kind === "miss") {
        const miss = await handler.act({
          action: act("w-miss", "click", { selector: "#nonexistent" }),
        });
        expectLike(
          miss.status === "target-failure" && miss.error?.code === "ACTION_FAILED",
          "windows automation miss must be ACTION_FAILED, not a defect",
        );
        const missBudget = chargeOrBudgetFail(ctx, { actions: 4, modelRequests: 1, tokens: 20 });
        if (missBudget) return missBudget;
        await ctx.router.route("planner", `plan ${ctx.item.id}`);
        await ctx.recordRotation("fresh UIA dialog (miss fixture)");
        return { ok: true, findings: [] };
      }
      throw new Error(`unknown windows item kind: ${ctx.item.kind}`);
    } finally {
      await handler.lifecycle({ op: "close" }).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// Misc.
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
