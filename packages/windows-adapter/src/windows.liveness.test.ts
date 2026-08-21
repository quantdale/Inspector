/**
 * Unit tests for the honesty fixes: liveness-gated richTree (DEAD_WINDOW),
 * bounded modal/timeout fallback to desktop-root enumeration, and
 * waitForWindow polling. All backends are injected fakes; no real UIA.
 */
import { describe, it, expect } from "vitest";
import { RealUiaBackend } from "./real-uia.js";
import { MockUiaBackend, MOCK_SEED_PID } from "./mock-uia.js";
import { WindowsBackendError } from "./types.js";
import type { UiaWindowInfo } from "./real-uia.js";

/** Scriptable fake of PowerShellUiaBridge.request(). */
function fakeBridge(handlers: {
  windowStatus?: () => { alive: boolean; pid: number };
  listWindows?: () => UiaWindowInfo[];
  [op: string]: ((params: Record<string, unknown>) => unknown) | undefined;
}) {
  return {
    request<T>(op: string, params?: Record<string, unknown>): Promise<T> {
      if (op === "windowStatus") {
        const h = handlers.windowStatus ?? (() => ({ alive: true, pid: 1234 }));
        return Promise.resolve(h() as T);
      }
      if (op === "listWindows") {
        const h = handlers.listWindows ?? (() => []);
        return Promise.resolve(h() as T);
      }
      const h = handlers[op];
      if (!h) return Promise.reject(new Error(`unexpected op: ${op}`));
      return Promise.resolve(h(params ?? {}) as T);
    },
  };
}

describe("richTree liveness gate", () => {
  it("throws typed DEAD_WINDOW and never enumerates when the target is dead", async () => {
    let treeAsked = false;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: false, pid: 4321 }),
        tree: () => {
          treeAsked = true;
          return { pid: 4321, nodes: [] };
        },
      }) as never,
    );
    await expect(backend.richTree()).rejects.toMatchObject({
      code: "DEAD_WINDOW",
    });
    await expect(backend.richTree()).rejects.toThrow(WindowsBackendError);
    expect(treeAsked).toBe(false);
  });

  it("preserves NO_ATTACHED_WINDOW when nothing is attached (pid 0)", async () => {
    const backend = new RealUiaBackend(
      fakeBridge({ windowStatus: () => ({ alive: false, pid: 0 }) }) as never,
    );
    await expect(backend.richTree()).rejects.toThrow(/NO_ATTACHED_WINDOW/);
  });

  it("returns the tree when the target is alive", async () => {
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        tree: () => ({ pid: 4321, nodes: [{ id: "1-2-3", type: "Button" }] }),
      }) as never,
    );
    const tree = await backend.richTree();
    expect(tree.pid).toBe(4321);
    expect(tree.nodes).toHaveLength(1);
  });
});

describe("richTree modal/timeout fallback", () => {
  it("falls back to a bounded desktop-root enumeration when the primary op times out", async () => {
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        tree: () => {
          throw new Error("UIA bridge timeout after 10000ms (op=tree)");
        },
        treeDesktop: (params) => {
          expect(params.pid).toBe(4321);
          return { pid: 4321, nodes: [{ id: "9-9-9", type: "Window" }], modalBlocking: true };
        },
      }) as never,
    );
    const tree = await backend.richTree();
    expect(tree.modalBlocking).toBe(true);
    expect(tree.nodes[0]!.id).toBe("9-9-9");
  });

  it("propagates non-timeout errors unchanged (no fallback masking)", async () => {
    let desktopAsked = false;
    const backend = new RealUiaBackend(
      fakeBridge({
        windowStatus: () => ({ alive: true, pid: 4321 }),
        tree: () => {
          throw new Error("STALE_ELEMENT: runtime id not found");
        },
        treeDesktop: () => {
          desktopAsked = true;
          return { pid: 4321, nodes: [] };
        },
      }) as never,
    );
    await expect(backend.richTree()).rejects.toThrow(/STALE_ELEMENT/);
    expect(desktopAsked).toBe(false);
  });
});

describe("waitForWindow polling", () => {
  it("resolves once the window appears after several polls", async () => {
    let polls = 0;
    const backend = new RealUiaBackend(
      fakeBridge({
        listWindows: () => {
          polls++;
          return polls >= 3 ? [{ pid: 777, title: "Untitled - Paint" }] : [];
        },
      }) as never,
    );
    const win = await backend.waitForWindow({ pid: 777, timeoutMs: 5000 });
    expect(win.pid).toBe(777);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("matches by title substring", async () => {
    const backend = new RealUiaBackend(
      fakeBridge({
        listWindows: () => [{ pid: 1, title: "Doc - Notepad" }],
      }) as never,
    );
    const win = await backend.waitForWindow({ titleContains: "Notepad", timeoutMs: 1000 });
    expect(win.title).toContain("Notepad");
  });

  it("throws typed WINDOW_NOT_FOUND on timeout", async () => {
    const backend = new RealUiaBackend(fakeBridge({}) as never);
    const start = Date.now();
    await expect(
      backend.waitForWindow({ titleContains: "Never", timeoutMs: 600 }),
    ).rejects.toMatchObject({ code: "WINDOW_NOT_FOUND" });
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe("mock backend equivalent semantics", () => {
  it("reports dead status and a typed DEAD_WINDOW tree after deviceCrashed", async () => {
    const mock = new MockUiaBackend();
    expect(await mock.windowStatus()).toEqual({ alive: true, pid: MOCK_SEED_PID });
    mock.deviceCrashed = true;
    expect(await mock.windowStatus()).toMatchObject({ alive: false });
    await expect(mock.tree()).rejects.toMatchObject({ code: "DEAD_WINDOW" });
    expect(await mock.listWindows()).toEqual([]);
  });

  it("waitForWindow resolves for the seeded window and times out otherwise", async () => {
    const mock = new MockUiaBackend();
    const win = await mock.waitForWindow({ titleContains: "SeedBank", timeoutMs: 2000 });
    expect(win.pid).toBe(MOCK_SEED_PID);
    await expect(
      mock.waitForWindow({ titleContains: "Absent", timeoutMs: 400 }),
    ).rejects.toMatchObject({ code: "WINDOW_NOT_FOUND" });
  });
});
