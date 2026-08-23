import {
  PROTOCOL_VERSION,
  newId,
  protocolError,
  type CapabilityDoc,
  type Observation,
  type ActionOutcome,
  type Action,
  type HealthResponse,
} from "@inspector/protocol";
import {
  AdapterCrashError,
  type AdapterHandler,
  isSensitiveKey,
  REDACTED,
} from "@inspector/adapter-sdk";
import { ArtifactStore } from "@inspector/artifact-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import type { UiaBackend, UiaBackendWindowOps } from "./types.js";

/**
 * Controls whose invocation is EVIDENCED (spec009 transition-forensics,
 * GA keepontop-debug) to move this build's app content into a surface that
 * desktop-root UIA cannot enumerate under any pid. The adapter annotates
 * them; the explorer declines them autonomously.
 */
export const SURFACE_DETACHING_CONTROLS = /keep on top/i;

export const WINDOWS_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "windows-uia",
  capabilities: {
    observe: ["uiTree"],
    act: ["click", "fill", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
    // SPEC-009 W1: semantic vocabulary. click maps to UIA InvokePattern,
    // fill maps to ValuePattern SetValue; targets are addressed by UIA
    // runtime id (mock backends use their stable control ids).
    vocabulary: [
      {
        kind: "click",
        targetScheme: "uia-runtime-id",
        risk: "interact",
        autonomousEligible: true,
        description: "InvokePattern.Invoke on an invokable control",
      },
      {
        kind: "fill",
        targetScheme: "uia-runtime-id",
        risk: "interact",
        autonomousEligible: true,
        description: "ValuePattern.SetValue on an edit control",
      },
    ],
  },
};

/**
 * First entry of `after` whose occurrence count exceeds its count in `before`
 * (count-based multiset diff). A pure set diff would classify a REPEATED
 * identical crash as success, which corrupts reproduction/minimization.
 */
function freshError(before: string[], after: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const e of before) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const e of after) {
    const remaining = counts.get(e) ?? 0;
    if (remaining === 0) return e;
    counts.set(e, remaining - 1);
  }
  return undefined;
}

/**
 * Windows adapter (M6 subphase 3). Drives an injectable UI Automation
 * backend; all Windows-specific behavior is contained in this package.
 */
export class WindowsAdapterHandler implements AdapterHandler {
  private created = false;
  private readonly artifacts: ArtifactStore;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  private readonly artifactDir: string;
  private runId = "run";
  private environmentId = "env";
  private seq = 0;

  constructor(
    private readonly backend: UiaBackend,
    artifactBaseDir: string = join(tmpdir(), "inspector-windows-artifacts"),
  ) {
    mkdirSync(artifactBaseDir, { recursive: true });
    // Use the RETURNED unique directory so concurrent instances never share
    // one artifact tree.
    this.artifactDir = mkdtempSync(join(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
    void this.artifacts;
  }

  async initialize(): Promise<CapabilityDoc> {
    return WINDOWS_CAPABILITIES;
  }

  async lifecycle(params: {
    op: string;
    options?: Record<string, unknown>;
  }): Promise<{ ok: boolean; window?: { pid: number; title: string } }> {
    switch (params.op) {
      case "create": {
        // Optional targeted attach: when the operator names a window (title
        // substring or pid) and the backend supports window ops, attach to
        // THAT window so exploration cannot drift onto an unrelated one.
        const createOpts = params.options ?? {};
        const winOps = this.backend as Partial<UiaBackendWindowOps>;
        const titleContains =
          typeof createOpts.titleContains === "string"
            ? createOpts.titleContains
            : undefined;
        const pid = typeof createOpts.pid === "number" ? createOpts.pid : undefined;
        if ((titleContains !== undefined || pid !== undefined) && typeof winOps.waitForWindow === "function") {
          const win = await winOps.waitForWindow({
            pid,
            titleContains,
            timeoutMs:
              typeof createOpts.timeoutMs === "number"
                ? createOpts.timeoutMs
                : undefined,
          });
          if (typeof (this.backend as { attach?: unknown }).attach === "function") {
            await (this.backend as unknown as { attach(p: { pid?: number }): Promise<void> }).attach({ pid: win.pid });
          }
        }
        // Probe the backend so create fails for a dead UIA client instead of
        // reporting a successfully created environment that cannot be sensed.
        await this.backend.tree();
        this.created = true;
        this.applyAttribution(params.options);
        return { ok: true };
      }
      case "reset":
        await this.backend.reset();
        this.created = true;
        return { ok: true };
      case "waitForWindow": {
        const winOps = this.backend as Partial<UiaBackendWindowOps>;
        if (typeof winOps.waitForWindow !== "function") {
          throw protocolError("CAPABILITY_DENIED", "backend does not support waitForWindow");
        }
        const opts = params.options ?? {};
        const pid = typeof opts.pid === "number" ? opts.pid : undefined;
        const titleContains = typeof opts.titleContains === "string" ? opts.titleContains : undefined;
        if (pid === undefined && !titleContains) {
          throw protocolError("VALIDATION", "waitForWindow requires pid or titleContains");
        }
        const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : undefined;
        const window = await winOps.waitForWindow({ pid, titleContains, timeoutMs });
        return { ok: true, window };
      }
      case "close":
        this.created = false;
        return { ok: true };
      default:
        return { ok: false };
    }
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    if (!this.created) throw new Error("environment not created");
    void params;
    // Rich path: when the backend exposes pattern-level detail (real UIA),
    // project it so the explorer can distinguish invokable/toggleable/editable
    // controls instead of guessing from control type alone.
    const rich = this.backend as Partial<{ richTree(): Promise<{ pid?: number; nodes: Array<import("./types.js").UiaNode & { patterns?: string[]; automationId?: string; name?: string }> }> }>;
    if (typeof rich.richTree === "function") {
      const tree = await rich.richTree();
      const uiTree = tree.nodes.map((n) => {
        const label = n.name ?? n.text ?? "";
        return {
          tag: "control",
          role:
            n.type === "Button" ? "button" : n.type === "Edit" ? "input" : "text",
          name: label || n.id,
          id: n.id,
          hidden: false,
          disabled: !n.enabled,
          value:
            n.type === "Edit"
              ? (isSensitiveKey(n.automationId || n.id) ? REDACTED : label)
              : undefined,
          text: n.type === "Edit" ? undefined : label,
          automationId: n.automationId || undefined,
          controlType: n.type,
          // Empirically evidenced (GA forensics + spec009 transition
          // forensics): invoking these controls moves the live content into a
          // surface that desktop-root UIA cannot enumerate under ANY pid on
          // this Win11 build, ending exploration. Annotated so the explorer
          // can decline them autonomously.
          ...(SURFACE_DETACHING_CONTROLS.test(label)
            ? { surfaceDetaching: true }
            : {}),
          ...(Array.isArray(n.patterns) && n.patterns.length > 0
            ? { patterns: n.patterns }
            : {}),
        };
      });
      return {
        id: newId("obs"),
        runId: this.runId,
        environmentId: this.environmentId,
        sequence: this.seq++,
        source: "adapter-windows-uia",
        capturedAt: new Date().toISOString(),
        summary: {
          url: `windows://pid/${tree.pid ?? "unknown"}`,
          title: tree.nodes[0]?.text ?? "",
          uiTree,
          storage: {},
        },
      };
    }
    const nodes = await this.backend.tree();
    const uiTree = nodes.map((n) => ({
      tag: "control",
      role: n.type === "Button" ? "button" : n.type === "Edit" ? "input" : "text",
      name: n.text || n.id,
      id: n.id,
      // KNOWN DEBT: the mock UIA model carries no geometry, so visibility
      // cannot be derived here; every mapped control is reported visible.
      hidden: false,
      disabled: !n.enabled,
      // Password-style controls (identified by automation id) are masked
      // before their value can reach observations or model context.
      value:
        n.type === "Edit" ? (isSensitiveKey(n.id) ? REDACTED : n.text) : undefined,
      text: n.type === "Edit" ? undefined : n.text,
    }));
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-windows-uia",
      capturedAt: new Date().toISOString(),
      summary: { url: "windows://seedbank-dialog", title: "SeedBank", uiTree, storage: {} },
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    if (!this.created) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: new Date().toISOString(),
      stateAfter: "windows://seedbank-dialog",
    };

    try {
      if (action.kind === "fault") {
        const fault = String(action.input?.fault ?? "");
        const allowed = WINDOWS_CAPABILITIES.capabilities.faults ?? [];
        if (!allowed.includes(fault)) {
          throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
        }
        throw new AdapterCrashError("adapter-crash: UIA client lost (injected fault)");
      }

      const before = await this.backend.errors();
      const sel = String(action.input?.selector ?? "").replace(/^#/, "");
      const value = action.input?.value === undefined ? "" : String(action.input.value);

      switch (action.kind) {
        case "click":
          await this.backend.invoke(sel);
          break;
        case "fill":
          await this.backend.setValue(sel, value);
          break;
        default:
          throw protocolError("VALIDATION", `unknown windows action: ${action.kind}`);
      }

      const after = await this.backend.errors();
      // Count-based freshness: a repeated identical error is still fresh.
      const fresh = freshError(before, after);
      if (fresh) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "TARGET_FAILURE", message: fresh },
        };
      }
      return { ...base, status: "success" };
    } catch (e) {
      if (e instanceof AdapterCrashError) throw e;
      if (e && typeof e === "object" && "code" in e) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        ...base,
        status: "target-failure",
        error: { code: "ACTION_FAILED", message },
      };
    }
  }

  async health(): Promise<HealthResponse> {
    let ok = this.created;
    if (ok) {
      // Health must reflect reality: a backend that died after create makes
      // the environment unusable even though `created` is still true.
      try {
        await this.backend.tree();
      } catch {
        ok = false;
      }
    }
    return { ok, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* mock actions are instantaneous */
  }

  /** Thread real run/environment attribution from lifecycle options. */
  private applyAttribution(options?: Record<string, unknown>): void {
    const runId = options?.runId;
    const environmentId = options?.environmentId;
    if (typeof runId === "string" && runId) this.runId = runId;
    if (typeof environmentId === "string" && environmentId) {
      this.environmentId = environmentId;
    }
  }
}
