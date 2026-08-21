import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";

/** Thrown when a durable lock cannot be acquired within the bounded retry window. */
export class LockAcquireError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(`could not acquire lock ${lockDir} within ${timeoutMs}ms`);
    this.name = "LockAcquireError";
  }
}

export interface FileLockOptions {
  /** Age (ms) after which a leftover lock is considered abandoned and taken over. */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  pollMs?: number;
  /** Total bounded wait before failing loud. */
  timeoutMs?: number;
}

/**
 * Cross-process mutex over one load-modify-persist cycle (hardening #1).
 * A lock directory is created atomically via mkdir (works on Windows/NTFS);
 * it carries an owner file (pid + timestamp) for diagnostics, and stale
 * leftovers from crashed processes are taken over once their age exceeds
 * `staleMs`. Acquisition retries are bounded; exhaustion throws instead of
 * silently proceeding unsynchronized.
 */
export class FileLock {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly lockDir: string, opts: FileLockOptions = {}) {
    this.staleMs = opts.staleMs ?? 30_000;
    this.pollMs = opts.pollMs ?? 25;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  /** Run `fn` while holding the lock, releasing even on throw. */
  withLock<T>(fn: () => T): T {
    this.acquire();
    try {
      return fn();
    } finally {
      this.release();
    }
  }

  private acquire(): void {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      try {
        mkdirSync(this.lockDir);
      } catch {
        // EEXIST or transient loss: inspect staleness, then retry within budget.
        const immediate = this.takeoverIfStale();
        if (Date.now() > deadline) throw new LockAcquireError(this.lockDir, this.timeoutMs);
        if (!immediate) this.sleep(this.pollMs);
        continue;
      }
      try {
        writeFileSync(
          `${this.lockDir}/owner`,
          JSON.stringify({ pid: process.pid, acquiredAtMs: new Date().toISOString() }),
          { flag: "wx" },
        );
      } catch {
        // Owner file is diagnostic only; the mkdir already serialized us.
      }
      return;
    }
  }

  /** Remove the lock directory if it looks abandoned; returns true to retry immediately. */
  private takeoverIfStale(): boolean {
    try {
      const st = statSync(this.lockDir);
      if (Date.now() - st.mtimeMs <= this.staleMs) return false;
    } catch {
      return true; // vanished between mkdir and stat: retry at once
    }
    try {
      rmSync(this.lockDir, { recursive: true, force: true });
    } catch {
      // Someone else is mid-takeover; fall through to retry.
    }
    return true;
  }

  private release(): void {
    rmSync(this.lockDir, { recursive: true, force: true });
  }

  /** Synchronous backoff; Atomics.wait blocks without spinning the event loop hot. */
  private sleep(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}
