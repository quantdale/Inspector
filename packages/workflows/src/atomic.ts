import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { newId } from "@inspector/protocol";

const ORPHAN_MIN_AGE_MS = 60_000;
const MAX_ORPHANS_PER_SWEEP = 256;

/** Write a JSON artifact by staging it under a unique name then renaming. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${newId()}`);
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch { /* renamed or never created */ }
  }
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
