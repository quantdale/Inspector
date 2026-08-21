import {
  PROTOCOL_VERSION,
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
import { WebAdapterHandler, SEED_HTML } from "@inspector/adapter-web";

export const ELECTRON_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "electron-chromium",
  capabilities: {
    observe: ["uiTree", "screenshot", "console", "network", "storage", "trace"],
    act: ["click", "fill", "press", "select", "navigate", "back", "forward", "reload", "wait"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
  },
};

export interface ElectronFaults {
  crashApp?: boolean;
}

/**
 * Electron adapter (M6 subphase 2). Electron renders through Chromium, so the
 * adapter deliberately REUSES the web adapter's browser semantics for
 * sensing and acting and layers Electron-specific identity (app/package
 * naming, main-process log channel) on top. A production implementation binds
 * the renderer page to a real Electron `BrowserWindow`; the contract proven
 * here is identical.
 */
export class ElectronAdapterHandler implements AdapterHandler {
  private readonly web: WebAdapterHandler;
  private readonly mainLog: string[] = [];
  private seq = 0;

  constructor(
    faults: ElectronFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-electron-artifacts"),
    seedHtml: string = SEED_HTML,
  ) {
    mkdtempSync(artifactBaseDir);
    const artifacts = new ArtifactStore(artifactBaseDir);
    void artifacts;
    this.web = new WebAdapterHandler({}, join(tmpdir(), "inspector-electron-web"), seedHtml);
    if (faults.crashApp) this.mainLog.push("ELECTRON_CRASH injected");
  }

  async initialize(): Promise<CapabilityDoc> {
    return ELECTRON_CAPABILITIES;
  }

  async lifecycle(params: { op: string }): Promise<{ ok: boolean }> {
    return this.web.lifecycle(params);
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    const obs = await this.web.observe(params);
    return {
      ...obs,
      source: "adapter-electron",
      sequence: this.seq++,
      summary: {
        ...(obs.summary as Record<string, unknown>),
        url: String((obs.summary as { url?: string }).url ?? "").replace(/^http:/, "electron:"),
        mainLog: [...this.mainLog],
      },
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    if (this.mainLog.includes("ELECTRON_CRASH injected")) {
      throw new AdapterCrashError("adapter-crash: electron app quit (injected fault)");
    }
    return this.web.act(params);
  }

  async health(): Promise<HealthResponse> {
    return this.web.health();
  }

  async cancel(): Promise<void> {
    await this.web.cancel();
  }
}
