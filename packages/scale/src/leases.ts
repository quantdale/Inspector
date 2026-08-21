import type { LeaseRecord } from "./types.js";
import { JsonLeaseStore, SqliteLeaseStore, type LeaseStore } from "./lease-store.js";

export type AcquireResult =
  | { ok: true; lease: LeaseRecord }
  | { ok: false; reason: "held" | "done" };

/** Backend selection; `"json"` (the original StateFile store) is the default. */
export interface LeaseManagerOptions {
  backend?: "json" | "sqlite";
}

/**
 * Exclusive target leases (M7 S0). Leases are durable: after a controller
 * restart, in-flight leases are re-read and safely classified — held while
 * unexpired, reclaimable once expired. Two workers can never hold the same
 * item simultaneously.
 *
 * Hardening: every operation runs inside its store's serialized critical
 * section (a cross-process file lock for the JSON backend, a SQLite write
 * transaction for the sqlite backend) and reloads state from durable storage
 * first, so two managers on one stateDir serially observe each other's
 * writes. Each acquire/reclaim bumps a monotonic
 * `generation` on the lease; completions and renewals carry the generation
 * they were issued for and are fenced out when it has moved on — a worker
 * whose lease expired and was reclaimed can no longer record stale work.
 */
export class LeaseManager {
  private readonly store: LeaseStore;

  constructor(
    stateDir: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = 60_000,
    options: LeaseManagerOptions = {},
  ) {
    this.store =
      options.backend === "sqlite"
        ? new SqliteLeaseStore(stateDir)
        : new JsonLeaseStore(stateDir);
    // Fail loud at construction if durable state is corrupt.
    this.store.load();
  }

  /** Release backend resources; safe to call for either backend. */
  close(): void {
    this.store.close();
  }

  acquire(itemId: string, workerId: string): AcquireResult {
    return this.store.update((state) => {
      if (state.done.includes(itemId)) return { ok: false as const, reason: "done" as const };
      const existing = state.leases[itemId];
      if (existing && existing.expiresAtMs > this.now()) {
        return { ok: false as const, reason: "held" as const };
      }
      // Fresh lease or reclaim of an expired one: bump the fencing generation.
      const lease: LeaseRecord = {
        itemId,
        workerId,
        generation: (existing?.generation ?? 0) + 1,
        acquiredAtMs: this.now(),
        expiresAtMs: this.now() + this.ttlMs,
      };
      state.leases[itemId] = lease;
      return { ok: true as const, lease };
    });
  }

  /** Extend a live lease; false when the caller no longer owns the current generation. */
  renew(itemId: string, workerId: string, generation?: number): boolean {
    return this.store.update((state) => {
      const lease = state.leases[itemId];
      if (!lease || lease.workerId !== workerId) return false;
      if (generation !== undefined && lease.generation !== generation) return false;
      lease.expiresAtMs = this.now() + this.ttlMs;
      return true;
    });
  }

  complete(itemId: string, workerId: string, generation?: number): boolean {
    return this.store.update((state) => {
      const lease = state.leases[itemId];
      if (!lease || lease.workerId !== workerId) return false;
      if (generation !== undefined && lease.generation !== generation) return false;
      delete state.leases[itemId];
      if (!state.done.includes(itemId)) state.done.push(itemId);
      return true;
    });
  }

  release(itemId: string, workerId: string): void {
    this.store.update((state) => {
      const lease = state.leases[itemId];
      if (lease && lease.workerId === workerId) {
        delete state.leases[itemId];
      }
    });
  }

  /** In-flight items at restart time; expired ones are safe to requeue. */
  inFlight(nowMs = this.now()): Array<LeaseRecord & { expired: boolean }> {
    return Object.values(this.store.load().leases).map((l) => ({
      ...l,
      expired: l.expiresAtMs <= nowMs,
    }));
  }

  isDone(itemId: string): boolean {
    return this.store.load().done.includes(itemId);
  }
}
