import type { Action, ActionOutcome, ReplayResult, OracleSignal } from "@inspector/finding";
import { RealUiaBackend } from "./real-uia.js";
import { PowerShellUiaBridge } from "./uia-bridge.js";
import type { UiaRichNode } from "./real-uia.js";

/**
 * SPEC-009 W6/W8: platform-faithful Windows/UIA replay.
 *
 * Replay identity strategy (empirically informed by GA field evidence:
 * Win11 packaged apps rehost HWNDs and migrate owners mid-session, so
 * RuntimeIds are NOT stable across restarts):
 *
 *   1. fast path: the captured RuntimeId selector, when still present in
 *      the fresh tree of the SAME session;
 *   2. AutomationId match (stable for XAML/WinUI controls);
 *   3. controlType + exact accessible name;
 *   4. otherwise: unresolved locator -> AUTOMATION failure (honest), never a
 *      product defect signal.
 *
 * Coordinates are never persisted; they are derived from the resolved live
 * element at action time via pattern invocation (no global injection).
 */
export interface WindowsUiaReplayOptions {
  /** Title substring identifying the target window (same as discovery). */
  targetTitle?: string;
  /** Pid binding when discovery used one. */
  pid?: number;
  /** Injected backend for deterministic tests; default: real PowerShell bridge. */
  backend?: {
    listWindows(): Promise<Array<{ pid: number; title: string }>>;
    attach(params: { pid?: number; titleContains?: string }): Promise<void>;
    richTree(): Promise<{ pid?: number; nodes: UiaRichNode[] }>;
    invoke(rid: string): Promise<void>;
    setValue(rid: string, value: string): Promise<void>;
    closeWindow(): Promise<void>;
  };
  waitForWindowTimeoutMs?: number;
}

interface Descriptor {
  ridSelector?: string;
  automationId?: string;
  controlName?: string;
  controlType?: string;
}

function descriptorOf(action: Action): Descriptor {
  const input = action.input ?? {};
  return {
    ridSelector: typeof input.selector === "string" ? input.selector : undefined,
    automationId: typeof input.automationId === "string" ? input.automationId : undefined,
    controlName: typeof input.controlName === "string" ? input.controlName : undefined,
    controlType: typeof input.controlType === "string" ? input.controlType : undefined,
  };
}

/** Resolve against the FRESH tree: rid fast path, then semantics. */
export function resolveRid(
  nodes: UiaRichNode[],
  d: Descriptor,
): string | null {
  if (d.ridSelector) {
    const rid = d.ridSelector.replace(/^#/, "");
    if (nodes.some((n) => n.id === rid)) return rid;
  }
  if (d.automationId) {
    const hit = nodes.find((n) => n.automationId === d.automationId && n.enabled && !n.offscreen);
    if (hit) return hit.id;
  }
  if (d.controlName && d.controlType) {
    const hit = nodes.find(
      (n) => n.type === d.controlType && (n.name ?? "") === d.controlName && n.enabled && !n.offscreen,
    );
    if (hit) return hit.id;
  }
  return null;
}

/** Automation failure (unresolvable locator) - distinct from target defects. */
export class WindowsReplayUnresolvableError extends Error {
  constructor(detail: string) {
    super(`UNRESOLVED_REPLAY_LOCATOR: ${detail}`);
    this.name = "WindowsReplayUnresolvableError";
  }
}

export class WindowsUiaReplayDriver {
  private readonly backend: NonNullable<WindowsUiaReplayOptions["backend"]>;
  private attached = false;

  constructor(private readonly opts: WindowsUiaReplayOptions = {}) {
    this.backend =
      opts.backend ??
      (() => {
        const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
        return new RealUiaBackend(bridge);
      })();
  }

  private async ensureAttached(): Promise<void> {
    if (this.attached) return;
    const wins = await this.backend.listWindows();
    const hit =
      (this.opts.pid !== undefined
        ? wins.find((w) => w.pid === this.opts.pid)
        : undefined) ??
      (this.opts.targetTitle !== undefined
        ? wins.find((w) => w.title.includes(this.opts.targetTitle!))
        : undefined) ??
      wins[0];
    if (!hit) {
      throw new WindowsReplayUnresolvableError("target window not present");
    }
    await this.backend.attach({ pid: hit.pid });
    this.attached = true;
  }

  async replay(actions: Action[]): Promise<ReplayResult> {
    await this.ensureAttached();
    const outcomes: ActionOutcome[] = [];
    const signals: OracleSignal[] = [];
    try {
      for (const a of actions) {
        const tree = await this.backend.richTree();
        const rid = resolveRid(tree.nodes, descriptorOf(a));
        if (rid === null) {
          // Automation failure: repo convention is target-failure status with
          // ACTION_FAILED code - the session pipeline only promotes
          // code==="TARGET_FAILURE" outcomes, so this can never become a
          // product defect.
          outcomes.push({
            actionId: a.id,
            runId: a.runId,
            environmentId: a.environmentId,
            status: "target-failure",
            observedAt: new Date().toISOString(),
            error: {
              code: "ACTION_FAILED",
              message: `replay could not resolve target (${JSON.stringify(descriptorOf(a))}) in fresh tree`,
            },
          });
          continue;
        }
        try {
          if (a.kind === "click") await this.backend.invoke(rid);
          else if (a.kind === "fill") await this.backend.setValue(rid, String(a.input?.value ?? ""));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          outcomes.push({
            actionId: a.id,
            runId: a.runId,
            environmentId: a.environmentId,
            status: "target-failure",
            observedAt: new Date().toISOString(),
            error: { code: "TARGET_FAILURE", message: msg },
          });
          signals.push({ kind: "PAGE_ERROR", detail: msg });
          continue;
        }
        outcomes.push({
          actionId: a.id,
          runId: a.runId,
          environmentId: a.environmentId,
          status: "success",
          observedAt: new Date().toISOString(),
        });
      }
    } finally {
      // Leave the environment clean; close is best-effort (packaged apps may
      // already be gone).
      await this.backend.closeWindow().catch(() => {});
    }
    return { outcomes, signals, observations: [] };
  }
}
