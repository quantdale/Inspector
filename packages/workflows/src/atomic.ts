import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { newId } from "@inspector/protocol";

const ORPHAN_MIN_AGE_MS = 60_000;
const MAX_ORPHANS_PER_SWEEP = 256;

/**
 * Windows rename-over-existing fails EPERM/EACCES/EBUSY while ANY other handle
 * holds the destination without FILE_SHARE_DELETE — including a concurrent
 * unlocked reader mid-readFileSync. POSIX never exhibits this. Retry bounded:
 * readers hold their handle for microseconds, so a short retry window preserves
 * atomicity without masking genuine failures (which still throw after the
 * bound). Mirrors scale's StateFile contract (HARDENING_4 / H5.6).
 */
function renameWithWindowsShareRetry(from: string, to: string): void {
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

/** Write a JSON artifact by staging it under a unique name then renaming. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${newId()}`);
  const fd = openSync(temp, "w");
  try {
    writeSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameWithWindowsShareRetry(temp, path);
}

/**
 * Remove only old, uniquely named staging files beneath one Inspector
 * artifact root. The age and count bounds prevent a live writer or a large
 * evidence tree from being disturbed during recovery.
 */
export function cleanupOrphanTemps(root: string): number {
  if (!existsSync(root)) return 0;
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  let removed = 0;
  const pending = [root];
  while (pending.length > 0 && removed < MAX_ORPHANS_PER_SWEEP) {
    const dir = pending.pop()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (removed >= MAX_ORPHANS_PER_SWEEP) break;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.includes(".tmp-")) continue;
      try {
        const stat = lstatSync(path);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(path);
          removed += 1;
        }
      } catch {
        /* A concurrent writer/remover owns the outcome. */
      }
    }
  }
  return removed;
}
