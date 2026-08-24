import type { WorkItemResult, WorkItemFailureClass } from "./executor.js";
import { StateFile } from "./state-file.js";

/**
 * Durable pending-settlement journal (HARDENING_2 D5).
 *
 * `leases.complete()` and `recordExecution()` are writes to two different
 * stores; a controller death between them must never strand an item (queued
 * forever behind a done lease) nor lose a completion. Every settlement is
 * therefore journalled BEFORE any store is mutated and removed only AFTER
 * both stores agree. A fresh controller replays each pending entry
 * idempotently: fencing decides whether the completion is authoritative.
 *
 * Journal entry shape is versioned for future migration; unknown phases fail
 * closed through the state validator rather than being dropped silently.
 */
export interface PendingSettlement {
  schema: "inspector-campaign-settlement/1";
  itemId: string;
  workerId: string;
  generation?: number;
  /** "completing" replays leases.complete+recordExecution; "failing" replays recordFailure+release. */
  phase: "completing" | "failing";
  failureClass?: WorkItemFailureClass;
  failureDetail?: string;
  result?: WorkItemResult;
  at: string;
}

function empty(): { pending: PendingSettlement[] } {
  return { pending: [] };
}

function validatePending(value: unknown): { pending: PendingSettlement[] } {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { pending?: unknown }).pending)) {
    throw new TypeError("invalid settlement journal: pending must be an array");
  }
  const out = value as { pending: Array<Record<string, unknown>> };
  for (const entry of out.pending) {
    if (
      typeof value !== "object" ||
      entry.schema !== "inspector-campaign-settlement/1" ||
      typeof entry.itemId !== "string" ||
      typeof entry.workerId !== "string" ||
      (entry.phase !== "completing" && entry.phase !== "failing")
    ) {
      throw new TypeError("invalid settlement journal entry");
    }
  }
  return value as { pending: PendingSettlement[] };
}

export class SettlementJournal {
  private readonly file: StateFile<{ pending: PendingSettlement[] }>;

  constructor(stateDir: string) {
    this.file = new StateFile(stateDir, "settlements", empty, validatePending);
    this.file.load();
  }

  load(): PendingSettlement[] {
    return this.file.load().pending;
  }

  add(entry: PendingSettlement): void {
    this.file.update((s) => {
      s.pending.push(entry);
    });
  }

  remove(itemId: string, workerId: string): void {
    this.file.update((s) => {
      s.pending = s.pending.filter((p) => !(p.itemId === itemId && p.workerId === workerId));
    });
  }

  /**
   * Serialized read of pending entries for one item, used by reconciliation.
   * The state file lock makes this race-free against concurrent settlers.
   */
  forItem(itemId: string): PendingSettlement[] {
    return this.file.load().pending.filter((p) => p.itemId === itemId);
  }
}
