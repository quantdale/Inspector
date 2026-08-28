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
import { AdapterCrashError, type AdapterHandler, redactFreeformText } from "@inspector/adapter-sdk";
import { ArtifactStore } from "@inspector/artifact-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import type { AdbBackend, AndroidFaults } from "./types.js";
import { parseUiautomatorDump, resolveElement } from "./uiautomator.js";
import { SEED_PACKAGE } from "./mock-backend.js";

/**
 * Lifecycle options for create/reset. Seeding is OPTIONAL: targets that need
 * an APK install pass `seedApk`; targets driving already-present apps (system
 * apps, pre-installed builds) pass `launchPackage`/`launchActivity`. With no
 * options, create only ensures a device is alive and reset is a no-op.
 */
export interface AndroidLifecycleOptions {
  /** Host path to an APK to install (the legacy seeded-conformance path). */
  seedApk?: string;
  /** Package to launch (and to force-stop/clear on reset). */
  launchPackage?: string;
  /** Optional activity component for `am start -n pkg/activity`. */
  launchActivity?: string;
}

export const ANDROID_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "android-uiautomator",
  capabilities: {
    observe: ["uiTree", "screenshot", "logcat"],
    act: ["click", "fill", "press", "swipe", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
    // SPEC-009 W1/W7: semantic vocabulary. Targets are addressed via the
    // selector schemes in uiautomator.resolveElement (resource-id, content-
    // desc, text+class, structural path); coordinates are derived at action
    // time from a FRESH dump and never persisted. BACK is a plain keyevent;
    // scrolling is bounded to scrollable containers; lifecycle restart/kill
    // stays OUT of the autonomous vocabulary.
    vocabulary: [
      {
        kind: "click",
        targetScheme: "android-resource-id",
        risk: "interact",
        autonomousEligible: true,
        description: "Tap the resolved center of a visible element",
      },
      {
        kind: "fill",
        targetScheme: "android-resource-id",
        risk: "interact",
        autonomousEligible: true,
        description: "Tap an edit field then type a value",
      },
      {
        kind: "press",
        targetScheme: "android-resource-id",
        risk: "interact",
        autonomousEligible: true,
        description: "Keyevent; BACK (4) is the explorer-sanctioned value",
      },
      {
        kind: "swipe",
        risk: "interact",
        autonomousEligible: true,
        description:
          "Bounded scroll inside a scrollable container (value: down|up)",
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
  /** Package reported in observations (launchPackage, else the seed package). */
  private currentPackage = SEED_PACKAGE;
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
    this.artifacts = new ArtifactStore(artifactBaseDir);
  }

  async initialize(): Promise<CapabilityDoc> {
    return ANDROID_CAPABILITIES;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create": {
        const opts = this.lifecycleOptions(params.options);
        this.applyAttribution(params.options);
        const devices = await this.backend.devices();
        this.serial = devices[0] ?? null;
        if (!this.serial) throw protocolError("VALIDATION", "no device connected");
        if (opts.seedApk !== undefined) {
          // Legacy seeded-conformance path: install the APK (byte-compatible
          // with the pre-option behavior).
          await this.backend.install(this.serial, opts.seedApk);
          this.currentPackage = SEED_PACKAGE;
        } else {
          this.currentPackage = opts.launchPackage ?? SEED_PACKAGE;
        }
        if (opts.launchPackage !== undefined) {
          await this.launchApp(this.serial, opts);
        }
        return { ok: true };
      }
      case "reset": {
        if (!this.serial) throw protocolError("VALIDATION", "environment not created");
        const opts = this.lifecycleOptions(params.options);
        if (opts.seedApk !== undefined) {
          // Package data reset == back to the seeded login screen.
          await this.backend.uninstall(this.serial, SEED_PACKAGE);
          await this.backend.install(this.serial, opts.seedApk);
          this.currentPackage = SEED_PACKAGE;
          return { ok: true };
        }
        if (opts.launchPackage !== undefined) {
          const pkg = opts.launchPackage;
          await this.backend.shell(this.serial, `am force-stop ${pkg}`);
          await this.backend.shell(this.serial, `pm clear ${pkg}`);
          await this.launchApp(this.serial, opts);
          this.currentPackage = pkg;
        }
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
        const dump = await this.dumpXml(serial);
        if (!dump.trim()) {
          throw new Error("uiautomator dump failed: empty output");
        }
        if (!dump.includes("</hierarchy>")) {
          throw new Error("uiautomator dump failed: truncated output");
        }
        // Full hierarchy projection (SPEC-009 W7): every node keeps its
        // structural path, clickability, scrollability, and descriptor so
        // exploration can target id-less containers and scroll areas.
        uiTree = parseUiautomatorDump(dump).map((el) => ({
          tag: el.className,
          role: el.role,
          name: el.name,
          id: el.id,
          hidden: el.hidden,
          disabled: el.disabled,
          value: el.value,
          text: el.text,
          desc: el.desc,
          path: el.path,
          resourceId: el.resourceId,
          clickable: el.clickable || undefined,
          scrollable: el.scrollable || undefined,
          center: el.center,
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

    // Redact freeform logcat before it enters durable observations.
    const logcat = want.has("logcat")
      ? (await this.backend.logcat(serial)).map(redactFreeformText)
      : [];

    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-android",
      capturedAt: new Date().toISOString(),
      summary: {
        url: `android://${serial}/${this.currentPackage}`,
        title: this.currentPackage,
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
        case "swipe": {
          // SPEC-009 W7: bounded semantic scrolling. Direction comes from the
          // constrained vocabulary (down/up), geometry from a scrollable
          // container in the FRESH dump (fallback: conservative screen band).
          // Coordinates are derived at action time only - never persisted.
          const dump = await this.dumpXml(this.serial);
          const elements = parseUiautomatorDump(dump);
          const scroller = elements.find((e) => e.scrollable && !e.hidden);
          const x = scroller
            ? Math.round((scroller.center.x * 2) / 2)
            : 540;
          if (value === "up") {
            const top = scroller ? Math.max(scroller.center.y - 400, 100) : 400;
            await this.backend.shell(
              this.serial,
              `input swipe ${x} ${top} ${x} ${top + 900} 250`,
            );
          } else {
            const bottomY = scroller ? Math.min(scroller.center.y + 400, 1500) : 1500;
            await this.backend.shell(
              this.serial,
              `input swipe ${x} ${bottomY} ${x} ${Math.max(bottomY - 1100, 200)} 250`,
            );
          }
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

  /** Extract typed lifecycle options, ignoring non-string values. */
  private lifecycleOptions(options?: Record<string, unknown>): AndroidLifecycleOptions {
    const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
    return {
      seedApk: str(options?.seedApk),
      launchPackage: str(options?.launchPackage),
      launchActivity: str(options?.launchActivity),
    };
  }

  /** Launch (or relaunch) an app by package, preferring the named activity. */
  private async launchApp(serial: string, opts: AndroidLifecycleOptions): Promise<void> {
    if (opts.launchPackage === undefined) return;
    const cmd = opts.launchActivity
      ? `am start -n ${opts.launchPackage}/${opts.launchActivity}`
      : `monkey -p ${opts.launchPackage} -c android.intent.category.LAUNCHER 1`;
    await this.backend.shell(serial, cmd);
  }

  /** Resolve a semantic selector to a tappable element via a fresh dump.
   * Schemes (see uiautomator.resolveElement): resource-id, content-desc,
   * text+class, structural path - coordinates are derived at action time. */
  private async resolveTarget(selector: string): Promise<{
    center: { x: number; y: number };
  }> {
    if (!this.serial) throw protocolError("VALIDATION", "environment not created");
    const dump = await this.dumpXml(this.serial);
    const el = resolveElement(parseUiautomatorDump(dump), selector);
    if (!el || el.hidden || el.disabled) {
      throw new Error(`element not found or not visible: ${selector}`);
    }
    return el;
  }

  /**
   * UI hierarchy XML: prefer the backend's dedicated dump channel (real
   * backends dump to /sdcard/window_dump.xml and pull it); fall back to the
   * legacy `uiautomator dump /dev/tty` shell form for minimal stubs.
   *
   * M19 platform fidelity: transient dump failures (notably exit 137 from
   * uiautomator contention) are retried with bounded backoff (cap 3,
   * deadline) and classified distinctly from permanent failures. The real
   * backend already retries inside dumpUi, but the adapter's shell fallback
   * and mock paths must also honor the contract so fault-injected tests
   * recover on retry while permanent failures still fail closed.
   */
  private async dumpXml(serial: string): Promise<string> {
    const cap = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= cap; attempt++) {
      try {
        if (this.backend.dumpUi) return await this.backend.dumpUi(serial);
        return await this.backend.shell(serial, "uiautomator dump /dev/tty");
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        const isTransient = /137|transient|EBUSY|dump.*failed/i.test(msg);
        if (!isTransient || attempt === cap) throw e;
        // bounded backoff: small deterministic pause, never infinite
        const delayMs = 10 * attempt;
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
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
