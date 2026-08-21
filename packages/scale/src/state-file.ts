import { join } from "node:path";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { FileLock } from "./lock.js";

/** Thrown when durable state exists but cannot be parsed; the file is quarantined first. */
export class StateCorruptionError extends Error {
  constructor(path: string, quarantinePath: string, cause: unknown) {
    super(
      `durable state at ${path} is corrupt (${String(cause)}); quarantined to ${quarantinePath}`,
    );
    this.name = "StateCorruptionError";
  }
}

/**
 * Atomic JSON state file: the durable campaign state (queue, completed,
 * in-flight leases, ledger) survives controller restart. Production binding
 * is SQLite; the file form keeps the contract identical and auditable.
 *
 * Hardening: every mutation goes through {@link update}, which serializes
 * concurrent instances via a cross-process lock, reloads state FROM DISK
 * inside the lock, applies the mutation, and persists — so two managers on
 * one stateDir can never act on a stale snapshot. Saves are tmp-write +
 * fsync + rename; corrupt files are quarantined and reported with a typed
 * error instead of being silently reset; leftover .tmp files from crashed
 * saves are swept on load.
 */
export class StateFile<T> {
  private readonly path: string;
  private readonly lock: FileLock;

  constructor(
    stateDir: string,
    name: string,
    private initial: () => T,
  ) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, `${name}.json`);
    this.lock = new FileLock(`${this.path}.lock`);
  }

  load(): T {
    this.sweepLeftoverTmp();
    if (!existsSync(this.path)) return this.initial();
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch (err) {
      // Fail loud: quarantine the corrupt bytes so post-mortem is possible,
      // then raise instead of silently resetting to initial state.
      const quarantine = `${this.path}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      renameSync(this.path, quarantine);
      throw new StateCorruptionError(this.path, quarantine, err);
    }
  }

  /**
   * Serialized read-modify-write: takes the cross-process lock, reloads the
   * current value from disk, applies `fn`, persists, and returns `fn`'s result.
   */
  update<U>(fn: (current: T) => U): U {
    return this.lock.withLock(() => {
      const current = this.load();
      const result = fn(current);
      this.save(current);
      return result;
    });
  }

  save(value: T): void {
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(value, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }

  private sweepLeftoverTmp(): void {
    const tmp = `${this.path}.tmp`;
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}
