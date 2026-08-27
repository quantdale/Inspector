/**
 * M19 Platform Fidelity — Windows UIA 1-node subtree collapse detection.
 *
 * Mock bridge returns a 1-node tree after a rehost; the adapter must detect
 * DEAD/UWP_REHOST and return a typed error (DEAD_WINDOW / REATTACH_FAILED /
 * ROOT_ONLY_STUB) rather than a silent success with a blind stub.
 * Credential-free, deterministic, no real UIA.
 */
import { describe, it, expect } from "vitest";
import { RealUiaBackend } from "./real-uia.js";
import { WindowsBackendError } from "./types.js";
import { MockUiaBackend } from "./mock-uia.js";
import { WindowsAdapterHandler } from "./windows-adapter.js";

function node(id: string) {
  return {
    id,
    type: "Button" as const,
    name: id,
    automationId: "",
    enabled: true,
    offscreen: false,
    rect: null,
    patterns: [] as string[],
  };
}

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
        const h = handlers.listWindows ?? (() => [{ pid: 1234, title: "SeedBank" }]);
        return Promise.resolve(h() as T);
      }
      const h = handlers[op];
      if (!h) return Promise.reject(new Error(`unexpected op: ${op}`));
      return Promise.resolve(h(params ?? {}) as T);
    },
  };
}

describe("M19 UIA 1-node subtree collapse — typed error not success", () => {
  it("mock bridge returns 1-node tree after rehost → typed REATTACH_FAILED, never success", async () => {
    let calls = 0;
    const full = Array.from({ length: 20 }, (_, i) => node(`n${i}`));
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 1234 }),
        // After rehost, no top-level window remains for the pid → reattach fails.
        listWindows: () => [],
        tree: () => {
          calls++;
          return calls === 1
            ? { pid: 1234, nodes: full }
            : { pid: 1234, nodes: [node("root")] };
        },
        attach: () => {
          throw new Error("attach should not succeed when no window");
        },
      }) as never,
    );

    // Establish baseline (>=5 nodes).
    const baseline = await backend.richTree();
    expect(baseline.nodes.length).toBe(20);

    // Next fetch collapses to 1-node stub while pid is still alive.
    // Must be typed REATTACH_FAILED, never a blind success.
    let caught: unknown;
    try {
      await backend.richTree();
      expect.unreachable("should have thrown REATTACH_FAILED");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WindowsBackendError);
    expect((caught as WindowsBackendError).code).toBe("REATTACH_FAILED");
    expect(calls).toBe(2);
  });

  it("detects DEAD target via windowStatus and throws DEAD_WINDOW not REATTACH_FAILED", async () => {
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: false, pid: 1234 }),
        tree: () => ({ pid: 1234, nodes: Array.from({ length: 10 }, (_, i) => node(`x${i}`)) }),
      }) as never,
    );

    await expect(backend.richTree()).rejects.toMatchObject({ code: "DEAD_WINDOW" });
    try {
      await backend.richTree();
      expect.unreachable("should have thrown DEAD_WINDOW");
    } catch (e) {
      expect(e).toBeInstanceOf(WindowsBackendError);
      expect((e as WindowsBackendError).code).toBe("DEAD_WINDOW");
    }
  });

  it("UWP_REHOST: 1-node stub while alive with replacement window under same title → reattached success (positive control)", async () => {
    let calls = 0;
    const full = Array.from({ length: 20 }, (_, i) => node(`n${i}`));
    let attachPid: number | undefined;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 1234 }),
        // Rehost migrated SeedBank window to pid 5678 (UWP rehost pattern: same title,
        // different owner pid). listWindows shows only the new pid.
        listWindows: () => [{ pid: 5678, title: "SeedBank" }],
        tree: () => {
          calls++;
          // call1 baseline, call2 stub, call3 fresh after reattach
          if (calls === 1) return { pid: 1234, nodes: full };
          if (calls === 2) return { pid: 1234, nodes: [node("root")] };
          return { pid: 5678, nodes: full };
        },
        attach: (params) => {
          attachPid = params.pid as number;
          return { name: "SeedBank" };
        },
      }) as never,
    );

    // Seed remembered title by attaching first.
    await backend.attach({ pid: 1234 });
    await backend.richTree(); // baseline via new pid 1234? need baseline established
    // After attach, lastAttachedTitle = "SeedBank", now collapse triggers reattach via title
    const tree = await backend.richTree();
    // Should have followed title to new pid
    expect(attachPid).toBe(5678);
    expect(tree.reattached).toBe(true);
    expect(tree.nodes).toHaveLength(20);
  });
  it("adapter observe() path surfaces typed error — not a silent single-node success", async () => {
    // Use MockUiaBackend through WindowsAdapterHandler observe path to prove
    // the 1-node stub never becomes a valid observation.
    const backend = new MockUiaBackend();
    const handler = new WindowsAdapterHandler(backend as never);
    await handler.lifecycle({ op: "create" });
    // Establish baseline via observe (which calls richTree internally)
    const first = await handler.observe();
    const uiTree = first.summary.uiTree as unknown[];
    expect(uiTree.length).toBeGreaterThanOrEqual(5);
    // Arm rehost with no replacement → next observe must throw typed error, not return 1-node uiTree
    backend.rehostScenario = { replacementWindow: false };
    await expect(handler.observe()).rejects.toMatchObject({ code: "REATTACH_FAILED" });
  });
});
