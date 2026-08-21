import type { UiaBackend, UiaNode } from "./types.js";
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

/**
 * Production UI Automation backend. Talks to a real Windows UIA tree through
 * the PowerShellUiaBridge. Element ids are UIA runtime ids; every operation
 * re-resolves them against the live tree, so a handle whose control vanished
 * fails with a STALE_ELEMENT error instead of acting on a guess.
 */
export class RealUiaBackend implements UiaBackend {
  constructor(private readonly bridge: PowerShellUiaBridge) {}

  async listWindows(): Promise<UiaWindowInfo[]> {
    return this.bridge.request<UiaWindowInfo[]>("listWindows");
  }

  /** Attach to a top-level window by pid or title substring. */
  async attach(params: { pid?: number; titleContains?: string }): Promise<void> {
    await this.bridge.request("attach", params);
  }

  async detach(): Promise<void> {
    await this.bridge.request("detach");
  }

  /** Full semantic tree of the attached window (all control types). */
  async richTree(): Promise<{ pid: number; nodes: UiaRichNode[] }> {
    return this.bridge.request<{ pid: number; nodes: UiaRichNode[] }>("tree");
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
