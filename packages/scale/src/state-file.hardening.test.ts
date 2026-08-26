import { afterAll, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateFile } from "./state-file.js";

const dirs: string[] = [];

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-state-${label}-`));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("HARDENING_4 StateFile write-path atomicity (H4-D5)", () => {
  it("saves are atomic and rename-over-existing works repeatedly on this platform", () => {
    const dir = freshDir("roundtrip");
    const sf = new StateFile<{ n: number; note: string }>(dir, "probe", () => ({ n: -1, note: "" }));
    // Mutation form (the established contract).
    for (let i = 0; i < 25; i += 1) {
      sf.update((cur) => {
        cur.n += 1;
        cur.note = `iteration-${cur.n}-unicode-üñí`;
      });
    }
    expect(sf.load().n).toBe(24);
    expect(sf.load().note).toBe("iteration-24-unicode-üñí");

    // Replacement returns are NEVER persisted: the mutation contract is
    // that `fn` mutates `current` in place. A pure-function updater would
    // silently lose its work — assert that trap stays impossible to miss.
    sf.update((cur) => ({ n: cur.n + 100, note: "ignored-pure-result" }));
    expect(sf.load().n).toBe(24);

    // Primitive/void returns are a result channel only.
    const returned = sf.update((cur) => {
      cur.n += 1;
      return "flag";
    });
    expect(returned).toBe("flag");
    expect(sf.load().n).toBe(25);
  });

  it("the legacy fixed-name .tmp debris is swept by load()", () => {
    const dir = freshDir("legacytmp");
    const statePath = join(dir, "probe.json");
    writeFileSync(statePath, JSON.stringify({ ok: true }), "utf8");
    writeFileSync(`${statePath}.tmp`, "{ truncated pre-H4 crash debris", "utf8");

    const sf = new StateFile<{ ok: boolean }>(dir, "probe", () => ({ ok: false }));
    expect(sf.load()).toEqual({ ok: true });
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
  });

  it("sweep removes aged orphan temps but NEVER a live writer's fresh unique temp", () => {
    const dir = freshDir("livetmp");
    const statePath = join(dir, "probe.json");
    writeFileSync(statePath, JSON.stringify({ v: 1 }), "utf8");

    const liveTmp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(liveTmp, JSON.stringify({ v: 2 }), "utf8"); // Fresh mtime: in-flight write.

    const deadTmp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(deadTmp, JSON.stringify({ v: 3 }), "utf8");
    const stale = new Date(Date.now() - 5 * 60_000);
    utimesSync(deadTmp, stale, stale);

    const sf = new StateFile<{ v: number }>(dir, "probe", () => ({ v: 0 }), undefined, {
      tmpStaleMs: 60_000,
    });
    expect(sf.load()).toEqual({ v: 1 }); // Truthful current state.
    expect(existsSync(deadTmp)).toBe(false); // Aged debris collected.
    expect(existsSync(liveTmp)).toBe(true); // Live writer untouched.

    rmSync(liveTmp, { force: true });
  });

  it("a concurrent external writer cannot be corrupted or starved by reader sweeps", async () => {
    const dir = freshDir("xwriter");
    // The child worker speaks the same on-disk protocol as StateFile.save
    // (unique temp + fsync + rename) and hammers saves in a tight loop while
    // the parent hammers unlocked loads — exactly the historical race shape.
    const workerSrc = `
      const { parentPort, workerData } = require("node:worker_threads");
      const { openSync, writeSync, closeSync, renameSync, fsyncSync, unlinkSync } = require("node:fs");
      const { randomUUID } = require("node:crypto");
      const path = workerData.path;
      let n = 0;
      let errors = 0;
      function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
      // Mirrors the product's save(): unique temp + fsync + bounded retry on
      // the Windows sharing violation a concurrent reader can provoke.
      function durableWrite(value) {
        const tmp = path + "." + process.pid + "." + randomUUID() + ".tmp";
        const fd = openSync(tmp, "w");
        try {
          writeSync(fd, JSON.stringify(value));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        for (let attempt = 1; ; attempt += 1) {
          try {
            renameSync(tmp, path);
            return;
          } catch (err) {
            const code = err.code || "";
            const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
            if (!transient || attempt >= 40) {
              try { unlinkSync(tmp); } catch {}
              throw err;
            }
            sleep(5 * attempt);
          }
        }
      }
      const timer = setInterval(() => {
        try {
          durableWrite({ n });
          n += 1;
        } catch (err) {
          errors += 1;
          lastError = String(err && err.code ? err.code : err);
        }
      }, 1);
      let lastError = null;
      parentPort.on("message", (msg) => {
        if (msg === "stop") {
          clearInterval(timer);
          parentPort.postMessage({ writes: n, errors, lastError });
        }
      });
    `;
    const statePath = join(dir, "hammer.json");
    writeFileSync(statePath, JSON.stringify({ n: -1 }), "utf8");
    const worker = new Worker(workerSrc, { eval: true, workerData: { path: statePath } });

    const sf = new StateFile<{ n: number }>(dir, "hammer", () => ({ n: -2 }));
    let reads = 0;
    let tornReads = 0;
    const deadline = Date.now() + 1_500;
    try {
      while (Date.now() < deadline) {
        try {
          const value = sf.load();
          if (!Number.isInteger(value.n)) tornReads += 1;
        } catch {
          tornReads += 1; // A partial/torn read would land here.
        }
        reads += 1;
      }
    } finally {
      const writes: Promise<{ writes: number; errors: number; lastError: string | null }> = new Promise(
        (resolve) => {
          worker.once("message", (m) => resolve(m as { writes: number; errors: number; lastError: string | null }));
          worker.postMessage("stop");
        },
      );
      const timedOut = Symbol("timeout");
      const result = await Promise.race([
        writes,
        new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 10_000)),
      ]);
      await worker.terminate();
      expect(result).not.toBe(timedOut);
      const summary = result as { writes: number; errors: number; lastError: string | null };
      expect(summary.writes).toBeGreaterThanOrEqual(3); // Writer genuinely ran.
      expect(summary.errors).toBe(0); // Bounded retry absorbed reader contention.
    }

    expect(reads).toBeGreaterThan(10);
    expect(tornReads).toBe(0); // Readers never observe a partial write.
    expect(Number.isInteger(sf.load().n)).toBe(true);
  }, 30_000);

  it("save debris from a killed writer is bounded and eventually collectable", async () => {
    const dir = freshDir("debris");
    const sf = new StateFile<{ n: number }>(dir, "sweep", () => ({ n: 0 }), undefined, {
      tmpStaleMs: 50,
    });
    sf.update((cur) => ({ n: cur.n + 1 }));

    // Simulate a killed writer: an orphaned unique temp with old mtime.
    const orphan = join(dir, "sweep.json.424242.deadbeef.tmp");
    writeFileSync(orphan, '{"n":999', "utf8");
    const past = new Date(Date.now() - 5_000);
    utimesSync(orphan, past, past);

    // Multiple load cycles must not throw on debris and must collect it.
    for (let i = 0; i < 3; i += 1) sf.load();
    await new Promise((r) => setTimeout(r, 80));
    sf.load();
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
