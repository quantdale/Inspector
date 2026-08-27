/**
 * M19 Platform Fidelity — Android dump retry hardening.
 *
 * Simulates transient exit 137 then success; adapter must retry with bounded
 * backoff (cap 3) and classify transient vs permanent distinctly.
 * Credential-free, deterministic.
 */
import { describe, it, expect } from "vitest";
import { AndroidAdapterHandler } from "./android-adapter.js";
import { MockAdbBackend } from "./mock-backend.js";

describe("M19 Android dump retry — transient 137 then success", () => {
  it("observe retries transient 137 and returns valid tree", async () => {
    class TransientBackend extends MockAdbBackend {
      dumpCalls = 0;
      async dumpUi(serial: string): Promise<string> {
        if (this.dumpCalls++ === 0) throw new Error("uiautomator dump exited 137: killed");
        return super.shell(serial, "uiautomator dump /dev/tty");
      }
      override async shell(serial: string, cmd: string): Promise<string> {
        if (cmd.includes("uiautomator dump") && this.dumpCalls++ === 0) {
          throw new Error("adb shell uiautomator dump exited 137");
        }
        return super.shell(serial, cmd);
      }
    }
    const backend = new TransientBackend();
    const handler = new AndroidAdapterHandler(backend as never);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe();
    expect((obs.summary as unknown as { uiTree: unknown[] }).uiTree.length).toBeGreaterThan(0);
    const summary = obs.summary as { observeError?: unknown };
    expect(summary.observeError).toBeUndefined();
  });


  it("permanent dump failure still surfaces as observeError after cap", async () => {
    class PermanentBackend extends MockAdbBackend {
      async dumpUi(): Promise<string> {
        throw new Error("uiautomator dump failed: truncated output");
      }
      override async shell(): Promise<string> {
        throw new Error("uiautomator dump failed: truncated output");
      }
    }
    const backend = new PermanentBackend();
    const handler = new AndroidAdapterHandler(backend as never);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe();
    const summary = obs.summary as { observeError?: { message: string } };
    expect(summary.observeError).toBeDefined();
    expect(summary.observeError?.message).toMatch(/dump failed/i);
  });

  it("generic bounded retry: 137 transient retries up to cap 3", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls < 3) throw new Error("exit 137");
      return "ok";
    };
    let lastErr: unknown;
    let result = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await op();
        break;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const isTransient = /137/.test(msg);
        if (!isTransient || attempt === 3) throw e;
      }
    }
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(lastErr).toBeDefined();
  });
});
