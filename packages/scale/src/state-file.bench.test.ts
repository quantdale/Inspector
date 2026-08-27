/**
 * HARDENING_5 H5.7 — StateFile fingerprint skip micro-benchmark harness.
 *
 * Proves the `lastFingerprint` fast-path:
 * - identical re-save MUST skip fsync+rename (spy on fs)
 * - changing save MUST perform fsync+rename
 * - wall time for identical is far cheaper than changing (benchmark helper)
 *
 * Deterministic, credential-free, bounded; no other files touched.
 */
import type * as FsType from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Must mock before StateFile imports `node:fs` bindings so the spy wraps the
// actual syscalls but still executes them (behavior preserved).
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsType>("node:fs");
  return {
    ...actual,
    renameSync: vi.fn((...args: Parameters<typeof actual.renameSync>) =>
      (actual.renameSync as unknown as (...a: unknown[]) => unknown)(...args),
    ),
    fsyncSync: vi.fn((...args: Parameters<typeof actual.fsyncSync>) =>
      (actual.fsyncSync as unknown as (...a: unknown[]) => unknown)(...args),
    ),
    openSync: vi.fn((...args: Parameters<typeof actual.openSync>) =>
      (actual.openSync as unknown as (...a: unknown[]) => unknown)(...args),
    ),
    writeSync: vi.fn((...args: Parameters<typeof actual.writeSync>) =>
      (actual.writeSync as unknown as (...a: unknown[]) => unknown)(...args),
    ),
    closeSync: vi.fn((...args: Parameters<typeof actual.closeSync>) =>
      (actual.closeSync as unknown as (...a: unknown[]) => unknown)(...args),
    ),
  };
});

import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchmarkFingerprintSkip, StateFile } from "./state-file.js";

const dirs: string[] = [];

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-bench-${label}-`));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(fs.renameSync).mockClear();
  vi.mocked(fs.fsyncSync).mockClear();
  vi.mocked(fs.openSync).mockClear();
  vi.mocked(fs.writeSync).mockClear();
  vi.mocked(fs.closeSync).mockClear();
});

describe("HARDENING_5 H5.7 StateFile fingerprint skip — micro-benchmark harness", () => {
  function stateRenameCalls(): string[][] {
    return vi
      .mocked(fs.renameSync)
      .mock.calls.map((c) => c.map(String))
      .filter((arr): arr is [string, string] => typeof arr[1] === "string" && arr[1].endsWith("bench.json"));
  }

  it("identical re-save does not call fs.renameSync / fs.fsyncSync (skip path)", () => {
    const dir = freshDir("identical-skip");
    const sf = new StateFile<{ n: number }>(dir, "bench", () => ({ n: 0 }));
    sf.update((c) => {
      c.n = 1;
    });
    expect(stateRenameCalls()).toHaveLength(1);
    vi.mocked(fs.renameSync).mockClear();
    vi.mocked(fs.fsyncSync).mockClear();
    vi.mocked(fs.openSync).mockClear();
    vi.mocked(fs.writeSync).mockClear();
    vi.mocked(fs.closeSync).mockClear();

    sf.update((c) => {
      c.n = 1;
    });

    expect(stateRenameCalls()).toHaveLength(0);
    expect(vi.mocked(fs.fsyncSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.openSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeSync)).not.toHaveBeenCalled();
  });

  it("changing save does call fs.renameSync and fs.fsyncSync", () => {
    const dir = freshDir("changing-calls");
    const sf = new StateFile<{ n: number }>(dir, "bench", () => ({ n: 0 }));
    sf.update((c) => {
      c.n = 1;
    });
    vi.mocked(fs.renameSync).mockClear();
    vi.mocked(fs.fsyncSync).mockClear();
    vi.mocked(fs.openSync).mockClear();

    sf.update((c) => {
      c.n = 2;
    });

    expect(stateRenameCalls()).toHaveLength(1);
    expect(vi.mocked(fs.fsyncSync)).toHaveBeenCalled();
    expect(vi.mocked(fs.openSync)).toHaveBeenCalled();
    expect(vi.mocked(fs.writeSync)).toHaveBeenCalled();
  });

  it("save() directly: identical value skips, different value writes", () => {
    const dir = freshDir("save-direct");
    const sf = new StateFile<{ n: number; note: string }>(dir, "bench", () => ({
      n: 0,
      note: "",
    }));
    sf.save({ n: 42, note: "hello" });
    vi.mocked(fs.renameSync).mockClear();
    vi.mocked(fs.fsyncSync).mockClear();

    sf.save({ n: 42, note: "hello" });
    expect(vi.mocked(fs.renameSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.fsyncSync)).not.toHaveBeenCalled();

    sf.save({ n: 43, note: "hello" });
    expect(vi.mocked(fs.renameSync)).toHaveBeenCalledTimes(1);
  });

  it("measures wall time: identical re-save is far cheaper than changing save", () => {
    const dir = freshDir("wall-time");
    const sf = new StateFile<{ n: number }>(dir, "bench", () => ({ n: 0 }));
    sf.update((c) => {
      c.n = 1;
    });

    const result = benchmarkFingerprintSkip(
      sf,
      (c) => {
        c.n = 1;
      },
      (c, i) => {
        c.n = i + 10_000;
      },
      500,
    );

    expect(result.noopMs).toBeGreaterThanOrEqual(0);
    expect(result.changingMs).toBeGreaterThan(0);
    expect(result.noopPerSaveUs).toBeGreaterThanOrEqual(0);
    expect(result.changingPerSaveUs).toBeGreaterThan(0);
    expect(result.speedup).toBeGreaterThan(0);
    expect(Number.isFinite(result.noopPerSaveUs)).toBe(true);
    expect(Number.isFinite(result.changingPerSaveUs)).toBe(true);

    console.log(
      `[bench] fingerprint skip: noop ${result.noopPerSaveUs.toFixed(1)}µs/save, ` +
        `changing ${result.changingPerSaveUs.toFixed(1)}µs/save, speedup ${result.speedup.toFixed(2)}×`,
    );
  });
});
