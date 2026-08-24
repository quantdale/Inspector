import type { Finding } from "@inspector/finding";
import type { UsageEntry } from "./types.js";

/**
 * M12 F1 execution contract. The scale scheduler owns queueing, priorities,
 * worker ownership, leasing/fencing, budgets, cancellation, resume, lifecycle
 * state and durable accounting; a {@link WorkItemExecutor} owns resolving the
 * workflow, resolving the adapter/target, constructing the environment,
 * invoking the real engine, and returning structured results.
 *
 * The deterministic fake executor is ONE implementation behind this contract —
 * the scheduler has no fundamental knowledge of any specific adapter handler
 * or workflow engine.
 */

/** Why an item could not be executed or completed (M12 F1 taxonomy). */
export type WorkItemFailureClass =
  | "capability-unavailable"
  | "target-incompatible"
  | "environment-unavailable"
  | "target-config-invalid"
  | "execution-failure"
  | "policy-refusal"
  | "budget-exhausted";

/** Coarse adapter family a work item targets. */
export type AdapterFamily =
  | "fake"
  | "web"
  | "cli"
  | "windows"
  | "android"
  | "electron";

export interface WorkerCapabilitySnapshot {
  /** Executor implementation id (e.g. "fake-fixture", "inspector-workflow"). */
  executorId: string;
  /** Adapter families this worker can genuinely execute. */
  families: AdapterFamily[];
  /** Fine-grained capability tags (browser, pty, uia, adb, electron, ...). */
  capabilities: string[];
  available: boolean;
  detail?: string;
}

/** Usage an executor asks the scheduler to charge to the ledger. */
export type ItemUsage = Omit<UsageEntry, "workerId" | "itemId">;

export interface ExecutionContext {
  itemId: string;
  workerId: string;
  /** 1-based attempt count for this item in this campaign life. */
  attempt: number;
  /** Lease fencing generation this execution holds (undefined = unfenced). */
  leaseGeneration?: number;
  /**
   * Per-item isolated workspace directory created by the scheduler under the
   * campaign artifacts root. Executors must keep all durable writes inside it
   * unless the item explicitly requires an external path.
   */
  workspaceDir: string;
  /** Campaign-level artifacts directory (bundles/evidence that must persist). */
  artifactsDir: string;
  /**
   * Charge resource usage. Returns false when a configured budget would be
   * exceeded; executors must stop cleanly with `budget-exhausted`.
   */
  charge(usage: ItemUsage): boolean;
  /**
   * Permission check WITHOUT accounting (HARDENING_2): would this usage be
   * admitted right now against global/worker/item budgets? Executors MUST
   * obtain permission through this before starting any budgeted unit of work,
   * then record actual consumption with {@link charge}.
   */
  admit(usage: ItemUsage): boolean;
  /** Extend this item's lease; false means the generation was lost (fenced). */
  renewLease(): boolean;
  /**
   * Persist partial findings so a crash later in the item cannot lose work
   * already committed by the underlying engines.
   */
  persistPartial(findings: Finding[]): void;
  /** Aborted when the operator (or wall clock) requests cooperative cancel. */
  signal: AbortSignal;
  /** Progress sink (human-readable; stderr in the CLI). */
  progress(line: string): void;
  now(): number;
}

export interface WorkItemResult {
  ok: boolean;
  failureClass?: WorkItemFailureClass;
  failureDetail?: string;
  /** Findings produced by this attempt (already durable in per-item stores). */
  findings: Finding[];
  /** Evidence bundle paths for {@link findings}, keyed 1:1 by order. */
  evidencePaths: string[];
  /** Run IDs created inside the isolated context. */
  runIds: string[];
  usage: ItemUsage;
  notes?: Record<string, unknown>;
}

/** Thrown by executors for cooperative cancellation; never recorded as failure. */
export class ItemCancelledError extends Error {
  constructor(message = "item cancelled") {
    super(message);
    this.name = "ItemCancelledError";
  }
}

export function cancelledResult(): WorkItemResult {
  return { ok: false, failureClass: "execution-failure", failureDetail: "cancelled", findings: [], evidencePaths: [], runIds: [], usage: {} };
}

export function failedResult(
  failureClass: WorkItemFailureClass,
  failureDetail: string,
  partial: Partial<WorkItemResult> = {},
): WorkItemResult {
  return {
    ok: false,
    failureClass,
    failureDetail,
    findings: [],
    evidencePaths: [],
    runIds: [],
    usage: {},
    ...partial,
  };
}

export function okResult(partial: Partial<WorkItemResult> = {}): WorkItemResult {
  return {
    ok: true,
    findings: [],
    evidencePaths: [],
    runIds: [],
    usage: {},
    ...partial,
  };
}

export interface WorkItemExecutor {
  readonly id: string;
  /** Capability snapshot used for capability-aware routing (M12 F4). */
  capabilities(): Promise<WorkerCapabilitySnapshot> | WorkerCapabilitySnapshot;
  /**
   * Execute one work item inside the isolated context. Implementations must:
   * honor ctx.signal cooperatively (throw ItemCancelledError), obtain budget
   * permission via ctx.admit BEFORE consuming budgeted resources and record
   * actual consumption via ctx.charge, contain their own adapter crashes into
   * a structured failure result instead of throwing arbitrary errors. Lease
   * liveness is scheduler-managed: the scheduler renews the lease while the
   * executor runs and aborts ctx.signal if the fencing generation is lost.
   */
  execute(item: unknown, ctx: ExecutionContext): Promise<WorkItemResult>;
}
