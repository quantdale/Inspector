import type {
  UiaBackend,
  UiaBackendWindowOps,
  UiaNode,
  UiaWindowRef,
  WaitForWindowParams,
} from "./types.js";
import { WindowsBackendError } from "./types.js";
import { PowerShellUiaBridge } from "./uia-bridge.js";

/** Rich semantic node as reported by the PowerShell UIA bridge. */
export interface UiaRichNode {
  id: string;
  type: string;
  name: string;
  automationId: string;
  enabled: boolean;
  offscreen: boolean;
  rect: { x: number; y: number; w: number; h: number } | null;
  patterns: string[];
}

export interface UiaWindowInfo {
  pid: number;
  title: string;
}

/** Result of a full semantic tree enumeration. */
export interface UiaRichTree {
  pid: number;
  nodes: UiaRichNode[];
  modalBlocking?: boolean;
  /** Set when the backend detected rehost-collapse and reattached mid-call. */
  reattached?: boolean;
}

/**
 * Production UI Automation backend. Talks to a real Windows UIA tree through
 * the PowerShellUiaBridge. Element ids are UIA runtime ids; every operation
 * re-resolves them against the live tree, so a handle whose control vanished
 * fails with a STALE_ELEMENT error instead of acting on a guess.
 */
export class RealUiaBackend implements UiaBackend, UiaBackendWindowOps {
  constructor(private readonly bridge: PowerShellUiaBridge) {}

  /**
   * Node count of the last accepted (non-collapsed) tree for this attached
   * session; null until a first successful enumeration. Reset on attach and
   * detach so each session's baseline starts fresh.
   */
  private lastGoodNodeCount: number | null = null;

  async listWindows(): Promise<UiaWindowRef[]> {
    return this.bridge.request<UiaWindowInfo[]>("listWindows");
  }

  /** Attach to a top-level window by pid or title substring. */
  async attach(params: { pid?: number; titleContains?: string }): Promise<void> {
    this.lastGoodNodeCount = null;
    await this.bridge.request("attach", params);
  }

  async detach(): Promise<void> {
    this.lastGoodNodeCount = null;
    await this.bridge.request("detach");
  }

  /**
   * Full semantic tree of the attached window (all control types).
   *
   * Honesty gate: liveness is verified first; a dead target throws
   * DEAD_WINDOW instead of returning a stale/cached tree.
   *
   * Modal fallback: if the main window is blocked by a modal dialog the
   * bridge re-scopes enumeration to the desktop root filtered by pid (the
   * dialog is a top-level window of the same process), so the op stays
   * bounded and returns the live dialog tree. If the primary enumeration
   * still times out, one bounded desktop-root retry runs before failing.
   *
   * Rehost-collapse detection: some actions rehost content into a NEW
   * top-level HWND (e.g. Calculator "New Tab"). The process stays alive, but
   * the cached window root silently enumerates as a root-only stub — no
   * STALE_ELEMENT, no error, exploration just goes blind. When the returned
   * tree collapses versus this session's last good tree (root-only, or a
   * >90% node-count drop) while the process is still alive, the backend
   * re-resolves the process's current main window via desktop-root
   * enumeration scoped to the pid (the same machinery attach uses) and
   * returns the fresh tree with `reattached: true`. One bounded attempt
   * (~3s budget); failure raises REATTACH_FAILED rather than returning the
   * blind stub.
   */
  async richTree(): Promise<UiaRichTree> {
    const status = await this.windowStatus();
    if (!status.alive) {
      // Preserve the historical "nothing attached" signal that tree()'s lazy
      // attach path keys on; only a genuinely dead target is DEAD_WINDOW.
      if (status.pid === 0) throw new Error("NO_ATTACHED_WINDOW");
      throw new WindowsBackendError(
        "DEAD_WINDOW",
        `attached pid ${status.pid} is not running; refusing to return a stale tree`,
      );
    }
    let tree: UiaRichTree;
    try {
      tree = await this.bridge.request<UiaRichTree>("tree");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/bridge timeout/i.test(msg)) throw e;
      // Bounded fallback: enumerate from the desktop root scoped to the pid.
      tree = await this.bridge.request<UiaRichTree>("treeDesktop", { pid: status.pid });
    }
    if (this.isRehostCollapse(tree.nodes.length)) {
      const prev = this.lastGoodNodeCount ?? 0;
      try {
        const fresh = await this.attemptReattach(status.pid);
        this.lastGoodNodeCount = fresh.nodes.length;
        return { ...fresh, reattached: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new WindowsBackendError(
          "REATTACH_FAILED",
          `window rehost suspected (${prev} -> ${tree.nodes.length} nodes, pid ${status.pid} alive); ` +
            `reattach failed: ${msg}`,
        );
      }
    }
    this.lastGoodNodeCount = tree.nodes.length;
    return tree;
  }

  /**
   * Collapse heuristic: suspicious when the previous good enumeration had at
   * least 5 nodes and the new result is root-only (<=1) or lost >90% of its
   * nodes. The minimum baseline avoids false positives on trivially small
   * trees where a 1-node swing looks like a collapse.
   */
  private isRehostCollapse(nodeCount: number): boolean {
    const prev = this.lastGoodNodeCount;
    if (prev === null || prev < 5) return false;
    return nodeCount <= 1 || nodeCount * 10 < prev;
  }

  /**
   * One bounded reattach attempt: resolve the process's current top-level
   * window, re-attach (the bridge re-resolves the pid's main window from the
   * desktop root), and re-enumerate. ~3s total budget.
   */
  private async attemptReattach(pid: number): Promise<UiaRichTree> {
    const budget = new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error("reattach budget (3000ms) exceeded")), 3000);
      t.unref?.();
    });
    const work = (async () => {
      const windows = await this.listWindows();
      if (!windows.some((w) => w.pid === pid)) {
        throw new Error(`no top-level window remains for pid ${pid}`);
      }
      await this.attach({ pid });
      return this.bridge.request<UiaRichTree>("tree");
    })();
    return Promise.race([work, budget]);
  }

  /**
   * Bounded poll (250ms interval) until a top-level window matching pid or
   * title substring appears. Throws WINDOW_NOT_FOUND on timeout. Handles the
   * UWP launcher-pid gap where a freshly spawned calc/mspaint is absent from
   * the top-level window list for several seconds.
   */
  async waitForWindow(params: WaitForWindowParams): Promise<UiaWindowRef> {
    const requested = Math.min(Math.max(params.timeoutMs ?? 10000, 0), 60000);
    const deadline = Date.now() + requested;
    for (;;) {
      let windows: UiaWindowRef[] = [];
      try {
        windows = await this.listWindows();
      } catch {
        /* transient bridge hiccup; keep polling until the deadline */
      }
      const found = windows.find(
        (w) =>
          (params.pid !== undefined && w.pid === params.pid) ||
          (params.titleContains !== undefined &&
            params.titleContains.length > 0 &&
            w.title.includes(params.titleContains)),
      );
      if (found) return found;
      if (Date.now() >= deadline) {
        throw new WindowsBackendError(
          "WINDOW_NOT_FOUND",
          `no top-level window matching ` +
            `${params.pid !== undefined ? `pid=${params.pid}` : ""}` +
            `${params.pid !== undefined && params.titleContains ? " " : ""}` +
            `${params.titleContains !== undefined ? `title~="${params.titleContains}"` : ""}` +
            ` within ${requested}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async invoke(rid: string): Promise<void> {
    await this.bridge.request("invoke", { rid });
  }

  async toggle(rid: string): Promise<void> {
    await this.bridge.request("toggle", { rid });
  }

  async expandCollapse(rid: string, action: "expand" | "collapse"): Promise<void> {
    await this.bridge.request("expandCollapse", { rid, action });
  }

  async setValue(rid: string, value: string): Promise<void> {
    await this.bridge.request("setValue", { rid, value });
  }

  async select(rid: string): Promise<void> {
    await this.bridge.request("select", { rid });
  }

  async readValue(rid: string): Promise<string> {
    const r = await this.bridge.request<{ value: string }>("readValue", { rid });
    return r.value;
  }

  async readToggleState(rid: string): Promise<string> {
    const r = await this.bridge.request<{ state: string }>("readToggleState", { rid });
    return r.state;
  }

  async closeWindow(): Promise<void> {
    await this.bridge.request("closeWindow");
  }

  /** Liveness of the attached window and its owning process. */
  async windowStatus(): Promise<{ alive: boolean; pid: number }> {
    return this.bridge.request<{ alive: boolean; pid: number }>("windowStatus");
  }

  // ---- UiaBackend contract (same interface as MockUiaBackend) ----

  /**
   * Semantic tree projected onto the common UiaNode shape. Attaches lazily to
   * the first titled top-level window when nothing is attached yet.
   * Control types outside Button/Edit/Text are omitted from this projection;
   * use richTree() for the full semantic tree.
   */
  async tree(): Promise<UiaNode[]> {
    let tree: { pid: number; nodes: UiaRichNode[] };
    try {
      tree = await this.richTree();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("NO_ATTACHED_WINDOW")) throw e;
      const windows = await this.listWindows();
      const target = windows.find((w) => w.title.trim().length > 0) ?? windows[0];
      if (!target) throw new Error("no enumerable top-level window");
      await this.attach({ pid: target.pid });
      tree = await this.richTree();
    }
    return tree.nodes
      .filter((n) => n.type === "Button" || n.type === "Edit" || n.type === "Text" || n.type === "Document")
      .map((n) => ({
        id: n.id,
        type: (n.type === "Button" ? "Button" : n.type === "Text" ? "Text" : "Edit") as UiaNode["type"],
        text: n.name,
        enabled: n.enabled,
      }));
  }

  /** Real applications do not expose seeded fault records. */
  async errors(): Promise<string[]> {
    return [];
  }

  /** Detach so the next tree() re-attaches to a fresh window. */
  async reset(): Promise<void> {
    await this.detach();
  }

  /** Kill the PowerShell host. Callers must dispose to avoid orphans. */
  dispose(): void {
    this.bridge.dispose();
  }
}
