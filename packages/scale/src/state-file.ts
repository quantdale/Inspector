import { join } from "node:path";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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
 * HARDENING_5 H5.7 — StateFile fingerprint skip (measured runtime efficiency).
 *
 * The {@link StateFile} persists via `save()` which `JSON.stringify`s the
 * value, hashes it (sha256), and compares to {@link StateFile.lastFingerprint}.
 * On a hit the tmp-write + fsync + rename (+ directory fsync) is skipped
 * entirely — critical during replay where many no-op re-saves occur.
 *
 * Micro-benchmark harness
 * -----------------------
 * `benchmarkFingerprintSkip` (below) + `state-file.bench.test.ts` +
 * `scripts/perf-bench.ts` form the deterministic harness for this fast-path:
 *
 * - Wall time: identical re-save vs changing save (N iterations, µs/save,
 *   speedup ratio). No-op must be far cheaper (order-of-magnitude on this
 *   platform) because it avoids syscalls.
 * - Syscall avoidance: identical re-save must NOT call `fs.renameSync` /
 *   `fs.fsyncSync` (spied via `vi.mock("node:fs")`); changing save MUST call
 *   them (proves skip is not unconditional).
 * - Deterministic, credential-free, bounded (few thousand iterations), and
 *   CI-runnable — no browser, no network, no wall-clock flakes beyond a
 *   generous ratio guard.
 *
 * Baseline numbers are printed by `pnpm exec tsx scripts/perf-bench.ts` and
 * recorded as JSON `{ noopPerSaveUs, changingPerSaveUs, speedup }`.
 */

/**
 * Atomic JSON state file: the durable campaign state (queue, completed,
 * in-flight leases, ledger) survives controller restart. Production binding
 * is SQLite; the file form keeps the contract identical and auditable.
 *
 * Serialization: every mutation goes through {@link update}, which takes the
 * cross-process lock, reloads state FROM DISK inside the lock, applies the
 * mutation, and persists — so two managers on one stateDir can never act on a
 * stale snapshot. {@link save} is public for auditability but performs no
 * locking of its own: callers outside `update` must hold the state lock.
 *
 * HARDENING_4 write-path atomicity: each save writes a UNIQUE temporary file
 * (`<state>.<pid>.<uuid>.tmp`) instead of a fixed shared name, so a save can
 * never collide with another writer and a concurrent reader's leftover sweep
 * can never delete a live in-flight temp. The sweep removes only (a) the
 * LEGACY fixed-name `.tmp` left by pre-H4 writers and (b) unique-named temps
 * older than {@link StateFile.tmpStaleMs} — crash debris, not live writes.
 * Saves are tmp-write + fsync + rename; on POSIX the containing directory is
 * also fsynced best-effort so the rename itself survives power loss (Windows
 * NTFS metadata journaling covers rename durability; the call is skipped).
 * Corrupt files are quarantined to a unique name and reported with a typed
 * error instead of being silently reset.
 *
 * HARDENING_2 (D8): an optional validate hook runs on every parsed load.
 * Syntactically valid JSON that violates the semantic contract of the state
 * fails closed with StateCorruptionError instead of being silently normalized
 * into empty/default state.
 */
export class StateFile<T> {
  private readonly path: string;
  private readonly lock: FileLock;
  private readonly validate?: (value: unknown) => T;
  /** Age (ms) at which an orphaned unique-named temp becomes sweepable debris. */
  private readonly tmpStaleMs: number;
  /**
   * Set-fingerprint of the last value persisted to disk. When a {@link save}
   * would write bytes identical to what is already on disk, the fsync + rename
   * is skipped entirely (H5.7: measured runtime efficiency). Absent until the
   * first successful load OR save, so a freshly constructed file still writes.
   */
  private lastFingerprint?: string;

  constructor(
    stateDir: string,
    name: string,
    private initial: () => T,
    validate?: (value: unknown) => T,
    opts: { tmpStaleMs?: number } = {},
  ) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, `${name}.json`);
    this.lock = new FileLock(`${this.path}.lock`);
    this.validate = validate;
    this.tmpStaleMs = opts.tmpStaleMs ?? 60_000;
  }

  load(): T {
    this.sweepLeftoverTmp();
    if (!existsSync(this.path)) return this.initial();
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (err) {
      // Fail loud: quarantine the corrupt bytes so post-mortem is possible,
      // then raise instead of silently resetting to initial state.
      throw this.quarantine(err);
    }
    if (this.validate) {
      try {
        return this.validate(parsed);
      } catch (err) {
        throw this.quarantine(err);
      }
    }
    // Seed the fingerprint from the on-disk bytes so a no-op reload does not
    // force a rewrite on the next save.
    this.lastFingerprint = createHash("sha256").update(readFileSync(this.path, "utf8")).digest("hex");
    return parsed as T;
  }

  private quarantine(cause: unknown): StateCorruptionError {
    const quarantinePath = `${this.path}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      renameSync(this.path, quarantinePath);
    } catch {
      // A racing instance may have quarantined it already.
    }
    return new StateCorruptionError(this.path, quarantinePath, cause);
  }

  /**
   * Serialized read-modify-write: takes the cross-process lock, reloads the
   * current value from disk, applies `fn`, persists, and returns `fn`'s
   * result.
   *
   * Mutation contract (HARDENING_4 clarification, unchanged behavior):
   * `fn` MUST mutate `current` in place — that mutated object is what gets
   * persisted. The return value is a plain result channel and is NEVER
   * persisted; returning a fresh object does not replace durable state.
   */
  update<U>(fn: (current: T) => U): U {
    return this.lock.withLock(() => {
      const current = this.load();
      const result = fn(current);
      this.save(current);
      return result;
    });
  }

  /**
   * Durable atomic persist via unique-temp + fsync + rename. No internal
   * locking: call from inside {@link update}, or hold the state lock yourself.
   */
  save(value: T): void {
    const serialized = JSON.stringify(value, null, 2);
    const fingerprint = createHash("sha256").update(serialized).digest("hex");
    if (fingerprint === this.lastFingerprint) return; // no-op: skip fsync+rename
    const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, serialized);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.renameWithWindowsShareRetry(tmp, this.path);
    this.fsyncDirectoryBestEffort();
    this.lastFingerprint = fingerprint;
  }

  /**
   * Windows rename-over-existing fails EPERM/EACCES/EBUSY while ANY other
   * handle holds the destination without FILE_SHARE_DELETE — including a
   * concurrent unlocked reader mid-readFileSync (proven by HARDENING_4's
   * reader/writer race suite). POSIX never exhibits this. Retry bounded:
   * readers hold their handle for microseconds, so a short retry window
   * preserves atomicity without masking genuine failures (which still
   * throw after the bound).
   */
  private renameWithWindowsShareRetry(from: string, to: string): void {
    const maxAttempts = 12;
    for (let attempt = 1; ; attempt += 1) {
      try {
        renameSync(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        const transientShareViolation =
          process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
        if (!transientShareViolation || attempt >= maxAttempts) {
          try {
            unlinkSync(from);
          } catch {
            // Unique-named debris; swept later by age.
          }
          throw err;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * attempt);
      }
    }
  }

  /**
   * Best-effort directory durability for the rename on POSIX. Windows is
   * skipped deliberately: NTFS journals metadata, and opening directories
   * there is not portable through Node.
   */
  private fsyncDirectoryBestEffort(): void {
    if (process.platform === "win32") return;
    let dirFd: number | undefined;
    try {
      dirFd = openSync(join(this.path, ".."), "r");
      fsyncSync(dirFd);
    } catch {
      // Unsupported or failing directory fsync is a durability nicety here,
      // never a correctness gate: the rename already happened.
    } finally {
      if (dirFd !== undefined) {
        try {
          closeSync(dirFd);
        } catch {
          // Nothing actionable.
        }
      }
    }
  }

  /**
   * Remove crashed-save debris without endangering live writers:
   * - the LEGACY fixed `<state>.json.tmp` (pre-H4 writers) always goes;
   * - unique-named temps go only once older than tmpStaleMs — a live
   *   writer's temp exists for milliseconds, so age proves abandonment.
   */
  private sweepLeftoverTmp(): void {
    const legacyTmp = `${this.path}.tmp`;
    if (existsSync(legacyTmp)) {
      try {
        rmSync(legacyTmp, { force: true });
      } catch {
        // Unlink races (AV scanners, concurrent sweep) are harmless.
      }
    }
    const dir = join(this.path, "..");
    const base = `${this.path.split(/[\\/]/).pop() ?? ""}.`;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith(base) || !entry.endsWith(".tmp")) continue;
      const candidate = join(dir, entry);
      let ageOk = false;
      try {
        ageOk = now - statSync(candidate).mtimeMs > this.tmpStaleMs;
      } catch {
        continue; // Vanished mid-sweep: someone else handled it.
      }
      if (!ageOk) continue;
      try {
        unlinkSync(candidate);
      } catch {
        // Harmless race.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HARDENING_5 H5.7 — micro-benchmark helper (no behavior change)
// ---------------------------------------------------------------------------

/** Result of {@link benchmarkFingerprintSkip}: wall time for the two paths. */
export interface FingerprintBenchResult {
  /** Wall time (ms) for N identical re-saves (fingerprint hit: skip path). */
  noopMs: number;
  /** Wall time (ms) for N changing saves (full fsync+rename). */
  changingMs: number;
  /** Microseconds per save for the no-op path. */
  noopPerSaveUs: number;
  /** Microseconds per save for the changing path. */
  changingPerSaveUs: number;
  /** Ratio `changingMs / max(noopMs,1)` — >1 means skip is cheaper. */
  speedup: number;
}

/**
 * Deterministic micro-benchmark for the H5.7 fingerprint skip.
 *
 * Measures wall time for `iterations` identical re-saves (hash hit → no
 * fsync/rename) vs `iterations` changing saves (full durability path) on
 * the provided {@link StateFile}. Credential-free, bounded, and suitable for
 * `state-file.bench.test.ts` and `scripts/perf-bench.ts`.
 *
 * The caller is responsible for bringing `sf` to a stable starting state
 * before invoking (e.g. one initial `update` so `lastFingerprint` is set).
 */
export function benchmarkFingerprintSkip<T>(
  sf: StateFile<T>,
  identical: (current: T) => void,
  changing: (current: T, i: number) => void,
  iterations = 2000,
): FingerprintBenchResult {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    sf.update(identical);
  }
  const noopMs = performance.now() - t0;

  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    sf.update((c) => changing(c, i));
  }
  const changingMs = performance.now() - t1;

  return {
    noopMs,
    changingMs,
    noopPerSaveUs: (noopMs / iterations) * 1000,
    changingPerSaveUs: (changingMs / iterations) * 1000,
    speedup: changingMs / Math.max(noopMs, 1),
  };
}

/**
 * Standalone atomic JSON writer (unique-temp + fsync + rename with the same
 * Windows share-retry contract as {@link StateFile}). Used for durable JSON
 * artifacts that are not themselves a StateFile (e.g. evidence bundles).
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const maxAttempts = 12;
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      const transientShareViolation =
        process.platform === "win32" &&
        (code === "EPERM" || code === "EACCES" || code === "EBUSY");
      if (!transientShareViolation || attempt >= maxAttempts) {
        try {
          unlinkSync(tmp);
        } catch {
          // Unique-named debris; swept later by age.
        }
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * attempt);
    }
  }
}
