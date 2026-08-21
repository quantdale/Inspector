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
import { AdapterCrashError, type AdapterHandler, stripUrlCredentialsInText } from "@inspector/adapter-sdk";
import { ArtifactStore } from "@inspector/artifact-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
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
    faults: ["crash"],
    coverage: [],
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
 * Quote a value as a single word under device-shell (POSIX) single-quote
 * rules so hostile fill values cannot inject shell structure into
 * `input text` once a real AdbBackend wraps `adb shell`.
 */
function quoteDeviceShellWord(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Android adapter (M5). Speaks the Inspector Adapter Protocol but drives an
 * ADB backend; all Android-specific behavior is contained in this package.
 */
export class AndroidAdapterHandler implements AdapterHandler {
  private serial: string | null = null;
  private readonly artifacts: ArtifactStore;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  private readonly artifactDir: string;
  private runId = "run";
  private environmentId = "env";
  private seq = 0;

  constructor(
    private readonly backend: AdbBackend,
    private readonly faults: AndroidFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-android-artifacts"),
  ) {
    mkdirSync(artifactBaseDir, { recursive: true });
    // Use the RETURNED unique directory so concurrent instances never share
    // one artifact tree.
    this.artifactDir = mkdtempSync(join(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
  }

  async initialize(): Promise<CapabilityDoc> {
    return ANDROID_CAPABILITIES;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create": {
        this.applyAttribution(params.options);
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

    // A failed or partial uiautomator dump must never ship as a valid empty
    // tree: mark the observation with a structured error instead.
    let uiTree: Array<Record<string, unknown>> = [];
    let observeError: { source: string; message: string } | undefined;
    try {
      const dump = await this.backend.shell(serial, "uiautomator dump /dev/tty");
      if (!dump.trim()) {
        throw new Error("uiautomator dump failed: empty output");
      }
      if (!dump.includes("</hierarchy>")) {
        throw new Error("uiautomator dump failed: truncated output");
      }
      uiTree = parseUiautomatorDump(dump).map((el) => ({
        tag: el.tag,
        role: el.role,
        name: el.name,
        id: el.id,
        hidden: el.hidden,
        disabled: el.disabled,
        value: el.value,
        text: el.text,
      }));
    } catch (e) {
      observeError = {
        source: "uiautomator-dump",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    const artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> = [];
    if (want.has("screenshot")) {
      const png = await this.backend.screencap(serial);
      const meta = this.artifacts.write({
        runId: this.runId,
        content: png,
        mime: "image/png",
        name: "screenshot.png",
      });
      artifacts.push({ sha256: meta.sha256, mime: meta.mime, size: meta.size, path: meta.path });
    }

    // Freeform logcat text is left intact except for URL credential stripping
    // (known debt: value-level secret redaction in freeform logs).
    const logcat = want.has("logcat")
      ? (await this.backend.logcat(serial)).map(stripUrlCredentialsInText)
      : [];

    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-android",
      capturedAt: new Date().toISOString(),
      summary: {
        url: `android://${serial}/${SEED_PACKAGE}`,
        title: SEED_PACKAGE,
        uiTree,
        logcat,
        storage: {},
        ...(observeError ? { observeError } : {}),
      },
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
          // The value travels as one quoted device-shell word; raw
          // interpolation would allow structural injection (`a; reboot`).
          await this.backend.shell(this.serial, `input text ${quoteDeviceShellWord(value)}`);
          break;
        }
        case "press": {
          const code = Number(value === "" ? "4" : value);
          if (!Number.isInteger(code) || code < 0 || code > 1000) {
            throw protocolError("VALIDATION", `invalid keyevent code: ${value}`);
          }
          await this.backend.shell(this.serial, `input keyevent ${code}`);
          break;
        }
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
      // Count-based freshness: a repeated identical error is still fresh.
      const after = await this.backend.appErrors(this.serial);
      const fresh = freshError(before, after);
      if (fresh) {
        return {
          ...base,
          status: "target-failure",
          stateAfter: `android://${this.serial}`,
          error: { code: "TARGET_FAILURE", message: fresh },
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

  /** Thread real run/environment attribution from lifecycle options. */
  private applyAttribution(options?: Record<string, unknown>): void {
    const runId = options?.runId;
    const environmentId = options?.environmentId;
    if (typeof runId === "string" && runId) this.runId = runId;
    if (typeof environmentId === "string" && environmentId) {
      this.environmentId = environmentId;
    }
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
