import type { LeaseRecord } from "./types.js";
import { StateFile } from "./state-file.js";

export type AcquireResult =
  | { ok: true; lease: LeaseRecord }
  | { ok: false; reason: "held" | "done" };

/**
 * Exclusive target leases (M7 S0). Leases are durable: after a controller
 * restart, in-flight leases are re-read and safely classified — held while
 * unexpired, reclaimable once expired. Two workers can never hold the same
 * item simultaneously.
 */
export class LeaseManager {
  private state: { leases: Record<string, LeaseRecord>; done: string[] };
  private readonly file: StateFile<typeof this.state>;

  constructor(
    stateDir: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = 60_000,
  ) {
    this.file = new StateFile(stateDir, "leases", () => ({ leases: {}, done: [] }));
    this.state = this.file.load();
  }

  acquire(itemId: string, workerId: string): AcquireResult {
    if (this.state.done.includes(itemId)) return { ok: false, reason: "done" };
    const existing = this.state.leases[itemId];
    if (existing) {
      if (existing.expiresAtMs > this.now()) return { ok: false, reason: "held" };
      // Expired lease from a dead controller: reclaimable.
    }
    const lease: LeaseRecord = {
      itemId,
      workerId,
      acquiredAtMs: this.now(),
      expiresAtMs: this.now() + this.ttlMs,
    };
    this.state.leases[itemId] = lease;
    this.persist();
    return { ok: true, lease };
  }

  renew(itemId: string): void {
    const lease = this.state.leases[itemId];
    if (lease) {
      lease.expiresAtMs = this.now() + this.ttlMs;
      this.persist();
    }
  }

  complete(itemId: string, workerId: string): boolean {
    const lease = this.state.leases[itemId];
    if (!lease || lease.workerId !== workerId) return false;
    delete this.state.leases[itemId];
    if (!this.state.done.includes(itemId)) this.state.done.push(itemId);
    this.persist();
    return true;
  }

  release(itemId: string, workerId: string): void {
    const lease = this.state.leases[itemId];
    if (lease && lease.workerId === workerId) {
      delete this.state.leases[itemId];
      this.persist();
    }
  }

  /** In-flight items at restart time; expired ones are safe to requeue. */
  inFlight(nowMs = this.now()): Array<LeaseRecord & { expired: boolean }> {
    return Object.values(this.state.leases).map((l) => ({
      ...l,
      expired: l.expiresAtMs <= nowMs,
    }));
  }

  isDone(itemId: string): boolean {
    return this.state.done.includes(itemId);
  }

  private persist(): void {
    this.file.save(this.state);
  }
}
