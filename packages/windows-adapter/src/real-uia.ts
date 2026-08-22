import type {
  UiaBackend,
  UiaBackendWindowOps,
  UiaNode,
  UiaWindowRef,
  WaitForWindowParams,
} from "./types.js";
import { WindowsBackendError } from "./types.js";
import type { PowerShellUiaBridge } from "./uia-bridge.js";

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
   * Root-level staleness thrown by the bridge when the CACHED window handle
   * died mid-operation (the HWND was destroyed/rehosted underneath us).
   * Distinct from element-level staleness ('runtime id not found in current
   * tree'), which must never be retried: the fresh tree honestly no longer
   * contains that control.
   */
  private static readonly STALE_WINDOW_GONE =
    /^STALE_ELEMENT: attached window is gone$/;

  /**
   * Node count of the last accepted (non-collapsed) tree for this attached
   * session; null until a first successful enumeration. Reset on attach and
   * detach so each session's baseline starts fresh.
   */
  private lastGoodNodeCount: number | null = null;

  /** Title of the attached window as of the successful attach; used by
   * rehost recovery to follow a window that migrated to a NEW owner pid
   * (e.g. Calculator "Keep on top" moves content into an always-on-top
   * window owned by a different process). Cleared on detach. */
  private lastAttachedTitle: string | null = null;

  async listWindows(): Promise<UiaWindowRef[]> {
    return this.bridge.request<UiaWindowInfo[]>("listWindows");
  }

  /** Attach to a top-level window by pid or title substring. */
  async attach(params: {
    pid?: number;
    titleContains?: string;
  }): Promise<void> {
    this.lastGoodNodeCount = null;
    const info = await this.bridge.request<{ name?: string }>("attach", params);
    this.lastAttachedTitle =
      typeof info?.name === "string" && info.name.trim().length > 0
        ? info.name
        : null;
  }

  async detach(): Promise<void> {
    this.lastGoodNodeCount = null;
    this.lastAttachedTitle = null;
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
      const msg = (e instanceof Error ? e.message : String(e)).trim();
      if (/bridge timeout/i.test(msg)) {
        // Bounded fallback: enumerate from the desktop root scoped to the pid.
        tree = await this.bridge.request<UiaRichTree>("treeDesktop", {
          pid: status.pid,
        });
      } else if (RealUiaBackend.STALE_WINDOW_GONE.test(msg)) {
        // The cached HWND died mid-enumeration although the pid was verified
        // alive moments ago (rehost transition). One bounded reattach + one
        // re-enumeration; failure re-raises the ORIGINAL staleness so a
        // genuinely dead target still surfaces as STALE_ELEMENT.
        try {
          await this.reattachToLiveWindow(status.pid);
          const fresh = await this.bridge.request<UiaRichTree>("tree");
          // attach() reset the baseline, so the collapse heuristic below is
          // inert here; mark the recovery explicitly instead.
          this.lastGoodNodeCount = fresh.nodes.length;
          return { ...fresh, reattached: true };
        } catch {
          throw e;
        }
      } else {
        throw e;
      }
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
   * Re-resolve the process's current main top-level window and attach to it.
   *
   * Same-pid first. If the pid no longer owns any enumerable top-level window
   * BUT a window carrying the remembered attached TITLE exists under another
   * owner, attach to that instead: UWP apps can migrate their visible window
   * across owner processes mid-session (observed: Calculator "Keep on top"
   * rehosts into an always-on-top window owned by a different pid). The
   * migration must be evidenced by the SAME window title — a merely similar
   * window never hijacks the session. Throws when neither path finds a live
   * window (the rehost consumed the last HWND or the process exited).
   */
  private async reattachToLiveWindow(pid: number): Promise<void> {
    const windows = await this.listWindows();
    if (windows.some((w) => w.pid === pid)) {
      await this.attach({ pid });
      return;
    }
    const hint = this.lastAttachedTitle;
    if (hint !== null) {
      const migrated = windows.find((w) => w.title === hint || w.title.includes(hint));
      if (migrated) {
        await this.attach({ pid: migrated.pid });
        return;
      }
    }
    throw new Error(`no top-level window remains for pid ${pid}`);
  }

  /**
   * Root-level staleness recovery for element-scoped operations.
   *
   * Win11 packaged apps (Paint) can destroy/rehost their top-level HWND
   * mid-session while the process stays alive; the next bridge op then fails
   * with 'STALE_ELEMENT: attached window is gone' even though exploration
   * could honestly continue against the new window. Semantics:
   *
   * - ONLY root-level staleness triggers recovery; element-level staleness
   *   ('runtime id not found in current tree') and all other errors pass
   *   through untouched.
   * - Recovery requires the owning PROCESS to still be alive AND to still
   *   own an enumerable top-level window; otherwise the original error is
   *   re-raised (a dead window is never resurrected or suppressed).
   * - Exactly ONE reattach + retry per operation, bounded like the existing
   *   rehost-collapse path -- never a blind retry loop.
   */
  private async withStaleWindowRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).trim();
      if (!RealUiaBackend.STALE_WINDOW_GONE.test(msg)) throw e;
      let status: { alive: boolean; pid: number };
      try {
        status = await this.windowStatus();
      } catch {
        throw e; // bridge itself is failing; original staleness stands
      }
      if (!status.alive || status.pid === 0) throw e; // dead target stays honest
      try {
        await this.reattachToLiveWindow(status.pid);
      } catch {
        throw e; // no live window remains -> staleness is the truth
      }
      return op();
    }
  }

  /**
   * One bounded reattach attempt: resolve the process's current top-level
   * window, re-attach (the bridge re-resolves the pid's main window from the
   * desktop root), and re-enumerate. ~3s total budget. The re-resolve polls
   * briefly (250ms interval) because rehosted windows can take a moment to
   * materialize as enumerable top-level surfaces; the budget is hard-capped.
   */
  private async attemptReattach(pid: number): Promise<UiaRichTree> {
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        await this.reattachToLiveWindow(pid);
        return await this.bridge.request<UiaRichTree>("tree");
      } catch (e) {
        if (Date.now() >= deadline) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
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
            `${params.pid === undefined ? "" : `pid=${params.pid}`}` +
            `${params.pid !== undefined && params.titleContains ? " " : ""}` +
            `${params.titleContains === undefined ? "" : `title~="${params.titleContains}"`}` +
            ` within ${requested}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async invoke(rid: string): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("invoke", { rid }),
    );
  }

  async toggle(rid: string): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("toggle", { rid }),
    );
  }

  async expandCollapse(
    rid: string,
    action: "expand" | "collapse",
  ): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("expandCollapse", { rid, action }),
    );
  }

  async setValue(rid: string, value: string): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("setValue", { rid, value }),
    );
  }

  async select(rid: string): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("select", { rid }),
    );
  }

  async readValue(rid: string): Promise<string> {
    const r = await this.withStaleWindowRetry(() =>
      this.bridge.request<{ value: string }>("readValue", {
        rid,
      }),
    );
    return r.value;
  }

  async readToggleState(rid: string): Promise<string> {
    const r = await this.withStaleWindowRetry(() =>
      this.bridge.request<{ state: string }>("readToggleState", {
        rid,
      }),
    );
    return r.state;
  }

  async closeWindow(): Promise<void> {
    await this.withStaleWindowRetry(() =>
      this.bridge.request("closeWindow"),
    );
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
      const target =
        windows.find((w) => w.title.trim().length > 0) ?? windows[0];
      if (!target) throw new Error("no enumerable top-level window");
      await this.attach({ pid: target.pid });
      tree = await this.richTree();
    }
    return tree.nodes
      .filter(
        (n) =>
          n.type === "Button" ||
          n.type === "Edit" ||
          n.type === "Text" ||
          n.type === "Document",
      )
      .map((n) => ({
        id: n.id,
        type: (n.type === "Button"
          ? "Button"
          : n.type === "Text"
            ? "Text"
            : "Edit") as UiaNode["type"],
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
