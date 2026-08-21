/**
 * Unit tests for rehost-collapse honesty (audit finding C-F2): invoking an
 * action that rehosts content into a NEW top-level HWND leaves the cached
 * window root enumerating a silent 1-node stub. richTree() must detect the
 * collapse, perform one bounded reattach, and either return the fresh tree
 * with `reattached: true` or raise typed REATTACH_FAILED — never return the
 * blind stub. All backends are injected fakes; no real UIA.
 */
import { describe, it, expect } from "vitest";
import { RealUiaBackend } from "./real-uia.js";
import { MockUiaBackend } from "./mock-uia.js";

/** Scriptable fake of PowerShellUiaBridge.request(). */
function fakeBridge(handlers: {
  windowStatus?: () => { alive: boolean; pid: number };
  listWindows?: () => { pid: number; title: string }[];
  [op: string]: ((params: Record<string, unknown>) => unknown) | undefined;
}) {
  return {
    request<T>(op: string, params?: Record<string, unknown>): Promise<T> {
      if (op === "windowStatus") {
        const h = handlers.windowStatus ?? (() => ({ alive: true, pid: 1234 }));
        return Promise.resolve(h() as T);
      }
      if (op === "listWindows") {
        const h = handlers.listWindows ?? (() => [{ pid: 4321, title: "Calculator" }]);
        return Promise.resolve(h() as T);
      }
      const h = handlers[op];
      if (!h) return Promise.reject(new Error(`unexpected op: ${op}`));
      return Promise.resolve(h(params ?? {}) as T);
    },
  };
}

function node(id: string) {
  return { id, type: "Button", name: id, automationId: "", enabled: true, offscreen: false, rect: null, patterns: [] };
}

describe("rehost-collapse detection and bounded reattach", () => {
  it("detects collapse and returns the fresh tree with reattached: true", async () => {
    const full = Array.from({ length: 30 }, (_, i) => node(`n${i}`));
    let collapsed = false;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        tree: () => {
          // First call establishes the baseline; the post-invoke call
          // enumerates the silent root-only stub from the stale HWND.
          if (!collapsed) return { pid: 4321, nodes: full };
          collapsed = false;
          return { pid: 4321, nodes: [node("root")] };
        },
        attach: () => node("newHwnd"),
      }) as never,
    );
    await backend.richTree(); // baseline, 30 nodes
    collapsed = true;
    const tree = await backend.richTree();
    expect(tree.reattached).toBe(true);
    expect(tree.nodes).toHaveLength(30);
  });

  it("reattaches via the same pid when the process is still alive", async () => {
    let attachParams: Record<string, unknown> | undefined;
    let calls = 0;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        listWindows: () => [{ pid: 4321, title: "Calculator" }],
        tree: () => {
          // call 1: baseline; call 2: post-rehost stub; call 3 (post-reattach): fresh full tree.
          return ++calls === 2
            ? { pid: 4321, nodes: [node("root")] }
            : { pid: 4321, nodes: Array.from({ length: 20 }, (_, i) => node(`a${i}`)) };
        },
        attach: (params) => {
          attachParams = params;
          return {};
        },
      }) as never,
    );
    await backend.richTree();
    const tree = await backend.richTree();
    expect(attachParams).toEqual({ pid: 4321 });
    expect(tree.reattached).toBe(true);
    expect(tree.nodes).toHaveLength(20);
  });

  it("throws typed REATTACH_FAILED instead of returning the blind stub when reattach fails", async () => {
    let calls = 0;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        // No top-level window remains for the pid after the rehost.
        listWindows: () => [],
        tree: () => {
          calls++;
          return calls === 1
            ? { pid: 4321, nodes: Array.from({ length: 20 }, (_, i) => node(`a${i}`)) }
            : { pid: 4321, nodes: [node("root")] };
        },
        attach: () => {
          throw new Error("attach should not be reached");
        },
      }) as never,
    );
    await backend.richTree();
    await expect(backend.richTree()).rejects.toMatchObject({ code: "REATTACH_FAILED" });
    expect(calls).toBe(2);
  });

  it("does not reattach on a normal <90% count drop", async () => {
    let attaches = 0;
    let calls = 0;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        tree: () => {
          calls++;
          // 40 -> 10 nodes is a 75% drop; legitimately smaller content.
          return calls === 1
            ? { pid: 4321, nodes: Array.from({ length: 40 }, (_, i) => node(`b${i}`)) }
            : { pid: 4321, nodes: Array.from({ length: 10 }, (_, i) => node(`c${i}`)) };
        },
        attach: () => {
          attaches++;
          return {};
        },
      }) as never,
    );
    await backend.richTree();
    const tree = await backend.richTree();
    expect(tree.reattached).toBeUndefined();
    expect(tree.nodes).toHaveLength(10);
    expect(attaches).toBe(0);
  });
});

describe("mock backend equivalent rehost-collapse semantics", () => {
  it("collapse detected -> reattach succeeds with reattached: true", async () => {
    const mock = new MockUiaBackend();
    await mock.richTree(); // baseline (>=5 nodes)
    mock.rehostScenario = { replacementWindow: true };
    const tree = await mock.richTree();
    expect(tree.reattached).toBe(true);
    expect(tree.nodes.length).toBeGreaterThanOrEqual(5);
    // Scenario consumed; subsequent trees are normal.
    expect((await mock.richTree()).reattached).toBeUndefined();
  });

  it("collapse detected -> reattach fails -> typed REATTACH_FAILED, never a stub", async () => {
    const mock = new MockUiaBackend();
    await mock.richTree();
    mock.rehostScenario = { replacementWindow: false };
    await expect(mock.richTree()).rejects.toMatchObject({ code: "REATTACH_FAILED" });
    await expect(mock.richTree()).rejects.toThrow(/REATTACH_FAILED|rehost suspected/);
  });

  it("no false reattach before a baseline exists or on normal trees", async () => {
    const mock = new MockUiaBackend();
    mock.rehostScenario = { replacementWindow: true };
    // No baseline yet: the stub heuristic cannot fire, so the first tree is
    // returned normally despite the armed scenario.
    const first = await mock.richTree();
    expect(first.reattached).toBeUndefined();
    expect(first.nodes.length).toBeGreaterThanOrEqual(5);
    // With the scenario disarmed, subsequent normal trees never reattach.
    mock.rehostScenario = null;
    const second = await mock.richTree();
    expect(second.reattached).toBeUndefined();
  });
});
