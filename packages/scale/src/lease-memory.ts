import type { LeaseRecord } from "./types.js";
import type { LeasesState, LeaseStore } from "./lease-store.js";
import { validateLeasesState } from "./state-validation.js";

/**
 * In-memory LeaseStore for tests and ephemeral single-host use.
 *
 * Implements the same {@link LeaseStore} contract as the durable
 * file/SQLite backends: `load` returns a validated snapshot, `update`
 * serializes read-modify-write inside a critical section and persists.
 * For the in-process implementation the critical section is synchronous
 * (no cross-process lock required) and state is shared per `stateDir`
 * via a static registry so that multiple managers on the same dir observe
 * each other's writes — matching the durable backends' cross-process
 * visibility for parity tests.
 *
 * Generation fencing is handled by the caller ({@link LeaseManager});
 * the store preserves `generation` exactly as written.
 *
 * Future Redis backend: a `RedisLeaseStore` would implement the same
 * `LeaseStore` interface (load/update/close) or, equivalently, the
 * higher-level `LeaseStore { acquire, release, renew, list }` operations
 * described in the assignment. The interface is intentionally narrow and
 * storage-agnostic (opaque `LeasesState` + atomic `update`) so a Redis
 * implementation can be added as a new file plus wiring without changing
 * call sites — using a transaction/Lua script for TTL, fencing, and
 * atomicity. No external service is required for the current backends.
 */
export class MemoryLeaseStore implements LeaseStore {
  private static readonly registry = new Map<string, LeasesState>();

  private readonly key: string;

  constructor(stateDir: string) {
    this.key = stateDir;
    if (!MemoryLeaseStore.registry.has(this.key)) {
      MemoryLeaseStore.registry.set(this.key, { leases: {}, done: [] });
    }
  }

  load(): LeasesState {
    const state = MemoryLeaseStore.registry.get(this.key);
    if (!state) return { leases: {}, done: [] };
    // Return a deep clone so callers cannot mutate shared state outside update.
    const clone = cloneState(state);
    return validateLeasesState(clone);
  }

  update<U>(fn: (current: LeasesState) => U): U {
    const shared = MemoryLeaseStore.registry.get(this.key);
    if (!shared) throw new Error("MemoryLeaseStore: missing registry entry");
    // Work on a validated clone; fn mutates it in place per LeaseStore contract.
    const current = cloneState(shared);
    // Validate before mutation to fail loud on corruption (mirrors file/sqlite).
    validateLeasesState(current);
    const result = fn(current);
    // Validate after mutation and persist as new shared state (deep clone).
    validateLeasesState(current);
    MemoryLeaseStore.registry.set(this.key, cloneState(current));
    return result;
  }

  close(): void {
    // No resources to release; registry entry survives to model durability
    // within the process (cleared only when the test removes the temp dir
    // via `__clearForTest` or process exit).
  }

  /** Test-only: clear the shared registry entry for a dir. */
  static __clearForTest(stateDir: string): void {
    MemoryLeaseStore.registry.delete(stateDir);
  }

  /** Test-only: clear all entries. */
  static __clearAllForTest(): void {
    MemoryLeaseStore.registry.clear();
  }
}

function cloneState(state: LeasesState): LeasesState {
  const leases: Record<string, LeaseRecord> = {};
  for (const [k, v] of Object.entries(state.leases)) {
    leases[k] = { ...v };
  }
  return { leases, done: [...state.done] };
}
