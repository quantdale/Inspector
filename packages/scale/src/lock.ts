import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** Thrown when a durable lock cannot be acquired within the bounded retry window. */
export class LockAcquireError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(`could not acquire lock ${lockDir} within ${timeoutMs}ms`);
    this.name = "LockAcquireError";
  }
}

export interface FileLockOptions {
  /** Age (ms) after which a leftover lock with no live owner is taken over. */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  pollMs?: number;
  /** Total bounded wait before failing loud. */
  timeoutMs?: number;
}

interface OwnerRecord {
  pid: number;
  token: string;
  acquiredAtMs: string;
}

const OWNER_FILE = "owner";

function ownerPath(lockDir: string): string {
  return `${lockDir}/${OWNER_FILE}`;
}

function readOwner(lockDir: string): OwnerRecord | undefined {
  // Returns undefined when the owner file is absent or unparsable; throws
  // only when the whole lock directory has vanished (ENOENT family).
  let raw: string;
  try {
    raw = readFileSync(ownerPath(lockDir), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOENT" || code === "ENOTDIR") {
      const dirStillExists = (() => {
        try {
          statSync(lockDir);
          return true;
        } catch {
          return false;
        }
      })();
      if (dirStillExists) return undefined;
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OwnerRecord>;
    if (typeof parsed.pid === "number" && typeof parsed.token === "string") {
      return { pid: parsed.pid, token: parsed.token, acquiredAtMs: String(parsed.acquiredAtMs ?? "") };
    }
  } catch {
    // Corrupt owner record: treated as anonymous (age-gated takeover only).
  }
  return undefined;
}

/** True when `pid` names a live process on this machine; conservative on errors. */
export function pidAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Cross-process mutex over one load-modify-persist cycle.
 *
 * HARDENING_4 ownership semantics (replaces age-only takeover):
 *
 * - Acquisition is still the atomic `mkdir` (works on Windows/NTFS), but the
 *   winner MUST persist a unique random ownership token into `owner` before
 *   the critical section starts. A holder identity therefore exists even if
 *   the process dies mid-section.
 * - `release()` is ownership-checked: it renames the lock directory aside,
 *   confirms the recorded token matches THIS instance's token, and only then
 *   deletes. A predecessor that outlived its lease and was taken over can
 *   therefore NEVER delete a successor's live lock — worst case it briefly
 *   renames the successor's directory aside and immediately renames it back.
 * - Stale recovery is bounded twice over: an owner whose pid is provably dead
 *   on this machine is taken over immediately; otherwise age past `staleMs`
 *   (the previous contract, kept for cross-machine safety) triggers takeover.
 *   Takeover itself is a single atomic `rename` of the stale directory away,
 *   so two concurrent takeovers cannot both win; the loser simply retries
 *   against whatever is at the path now.
 *
 * Residual advisory-lock caveat, documented deliberately: between the moment
 * a takeover completes and the moment the stale predecessor notices, both
 * processes may believe they hold the lock. Production-sensitive paths use
 * generation-fenced leases (LeaseManager) as the authority — the FileLock
 * serializes IO, it does not confer business ownership. Holders must also
 * keep individual critical sections well under `staleMs`.
 */
export class FileLock {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  /** Token of the acquisition currently held by this instance, if any. */
  private heldToken: string | undefined;

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

  /**
   * Acquire the lock or throw {@link LockAcquireError} within the bounded
   * wait. Manual bracketing is exposed for deterministic composition/tests;
   * {@link withLock} remains the intended everyday form.
   */
  acquire(): void {
    const deadline = Date.now() + this.timeoutMs;
    const token = randomUUID();
    for (;;) {
      try {
        mkdirSync(this.lockDir);
      } catch {
        // EEXIST or transient loss: inspect ownership/staleness, then retry.
        const immediate = this.takeoverIfEligible();
        if (Date.now() > deadline) throw new LockAcquireError(this.lockDir, this.timeoutMs);
        if (!immediate) this.sleep(this.pollMs);
        continue;
      }
      // We won the mkdir race. Persisting the owner token is mandatory: a
      // directory without an owner could never be released except by
      // staleness, so on write failure remove OUR OWN directory (verified)
      // and retry rather than leaving an anonymous lock behind.
      try {
        writeFileSync(
          ownerPath(this.lockDir),
          JSON.stringify({ pid: process.pid, token, acquiredAtMs: new Date().toISOString() }),
          { flag: "wx" },
        );
      } catch {
        this.removeOwnedDir(token);
        if (Date.now() > deadline) throw new LockAcquireError(this.lockDir, this.timeoutMs);
        this.sleep(this.pollMs);
        continue;
      }
      this.heldToken = token;
      return;
    }
  }

  /**
   * Remove the lock directory when it verifiably belongs to `token`.
   * Rename-first: whatever is at the path is moved aside, inspected, and
   * either deleted (ours) or restored untouched (a successor's).
   */
  private removeOwnedDir(token: string): void {
    const grave = `${this.lockDir}.release-${token}`;
    try {
      renameSync(this.lockDir, grave);
    } catch {
      return; // Directory already gone or being handled elsewhere.
    }
    const recorded = readOwner(grave);
    if (recorded?.token === token) {
      try {
        rmSync(grave, { recursive: true, force: true });
      } catch {
        // Debris with a unique name; a later sweep or user can clear it.
      }
      return;
    }
    // Not ours (we raced a takeover): put the live lock back exactly as it was.
    try {
      renameSync(grave, this.lockDir);
    } catch {
      // Path re-occupied mid-restore: leave the grave dir; its owner file
      // preserves the truth of who held what for post-mortem.
    }
  }

  /**
   * Steal the lock directory when its owner is provably gone (dead pid on
   * this machine) or its age exceeds `staleMs` with no readable owner.
   * Returns true to retry the mkdir immediately.
   */
  private takeoverIfEligible(): boolean {
    let stats: { mtimeMs: number };
    try {
      stats = statSync(this.lockDir);
    } catch {
      return true; // Vanished between mkdir and stat: retry at once.
    }
    let owner: OwnerRecord | undefined;
    try {
      owner = readOwner(this.lockDir);
    } catch {
      return true; // Whole directory vanished mid-inspection: retry at once.
    }

    const ownerDead = owner !== undefined && !pidAlive(owner.pid);
    const anonymousAndAged = owner === undefined && Date.now() - stats.mtimeMs > this.staleMs;
    if (!ownerDead && !anonymousAndAged) return false;

    // Atomic steal: exactly one contender's rename can succeed; everyone
    // else retries against the successor state. Debris removal is
    // best-effort — losing the debris never affects correctness.
    const grave = `${this.lockDir}.stolen-${randomUUID()}`;
    try {
      renameSync(this.lockDir, grave);
    } catch {
      return false; // Someone else is mid-takeover; poll again.
    }
    try {
      rmSync(grave, { recursive: true, force: true });
    } catch {
      // Unique-named debris; harmless.
    }
    return true;
  }

  /** Release a previously acquired lock (ownership-checked; see class docs). */
  release(): void {
    const token = this.heldToken;
    this.heldToken = undefined;
    if (token === undefined) return;
    this.removeOwnedDir(token);
  }

  /** Synchronous backoff; Atomics.wait blocks without spinning the event loop hot. */
  private sleep(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}
