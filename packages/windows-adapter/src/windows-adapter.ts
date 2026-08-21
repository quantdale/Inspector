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
import { AdapterCrashError, type AdapterHandler } from "@inspector/adapter-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { ArtifactStore } from "@inspector/artifact-store";
import type { UiaBackend } from "./types.js";

export const WINDOWS_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "windows-uia",
  capabilities: {
    observe: ["uiTree"],
    act: ["click", "fill", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
  },
};

/**
 * Windows adapter (M6 subphase 3). Drives an injectable UI Automation
 * backend; all Windows-specific behavior is contained in this package.
 */
export class WindowsAdapterHandler implements AdapterHandler {
  private created = false;
  private readonly artifacts: ArtifactStore;
  private seq = 0;

  constructor(
    private readonly backend: UiaBackend,
    artifactBaseDir: string = join(tmpdir(), "inspector-windows-artifacts"),
  ) {
    mkdtempSync(artifactBaseDir);
    this.artifacts = new ArtifactStore(artifactBaseDir);
    void this.artifacts;
  }

  async initialize(): Promise<CapabilityDoc> {
    return WINDOWS_CAPABILITIES;
  }

  async lifecycle(params: { op: string }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create":
        this.created = true;
        return { ok: true };
      case "reset":
        await this.backend.reset();
        this.created = true;
        return { ok: true };
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
    const nodes = await this.backend.tree();
    const uiTree = nodes.map((n) => ({
      tag: "control",
      role: n.type === "Button" ? "button" : n.type === "Edit" ? "input" : "text",
      name: n.text || n.id,
      id: n.id,
      hidden: false,
      disabled: !n.enabled,
      value: n.type === "Edit" ? n.text : undefined,
      text: n.type === "Edit" ? undefined : n.text,
    }));
    return {
      id: newId("obs"),
      runId: "run",
      environmentId: "env",
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
      const freshError = after.find((e) => !before.includes(e));
      if (freshError) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "TARGET_FAILURE", message: freshError },
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
    return { ok: this.created, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* mock actions are instantaneous */
  }
}
