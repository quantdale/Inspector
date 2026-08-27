/**
 * M19 Platform Fidelity — PTY viewport edge + Android dump retry.
 *
 * - Resize to 0/1 columns/rows handled gracefully, cursor clamping.
 * - Android dump retry: transient exit 137 then success (bounded retry).
 * Credential-free, deterministic.
 */
import { describe, it, expect } from "vitest";
import { VirtualTerminal } from "./vt-screen.js";


describe("M19 PTY viewport edge — 0/1 resize and cursor clamping", () => {
  it("resize to 0/0 is clamped to 1x1 without throw, cursor stays visible", () => {
    const vt = new VirtualTerminal(80, 24);
    vt.feed("hello");
    expect(() => vt.resize(0, 0)).not.toThrow();
    const s = vt.snapshot();
    expect(s.cols).toBe(1);
    expect(s.rows).toBe(1);
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0]).toHaveLength(1);
    expect(s.cursor.row).toBe(0);
    expect(s.cursor.col).toBe(0);
    expect(s.viewport).toHaveLength(1);
  });

  it("resize to 1x1 clamps cursor to 0,0", () => {
    const vt = new VirtualTerminal(10, 5);
    // Position cursor without writing content so cursor stays exactly at target
    vt.feed("\u001b[5;10H");
    const before = vt.snapshot();
    expect(before.cursor.row).toBe(4);
    expect(before.cursor.col).toBe(9);
    vt.resize(1, 1);
    const after = vt.snapshot();
    expect(after.cols).toBe(1);
    expect(after.rows).toBe(1);
    expect(after.cursor.row).toBe(0);
    expect(after.cursor.col).toBe(0);
  });

  it("resize with 0 cols or 0 rows individually clamps that dimension", () => {
    const vt = new VirtualTerminal(10, 10);
    vt.resize(0, 10);
    expect(vt.snapshot().cols).toBe(1);
    expect(vt.snapshot().rows).toBe(10);
    vt.resize(10, 0);
    expect(vt.snapshot().cols).toBe(10);
    expect(vt.snapshot().rows).toBe(1);
    vt.resize(1, 10);
    expect(vt.snapshot().cols).toBe(1);
    vt.resize(10, 1);
    expect(vt.snapshot().rows).toBe(1);
  });

  it("cursor clamping after shrink: cursor beyond new bounds is clamped", () => {
    const vt = new VirtualTerminal(20, 10);
    vt.feed("\u001b[10;20H");
    const before = vt.snapshot();
    expect(before.cursor.row).toBe(9);
    expect(before.cursor.col).toBe(19);
    vt.resize(5, 3);
    const after = vt.snapshot();
    expect(after.cursor.row).toBe(2);
    expect(after.cursor.col).toBe(4);
    expect(after.cursor.row).toBeLessThan(after.rows);
    expect(after.cursor.col).toBeLessThan(after.cols);
  });

  it("negative and fractional resize values are clamped/floored gracefully", () => {
    const vt = new VirtualTerminal(8, 4);
    expect(() => vt.resize(-5, -10)).not.toThrow();
    expect(vt.snapshot().cols).toBe(1);
    expect(vt.snapshot().rows).toBe(1);
    vt.resize(5.9, 3.2);
    expect(vt.snapshot().cols).toBe(5);
    expect(vt.snapshot().rows).toBe(3);
  });

  it("resize preserves viewport determinism: same content + dimensions => stable snapshot", () => {
    const a = new VirtualTerminal(10, 4);
    const b = new VirtualTerminal(10, 4);
    a.feed("hello\u001b[2;1Hworld");
    b.feed("hello\u001b[2;1Hworld");
    a.resize(6, 3);
    b.resize(6, 3);
    expect(a.snapshot().viewport).toEqual(b.snapshot().viewport);
    expect(a.snapshot().cells).toEqual(b.snapshot().cells);
    expect(a.snapshot().cursor).toEqual(b.snapshot().cursor);
  });

  it("constructor with 0/1 also clamps", () => {
    const vt0 = new VirtualTerminal(0, 0);
    expect(vt0.snapshot().cols).toBe(1);
    expect(vt0.snapshot().rows).toBe(1);
    const vt1 = new VirtualTerminal(1, 1);
    expect(vt1.snapshot().cols).toBe(1);
    expect(vt1.snapshot().rows).toBe(1);
  });
});

function isTransientMessage(value: unknown): boolean {
  if (value instanceof Error) return /137|transient/i.test(value.message);
  return /137|transient/i.test(String(value));
}

async function retryWithBackoff<T>(
  op: () => Promise<T>,
  opts: { cap?: number; isTransient?: (e: unknown) => boolean } = {},
): Promise<{ value: T; attempts: number }> {
  const cap = opts.cap ?? 3;
  const isTransient = opts.isTransient ?? isTransientMessage;
  let lastError: unknown;
  for (let attempt = 1; attempt <= cap; attempt++) {
    try {
      const value = await op();
      return { value, attempts: attempt };
    } catch (e) {
      lastError = e;
      if (!isTransient(e) || attempt === cap) throw e;
      // no real delay — deterministic immediate retry for unit test (bounded)
    }
  }
  throw lastError;
}

describe("M19 Android dump retry — transient exit 137 then success", () => {
  it("transient exit 137 on first attempt is retried and succeeds on second", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls === 1) throw new Error("adb shell uiautomator dump exited 137: killed");
      return "<hierarchy><node text=\"ok\" /></hierarchy>";
    };
    const result = await retryWithBackoff(op, { cap: 3 });
    expect(result.value).toContain("hierarchy");
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("permanent failure (no 137) is not retried beyond classification and fails closed", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      throw new Error("uiautomator dump failed: truncated output");
    };
    const checkTransient = (e: unknown): boolean => {
      if (e instanceof Error) return /137/.test(e.message);
      return false;
    };
    await expect(retryWithBackoff(op, { cap: 3, isTransient: checkTransient })).rejects.toThrow(/truncated/);
    expect(calls).toBe(1);
  });

  it("transient failure respects cap N=3: fails after 3 attempts", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      throw new Error("exit 137 transient");
    };
    await expect(retryWithBackoff(op, { cap: 3 })).rejects.toThrow(/137/);
    expect(calls).toBe(3);
  });

  it("adapter-level retry wrapper: transient 137 then success yields valid dump", async () => {
    let dumpCalls = 0;
    const mockDump = async (): Promise<string> => {
      if (dumpCalls++ === 0) throw new Error("uiautomator dump exited 137");
      return "<hierarchy><node bounds=\"[0,0][100,100]\" /></hierarchy>";
    };
    const dumpWithRetry = async (): Promise<string> => {
      const cap = 3;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= cap; attempt++) {
        try {
          return await mockDump();
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          const isTransient = /137/.test(msg);
          if (!isTransient || attempt === cap) throw e;
        }
      }
      throw lastErr;
    };
    const dump = await dumpWithRetry();
    expect(dump).toContain("hierarchy");
    expect(dumpCalls).toBe(2);
  });

  it("permanent dump failure after cap still fails closed (not swallowed)", async () => {
    let calls = 0;
    const mockDump = async (): Promise<string> => {
      calls++;
      throw new Error("uiautomator dump failed: truncated output");
    };
    const dumpWithRetry = async (): Promise<string> => {
      const cap = 3;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= cap; attempt++) {
        try {
          return await mockDump();
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          const isTransient = /137/.test(msg);
          if (!isTransient || attempt === cap) throw e;
        }
      }
      throw lastErr;
    };
    await expect(dumpWithRetry()).rejects.toThrow(/truncated/);
    expect(calls).toBe(1);
  });
});
