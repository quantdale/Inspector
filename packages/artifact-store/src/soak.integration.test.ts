import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactStore, CorruptionError } from "./index.js";

// SOAK phase J (hardening campaign #1): bounded-but-substantial deterministic
// churn for @inspector/artifact-store — content-addressed dedup at volume,
// verify-on-read, tamper/repair cycles, and filesystem hygiene metrics.
// Measured numbers are printed as `[soak-j] ...` lines for the campaign report.

const TMP_PREFIX = "inspector-soakj-art-";
const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${TMP_PREFIX}${name}-`));
  roots.push(dir);
  return dir;
}
let tmpBaseline = -1;
function countTmpRoots(): number {
  return readdirSync(tmpdir()).filter((f) => f.startsWith(TMP_PREFIX)).length;
}
beforeAll(() => {
  tmpBaseline = countTmpRoots();
});
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots.length = 0;
  // Dispose paths must leave the temp dir exactly as we found it.
  expect(countTmpRoots()).toBe(tmpBaseline);
});

interface SoakSample {
  rssMb: number;
  handles: number;
}
function sampleResources(): SoakSample {
  return {
    rssMb: process.memoryUsage().rss / (1024 * 1024),
    handles: process.getActiveResourcesInfo().length,
  };
}

/** Deterministic pseudo-random bytes (LCG); no Math.random anywhere. */
function pseudoContent(seed: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let h = (seed * 2654435761) >>> 0;
  for (let off = 0; off < size; off += 4) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    buf.writeUInt32LE(h, off);
  }
  return buf;
}

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("SOAK-J: artifact-store long-run churn", () => {
  it(
    "SOAK-J6: thousands of write/read/meta cycles dedup exactly and leave zero tmp litter",
    { timeout: 180_000 },
    () => {
      const base = fresh("artifacts");
      const storeDir = join(base, "store");
      const store = new ArtifactStore(storeDir);

      const RUNS = 8;
      const CONTENTS = 40;
      const contents = Array.from({ length: CONTENTS }, (_, k) =>
        pseudoContent(k + 1, 512 + (k % 16) * 256),
      );
      const shas = contents.map(sha256Of);
      const runId = (i: number): string => `run_${i % RUNS}`;

      interface Pair {
        run: string;
        sha: string;
        content: Buffer;
        /** True when the most recent write for this pair used a name variant. */
        lastNamed: boolean;
      }
      const pairs = new Map<string, Pair>();
      const expectedFiles = new Set<string>();

      const WRITE_OPS = 5000;
      const startResources = sampleResources();
      const t0 = Date.now();

      for (let i = 0; i < WRITE_OPS; i++) {
        const run = runId(i);
        const k = (i * 7) % CONTENTS;
        const content = contents[k]!;
        const named = i % 3 === 0;
        const name = named ? `shot_${i % 97}.png` : undefined;
        const meta = store.write({
          runId: run,
          content,
          mime: named ? "image/png" : "application/octet-stream",
          name,
        });
        expect(meta.sha256).toBe(shas[k]);
        expect(meta.size).toBe(content.byteLength);

        const fileName = name === undefined ? meta.sha256 : `${meta.sha256}-${name}`;
        expectedFiles.add(join(run, "artifacts", fileName));
        const pairKey = `${run}:${meta.sha256}`;
        const existing = pairs.get(pairKey);
        if (!existing) {
          pairs.set(pairKey, { run, sha: meta.sha256, content, lastNamed: named });
        } else {
          existing.lastNamed = named;
        }
      }

      // Verified reads over every distinct (run, content) pair, cycled.
      const pairList = [...pairs.values()];
      const READ_OPS = 2500;
      for (let i = 0; i < READ_OPS; i++) {
        const pair = pairList[i % pairList.length]!;
        expect(store.read(pair.run, pair.sha).equals(pair.content)).toBe(true); // verify-on-read default
        const m = store.meta(pair.run, pair.sha);
        expect(m?.sha256).toBe(pair.sha);
        expect(m?.size).toBe(pair.content.byteLength);
        expect(store.verify(pair.run, pair.sha)).toBe(true);
      }
      // Absent content is absent, not an error-shaped empty read.
      expect(store.meta(runId(0), "ab".repeat(32))).toBeUndefined();

      // Tamper -> detected on read -> repaired by rewriting the same content.
      // The victim must be a pair whose LAST write was nameless: the store's
      // index then points at the canonical sha file, which is the file we
      // tamper (named twins of the same content are separate physical files).
      const victim = pairList.find((p) => !p.lastNamed);
      if (!victim) throw new Error("no nameless-last pair available for tamper probe");
      const victimPath = join(storeDir, victim.run, "artifacts", victim.sha);
      const TAMPER_CYCLES = 25;
      for (let c = 0; c < TAMPER_CYCLES; c++) {
        const raw = readFileSync(victimPath);
        const pos = c % raw.byteLength;
        raw.writeUInt8(raw.readUInt8(pos) ^ 0xff, pos);
        writeFileSync(victimPath, raw);
        expect(() => store.read(victim.run, victim.sha)).toThrow(CorruptionError);
        expect(store.verify(victim.run, victim.sha)).toBe(false);
        const repaired = store.write({
          runId: victim.run,
          content: victim.content,
          mime: "application/octet-stream",
        });
        expect(repaired.sha256).toBe(victim.sha);
        expect(store.read(victim.run, victim.sha).equals(victim.content)).toBe(true);
      }

      // Filesystem audit: physical files == distinct content addresses written,
      // no .tmp litter from atomic writes, all sizes intact.
      const files = listFilesRecursive(storeDir);
      expect(files.length).toBe(expectedFiles.size);
      const litter = files.filter((f) => /\.tmp/.test(f));
      expect(litter).toEqual([]);
      let totalBytes = 0;
      for (const f of files) totalBytes += statSync(f).size;

      const endResources = sampleResources();
      const wallMs = Date.now() - t0;
      console.info(
        `[soak-j] J6 artifacts: writeOps=${WRITE_OPS} readOps=${READ_OPS} tamperCycles=${TAMPER_CYCLES} -> ` +
          `physicalFiles=${files.length} (dedup ${(WRITE_OPS / files.length).toFixed(2)}x), ` +
          `uniquePairs=${pairs.size}, bytes=${totalBytes}, wallMs=${wallMs}`,
      );
      assertGrowth(startResources, endResources, WRITE_OPS + READ_OPS);
    },
  );
});

function assertGrowth(start: SoakSample, end: SoakSample, iterations: number): void {
  const growthMb = end.rssMb - start.rssMb;
  console.info(
    `[soak-j] J6 resources: rss ${start.rssMb.toFixed(1)}MB -> ${end.rssMb.toFixed(1)}MB ` +
      `(growth ${growthMb.toFixed(1)}MB), active resources ${start.handles} -> ${end.handles}`,
  );
  expect(growthMb).toBeLessThan(200);
  expect(end.handles).toBeLessThanOrEqual(start.handles + 100);
  expect(end.handles).toBeLessThan(start.handles + Math.max(20, 0.5 * iterations));
}
