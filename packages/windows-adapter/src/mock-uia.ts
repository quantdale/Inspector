import type {
  UiaBackend,
  UiaBackendWindowOps,
  UiaNode,
  UiaWindowRef,
  WaitForWindowParams,
} from "./types.js";
import { WindowsBackendError } from "./types.js";
import type { UiaRichNode, UiaRichTree } from "./real-uia.js";

interface MockWinApp {
  screen: "login" | "dashboard";
  username: string;
  password: string;
  message: string;
  count: number;
  errors: string[];
}

function initial(): MockWinApp {
  return { screen: "login", username: "", password: "", message: "", count: 0, errors: [] };
}

/** Fixed mock pid so window ops have stable, testable semantics. */
export const MOCK_SEED_PID = 4242;

/**
 * Seeded Win32 target ("SeedBank dialog"). Hidden defects mirror the other
 * seeded targets so the common finding pipeline proves out on Windows.
 */
export class MockUiaBackend implements UiaBackend, UiaBackendWindowOps {
  deviceCrashed = false;
  private app: MockWinApp = initial();

  /**
   * Injectable rehost-collapse scenario, mirroring RealUiaBackend's
   * rehost-collapse semantics: when set (and a good baseline tree exists),
   * the cached window enumerates as a root-only stub. The bounded reattach
   * succeeds with `reattached: true` when `replacementWindow` is true and
   * fails with typed REATTACH_FAILED when it is false.
   */
  rehostScenario: { replacementWindow: boolean } | null = null;
  /** Node count of the last accepted (non-collapsed) rich tree this session. */
  private lastGoodRichCount: number | null = null;

  async tree(): Promise<UiaNode[]> {
    this.assertAlive();
    const a = this.app;
    if (a.screen === "login") {
      return [
        { id: "usernameLabel", type: "Text", text: "Username", enabled: true },
        { id: "username", type: "Edit", text: a.username, enabled: true },
        { id: "password", type: "Edit", text: a.password, enabled: true },
        { id: "loginBtn", type: "Button", text: "Log in", enabled: true },
        { id: "msg", type: "Text", text: a.message, enabled: true },
      ];
    }
    return [
      { id: "welcome", type: "Text", text: `Welcome ${a.username}`, enabled: true },
      { id: "count", type: "Text", text: Number.isNaN(a.count) ? "NaN" : String(a.count), enabled: true },
      { id: "incrementBtn", type: "Button", text: "Increment", enabled: true },
      { id: "saveBtn", type: "Button", text: "Save preference", enabled: true },
      { id: "boomBtn", type: "Button", text: "Trigger crash", enabled: true },
      { id: "logoutBtn", type: "Button", text: "Log out", enabled: true },
    ];
  }

  async invoke(id: string): Promise<void> {
    this.assertAlive();
    const a = this.app;
    const visible = await this.tree();
    const node = visible.find((n) => n.id === id && n.type === "Button");
    if (!node) throw new Error(`element not found or not invokable: ${id}`);
    switch (id) {
      case "loginBtn": {
        if (a.username.length >= 64 || a.username === "CRASH") {
          a.errors.push("HiddenValidationCrash");
          return;
        }
        if (a.username && a.password) {
          a.screen = "dashboard";
        } else {
          a.message = "invalid credentials";
        }
        return;
      }
      case "incrementBtn": {
        a.count += 1;
        if (a.count >= 8) {
          a.count = Number.NaN;
          a.errors.push("IncrementOverflowCrash");
        }
        return;
      }
      case "boomBtn":
        a.errors.push("IntentionalAppCrash");
        return;
      case "logoutBtn":
        this.app = initial();
        return;
      default:
        return;
    }
  }

  async setValue(id: string, value: string): Promise<void> {
    this.assertAlive();
    if (this.app.screen !== "login") throw new Error(`element not found: ${id}`);
    if (id === "username") this.app.username = value;
    else if (id === "password") this.app.password = value;
    else throw new Error(`element not found or not editable: ${id}`);
  }

  async errors(): Promise<string[]> {
    return [...this.app.errors];
  }

  async reset(): Promise<void> {
    this.app = initial();
    this.rehostScenario = null;
    this.lastGoodRichCount = null;
  }

  // ---- Rich tree with rehost-collapse semantics (mirror of RealUiaBackend) ----

  /**
   * Full semantic tree of the seeded window. Applies the same collapse
   * heuristic (root-only or >90% drop versus the last good tree, baseline
   * >= 5 nodes) and the same one-attempt bounded reattach contract as the
   * real backend, driven by the injectable `rehostScenario`.
   */
  async richTree(): Promise<UiaRichTree> {
    this.assertAlive();
    const stubbed = this.rehostScenario !== null && this.lastGoodRichCount !== null;
    const nodes: UiaRichNode[] = stubbed ? [this.richStub()] : (await this.richProjection());
    if (this.isRehostCollapse(nodes.length)) {
      try {
        if (!this.rehostScenario?.replacementWindow) {
          throw new Error("no replacement top-level window for the pid");
        }
        // Reattach lands on the new window; the scenario is consumed.
        this.rehostScenario = null;
        const fresh = await this.richProjection();
        this.lastGoodRichCount = fresh.length;
        return { pid: MOCK_SEED_PID, nodes: fresh, reattached: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new WindowsBackendError(
          "REATTACH_FAILED",
          `window rehost suspected (${this.lastGoodRichCount ?? 0} -> ${nodes.length} nodes, ` +
            `pid ${MOCK_SEED_PID} alive); reattach failed: ${msg}`,
        );
      }
    }
    this.lastGoodRichCount = nodes.length;
    return { pid: MOCK_SEED_PID, nodes };
  }

  /** Same heuristic as RealUiaBackend.isRehostCollapse. */
  private isRehostCollapse(nodeCount: number): boolean {
    const prev = this.lastGoodRichCount;
    if (prev === null || prev < 5) return false;
    return nodeCount <= 1 || nodeCount * 10 < prev;
  }

  private richStub(): UiaRichNode {
    return {
      id: "root",
      type: "Window",
      name: "SeedBank",
      automationId: "",
      enabled: true,
      offscreen: false,
      rect: null,
      patterns: [],
    };
  }

  private async richProjection(): Promise<UiaRichNode[]> {
    const base = await this.tree();
    return base.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.text,
      automationId: n.id,
      enabled: n.enabled,
      offscreen: false,
      rect: null,
      // Honest mock patterns mirroring what real UIA reports for these
      // control types: Buttons are invokable, Edits expose ValuePattern.
      patterns:
        n.type === "Button"
          ? ["InvokePatternIdentifiers.Pattern"]
          : n.type === "Edit"
            ? ["ValuePatternIdentifiers.Pattern"]
            : [],
    }));
  }

  /** Re-attach resets the per-session collapse baseline, like the real backend. */
  attach(_params: { pid?: number; titleContains?: string }): Promise<void> {
    this.lastGoodRichCount = null;
    return Promise.resolve();
  }

  detach(): Promise<void> {
    this.lastGoodRichCount = null;
    return Promise.resolve();
  }

  // ---- Window ops (mirror the real backend's semantics for conformance) ----

  async listWindows(): Promise<UiaWindowRef[]> {
    if (this.deviceCrashed) return [];
    return [{ pid: MOCK_SEED_PID, title: "SeedBank" }];
  }

  async waitForWindow(params: WaitForWindowParams): Promise<UiaWindowRef> {
    const requested = Math.min(Math.max(params.timeoutMs ?? 10000, 0), 60000);
    const deadline = Date.now() + requested;
    for (;;) {
      const windows = await this.listWindows();
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

  async windowStatus(): Promise<{ alive: boolean; pid: number }> {
    return { alive: !this.deviceCrashed, pid: MOCK_SEED_PID };
  }

  private assertAlive(): void {
    if (this.deviceCrashed) {
      throw new WindowsBackendError(
        "DEAD_WINDOW",
        "UIA client disconnected (injected fault)",
      );
    }
  }
}
