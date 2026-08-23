import {
  type CapabilityDoc,
  type Observation,
  type ActionOutcome,
  type Action,
  type HealthResponse,
  type InitializeRequest,
  type ObserveRequest,
  type HealthRequest,
  type LifecycleRequest,
} from "@inspector/protocol";
import { AdapterCrashError, type AdapterHandler } from "@inspector/adapter-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebAdapterHandler, SEED_HTML } from "@inspector/adapter-web";
import { ELECTRON_CAPABILITIES } from "./capabilities.js";
import {
  RealElectronHandler,
  resolveElectronBackendMode,
  type ElectronBackendMode,
} from "./real-electron.js";

export { ELECTRON_CAPABILITIES } from "./capabilities.js";
export {
  electronExecutablePath,
  resolveElectronBackendMode,
  type ElectronBackendMode,
} from "./real-electron.js";

export interface ElectronFaults {
  crashApp?: boolean;
}

/**
 * Electron adapter (M6 subphase 2). Electron renders through Chromium, so the
 * adapter deliberately REUSES the web adapter's browser semantics for
 * sensing and acting and layers Electron-specific identity (app/package
 * naming, main-process log channel) on top. A production implementation binds
 * the renderer page to a real Electron `BrowserWindow`; the contract proven
 * here is identical. The default `auto` mode selects the production handler
 * when the Electron executable is installed, and otherwise retains the
 * injectable browser implementation for environments that only run contract
 * tests. A caller can force either mode explicitly.
 */
export class ElectronAdapterHandler implements AdapterHandler {
  /** Kept for compatibility with injectable diagnostics and test fixtures. */
  private readonly web: WebAdapterHandler | undefined;
  private readonly delegate: AdapterHandler;
  readonly backendMode: Exclude<ElectronBackendMode, "auto">;
  private readonly mainLog: string[] = [];
  /** One-shot latch: the injected crash fault fires exactly once. */
  private crashPending = false;
  private seq = 0;

  constructor(
    faults: ElectronFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-electron-artifacts"),
    seedHtml: string = SEED_HTML,
    backend: ElectronBackendMode = "auto",
  ) {
    const hasInjectedOptions = faults.crashApp === true || seedHtml !== SEED_HTML;
    const selected: Exclude<ElectronBackendMode, "auto"> =
      backend === "auto" && hasInjectedOptions
        ? "injectable"
        : backend === "auto"
          ? resolveElectronBackendMode()
          : backend;
    if (selected === "real" && hasInjectedOptions) {
      throw new Error("real Electron backend cannot use injected faults or seed HTML");
    }
    this.backendMode = selected;
    if (selected === "real") {
      this.web = undefined;
      this.delegate = new RealElectronHandler(artifactBaseDir);
    } else {
      // The web handler derives its own unique per-instance artifact directory
      // under this base (mkdtemp), so concurrent injectable instances never
      // share one artifact tree.
      this.web = new WebAdapterHandler({}, artifactBaseDir, seedHtml);
      this.delegate = this.web;
    }
    if (faults.crashApp) {
      this.crashPending = true;
      this.mainLog.push("ELECTRON_CRASH injected");
    }
  }

  async initialize(params: InitializeRequest = {}): Promise<CapabilityDoc> {
    void params;
    // Preserve the adapter-family identity at the wrapper boundary even when
    // the injectable implementation delegates sensing to adapter-web.
    return ELECTRON_CAPABILITIES;
  }

  async lifecycle(params: LifecycleRequest): Promise<{ ok: boolean }> {
    return this.delegate.lifecycle(params);
  }

  async observe(params: ObserveRequest = { observe: [] }): Promise<Observation> {
    const obs = await this.delegate.observe(params);
    if (this.backendMode === "real") return obs;
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
    if (this.crashPending) {
      // One-shot: consume the fault so only the FIRST act crashes; later acts
      // reach the app again (observe was never blocked).
      this.crashPending = false;
      throw new AdapterCrashError("adapter-crash: electron app quit (injected fault)");
    }
    return this.delegate.act(params);
  }

  async health(params: HealthRequest = {}): Promise<HealthResponse> {
    return this.delegate.health(params);
  }

  async cancel(params: { actionId: string } = { actionId: "" }): Promise<void> {
    await this.delegate.cancel(params);
  }

  /** Release the underlying browser/context/seed server (signal shutdown). */
  async shutdown(): Promise<void> {
    const shutdown = (this.delegate as AdapterHandler & { shutdown?: () => Promise<void> }).shutdown;
    if (shutdown) await shutdown.call(this.delegate);
  }
}
