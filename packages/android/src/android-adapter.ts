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
import { ArtifactStore } from "@inspector/artifact-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import type { AdbBackend, AndroidFaults } from "./types.js";
import { parseUiautomatorDump } from "./uiautomator.js";
import { SEED_PACKAGE } from "./mock-backend.js";

export const ANDROID_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "android-uiautomator",
  capabilities: {
    observe: ["uiTree", "screenshot", "logcat"],
    act: ["click", "fill", "press", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash", "timeout"],
    coverage: [],
  },
};

/**
 * Android adapter (M5). Speaks the Inspector Adapter Protocol but drives an
 * ADB backend; all Android-specific behavior is contained in this package.
 */
export class AndroidAdapterHandler implements AdapterHandler {
  private serial: string | null = null;
  private readonly artifacts: ArtifactStore;
  private seq = 0;

  constructor(
    private readonly backend: AdbBackend,
    private readonly faults: AndroidFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-android-artifacts"),
  ) {
    mkdtempSync(artifactBaseDir);
    this.artifacts = new ArtifactStore(artifactBaseDir);
  }

  async initialize(): Promise<CapabilityDoc> {
    return ANDROID_CAPABILITIES;
  }

  async lifecycle(params: { op: string }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create": {
        const devices = await this.backend.devices();
        this.serial = devices[0] ?? null;
        if (!this.serial) throw protocolError("VALIDATION", "no device connected");
        await this.backend.install(this.serial, "/fixtures/seeddroid.apk");
        return { ok: true };
      }
      case "reset": {
        if (!this.serial) throw protocolError("VALIDATION", "environment not created");
        // Package data reset == back to the seeded login screen.
        await this.backend.uninstall(this.serial, SEED_PACKAGE);
        await this.backend.install(this.serial, "/fixtures/seeddroid.apk");
        return { ok: true };
      }
      case "close": {
        this.serial = null;
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    if (!this.serial) throw new Error("environment not created");
    const serial = this.serial;
    const want = new Set(params.observe ?? []);
    const dump = await this.backend.shell(serial, "uiautomator dump /dev/tty");
    const elements = parseUiautomatorDump(dump);
    const uiTree = elements.map((el) => ({
      tag: el.tag,
      role: el.role,
      name: el.name,
      id: el.id,
      hidden: el.hidden,
      disabled: el.disabled,
      value: el.value,
      text: el.text,
    }));

    const artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> = [];
    if (want.has("screenshot")) {
      const png = await this.backend.screencap(serial);
      const meta = this.artifacts.write({
        runId: "run",
        content: png,
        mime: "image/png",
        name: "screenshot.png",
      });
      artifacts.push({ sha256: meta.sha256, mime: meta.mime, size: meta.size, path: meta.path });
    }

    const logcat = want.has("logcat") ? await this.backend.logcat(serial) : [];

    return {
      id: newId("obs"),
      runId: "run",
      environmentId: "env",
      sequence: this.seq++,
      source: "adapter-android",
      capturedAt: new Date().toISOString(),
      summary: { url: `android://${serial}/${SEED_PACKAGE}`, title: SEED_PACKAGE, uiTree, logcat, storage: {} },
      artifacts,
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    if (this.faults.crashDevice) {
      this.faults.crashDevice = false;
      await this.simulateCrash();
    }
    if (!this.serial) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const sel = String(action.input?.selector ?? "");
    const value = action.input?.value === undefined ? "" : String(action.input.value);
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: new Date().toISOString(),
    };

    try {
      const before = await this.backend.appErrors(this.serial);

      switch (action.kind) {
        case "click": {
          const target = await this.resolveTarget(sel);
          await this.backend.shell(
            this.serial,
            `input tap ${target.center.x} ${target.center.y}`,
          );
          break;
        }
        case "fill": {
          const target = await this.resolveTarget(sel);
          await this.backend.shell(
            this.serial,
            `input tap ${target.center.x} ${target.center.y}`,
          );
          await this.backend.shell(this.serial, `input text ${value}`);
          break;
        }
        case "press":
          await this.backend.shell(this.serial, `input keyevent ${value || "4"}`);
          break;
        case "fault": {
          const fault = String(action.input?.fault ?? "");
          const allowed = ANDROID_CAPABILITIES.capabilities.faults ?? [];
          if (!allowed.includes(fault)) {
            throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
          }
          if (fault === "crash") {
            await this.simulateCrash();
          } else {
            throw protocolError("VALIDATION", `unsupported fault: ${fault}`);
          }
          break;
        }
        default:
          throw protocolError("VALIDATION", `unknown android action: ${action.kind}`);
      }

      // Genuine app crash (handler threw) vs automation miss classification.
      const after = await this.backend.appErrors(this.serial);
      const freshError = after.find((e) => !before.includes(e));
      if (freshError) {
        return {
          ...base,
          status: "target-failure",
          stateAfter: `android://${this.serial}`,
          error: { code: "TARGET_FAILURE", message: freshError },
        };
      }
      return {
        ...base,
        status: "success",
        stateAfter: `android://${this.serial}`,
      };
    } catch (e) {
      if (e instanceof AdapterCrashError) throw e;
      if (e && typeof e === "object" && "code" in e) throw e; // ProtocolError
      const message = e instanceof Error ? e.message : String(e);
      // Automation miss (missing element, no focused field): not a defect.
      return {
        ...base,
        status: "target-failure",
        stateAfter: this.serial ? `android://${this.serial}` : "",
        error: { code: "ACTION_FAILED", message },
      };
    }
  }

  async health(): Promise<HealthResponse> {
    return { ok: this.serial !== null, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* mock actions are instantaneous */
  }

  /** Resolve "#id" to tappable element center via a fresh UI dump. */
  private async resolveTarget(selector: string): Promise<{ center: { x: number; y: number } }> {
    if (!this.serial) throw protocolError("VALIDATION", "environment not created");
    const id = selector.replace(/^#/, "");
    const dump = await this.backend.shell(this.serial, "uiautomator dump /dev/tty");
    const el = parseUiautomatorDump(dump).find((e) => e.id === id && !e.hidden && !e.disabled);
    if (!el) throw new Error(`element not found or not visible: ${selector}`);
    return el;
  }

  private async simulateCrash(): Promise<never> {
    try {
      await this.backend.shell("emulator-5554-nonexistent", "echo x");
    } catch {
      /* fall through */
    }
    throw new AdapterCrashError("adapter-crash: device lost (injected fault)");
  }
}
