/**
 * Unit tests for ROOT-level staleness recovery (RC1 release blocker fix):
 * Win11 packaged apps (Paint) can destroy/rehost their top-level HWND
 * mid-session while the process stays alive; the next bridge op then fails
 * with 'STALE_ELEMENT: attached window is gone'. The backend must perform
 * exactly one bounded reattach + retry when the pid is still alive and still
 * owns an enumerable top-level window, and must stay honest (re-raise) when
 * it is not. Element-level staleness is never retried. All backends are
 * injected fakes; no real UIA.
 */
import { describe, it, expect } from "vitest";
import { RealUiaBackend } from "./real-uia.js";

/** Scriptable fake of PowerShellUiaBridge with call recording. */
function fakeBridge(handlers: {
  windowStatus?: () => { alive: boolean; pid: number };
  listWindows?: () => { pid: number; title: string }[];
  attach?: (params?: Record<string, unknown>) => unknown;
  [op: string]: ((params: Record<string, unknown>) => unknown) | undefined;
}) {
  const calls: string[] = [];
  return {
    calls,
    request<T>(op: string, params?: Record<string, unknown>): Promise<T> {
      calls.push(op);
      if (op === "windowStatus") {
        const h = handlers.windowStatus ?? (() => ({ alive: true, pid: 4321 }));
        return Promise.resolve(h() as T);
      }
      if (op === "listWindows") {
        const h =
          handlers.listWindows ?? (() => [{ pid: 4321, title: "Paint" }]);
        return Promise.resolve(h() as T);
      }
      if (op === "attach") {
        const h = handlers.attach ?? (() => true);
        return Promise.resolve(h(params ?? {}) as T);
      }
      const h = handlers[op];
      if (!h) return Promise.reject(new Error(`unexpected op: ${op}`));
      return Promise.resolve(h(params ?? {}) as T);
    },
    dispose(): void {},
  };
}

const STALE_WINDOW = "STALE_ELEMENT: attached window is gone";
const STALE_ELEMENT =
  "STALE_ELEMENT: runtime id not found in current tree: 42-42-7";

describe("root-level stale-window reattach + single retry", () => {
  it("invoke(): reattaches once and retries when the pid is alive with a live window", async () => {
    let invocations = 0;
    const bridge = fakeBridge({
      invoke: () => {
        invocations++;
        if (invocations === 1) throw new Error(STALE_WINDOW);
        return true;
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await backend.attach({ pid: 4321 });
    await expect(backend.invoke("1-2-3")).resolves.toBeUndefined();
    expect(invocations).toBe(2);
    // recovery path: windowStatus, listWindows, attach, then the retry
    expect(bridge.calls).toEqual([
      "attach",
      "invoke",
      "windowStatus",
      "listWindows",
      "attach",
      "invoke",
    ]);
  });

  it("readValue(): recovers and returns the value from the fresh window", async () => {
    let reads = 0;
    const bridge = fakeBridge({
      readValue: () => {
        reads++;
        if (reads === 1) throw new Error(STALE_WINDOW);
        return { value: "hello" };
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.readValue("7-7-1")).resolves.toBe("hello");
    expect(reads).toBe(2);
  });

  it("does NOT retry when the owning process is dead — staleness stands", async () => {
    const bridge = fakeBridge({
      invoke: () => {
        throw new Error(STALE_WINDOW);
      },
      windowStatus: () => ({ alive: false, pid: 4321 }),
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.invoke("1-2-3")).rejects.toThrow(STALE_WINDOW);
    expect(bridge.calls).toEqual(["invoke", "windowStatus"]);
  });

  it("does NOT retry when no top-level window remains for the pid", async () => {
    const bridge = fakeBridge({
      invoke: () => {
        throw new Error(STALE_WINDOW);
      },
      listWindows: () => [], // rehost consumed the last HWND
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.invoke("1-2-3")).rejects.toThrow(STALE_WINDOW);
    expect(bridge.calls).toEqual(["invoke", "windowStatus", "listWindows"]);
  });

  it("never retries ELEMENT-level staleness — a vanished control stays failed", async () => {
    const bridge = fakeBridge({
      invoke: () => {
        throw new Error(STALE_ELEMENT);
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.invoke("1-2-3")).rejects.toThrow(
      /runtime id not found/,
    );
    expect(bridge.calls).toEqual(["invoke"]);
  });

  it("passes unrelated errors through untouched", async () => {
    const bridge = fakeBridge({
      invoke: () => {
        throw new Error("PATTERN_UNSUPPORTED: Invoke");
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.invoke("1-2-3")).rejects.toThrow(
      /PATTERN_UNSUPPORTED/,
    );
    expect(bridge.calls).toEqual(["invoke"]);
  });

  it("retries at most ONCE per operation even if staleness repeats", async () => {
    let invocations = 0;
    const bridge = fakeBridge({
      invoke: () => {
        invocations++;
        throw new Error(STALE_WINDOW); // fails both before AND after reattach
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await expect(backend.invoke("1-2-3")).rejects.toThrow(STALE_WINDOW);
    expect(invocations).toBe(2);
  });

  it("richTree(): recovers from root staleness mid-enumeration with reattached: true", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      type: "Button",
      name: `n${i}`,
      automationId: "",
      enabled: true,
      offscreen: false,
      rect: null,
      patterns: [],
    }));
    let trees = 0;
    const bridge = fakeBridge({
      tree: () => {
        trees++;
        if (trees === 1) throw new Error(STALE_WINDOW);
        return { pid: 4321, nodes };
      },
    });
    const backend = new RealUiaBackend(bridge as never);
    await backend.attach({ pid: 4321 });
    const tree = await backend.richTree();
    expect(tree.nodes.length).toBe(12);
    expect(tree.reattached).toBe(true);
  });
});
