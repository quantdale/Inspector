import { describe, it, expect, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  RealAdbBackend,
  parseUiautomatorDump,
  quoteDeviceShellWord,
  probeAdbAvailable,
} from "./index.js";

/**
 * REAL ADB backend integration (gated).
 *
 * Runs only when a live Android device/emulator is reachable or one of the
 * known AVDs can boot headlessly. Otherwise the suite skips with an explicit
 * reason. Exercises a SYSTEM app (com.android.settings) end to end:
 * launch, uiautomator dump, semantic tap, text input, screenshot,
 * force-stop, pm clear, process-death observation.
 *
 * Safety rules:
 * - Never kill a device we did not boot.
 * - Every adb call is bounded; total suite bound 420s.
 * - No host mouse/keyboard input anywhere.
 */

const TOTAL_BUDGET_MS = 420_000;
const BOOT_TIMEOUT_MS = 180_000;
const TARGET_PKG = "com.android.settings";
const AVD_CANDIDATES = ["Nitro_API_36", "CRBABot_API_36"];

const adbAvailable = await probeAdbAvailable();
const backend = new RealAdbBackend();

interface DeviceCtx {
  serial: string;
  bootedByUs: boolean;
  emulatorProc?: ChildProcess;
}

let ctx: DeviceCtx | null = null;
let skipReason = "";

async function listRawSerials(): Promise<string[]> {
  try {
    return await backend.devices();
  } catch {
    return [];
  }
}

async function waitForBoot(serial: string): Promise<boolean> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const out = await backend.shell(serial, "getprop sys.boot_completed");
      if (out.trim() === "1") return true;
    } catch {
      /* device not up yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function resolveEmulatorBinary(): string | null {
  const sdk = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"] ?? "";
  const candidates = [
    sdk ? join(sdk, "emulator", "emulator.exe") : "",
    sdk ? join(sdk, "emulator", "emulator") : "",
    join(process.env["LOCALAPPDATA"] ?? "", "Android", "Sdk", "emulator", "emulator.exe"),
  ].filter((p) => p && p !== "undefined");
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function tryBootAvd(avd: string): Promise<DeviceCtx | null> {
  const emu = resolveEmulatorBinary();
  if (!emu) {
    console.warn(`[android-real] no emulator binary found (ANDROID_HOME=${process.env["ANDROID_HOME"] ?? "unset"})`);
    return null;
  }
  // Diff serials so we only ever claim an emulator WE started.
  const before = new Set(await listRawSerials());
  const proc = spawn(
    emu,
    ["-avd", avd, "-no-window", "-no-audio", "-gpu", "swiftshader_indirect", "-no-snapshot"],
    { stdio: "ignore", windowsHide: true },
  );
  // Cold boots take 60-120s; give the full boot budget for the new serial
  // to appear AND prove alive.
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return null; // emulator died immediately
    const serials = await listRawSerials().catch(() => [] as string[]);
    const fresh = serials.find((s) => s.startsWith("emulator-") && !before.has(s));
    if (fresh && (await waitForBoot(fresh))) {
      return { serial: fresh, bootedByUs: true, emulatorProc: proc };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  proc.kill();
  return null;
}

async function acquireDevice(): Promise<DeviceCtx | null> {
  // Prefer an already-live device we did not start.
  const existing = await listRawSerials();
  if (existing.length > 0) return { serial: existing[0]!, bootedByUs: false };
  for (const avd of AVD_CANDIDATES) {
    const booted = await tryBootAvd(avd);
    if (booted) return booted;
  }
  return null;
}

afterAll(async () => {
  if (!ctx?.bootedByUs) return;
  const serial = ctx.serial;
  // `adb emu kill` targets only our emulator's console port.
  await runAdbEmuKill(serial).catch(() => {});
  // Verify the process is gone.
  const proc = ctx.emulatorProc;
  if (proc) {
    const gone = await Promise.race([
      new Promise<boolean>((resolve) => {
        proc.once("exit", () => resolve(true));
        setTimeout(() => resolve(proc.exitCode !== null), 15_000);
      }),
    ]);
    if (!gone) proc.kill();
  }
});

/** Bounded `adb -s <serial> emu kill` against the emulator we booted. */
function runAdbEmuKill(serial: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("adb", ["-s", serial, "emu", "kill"], { stdio: "ignore", windowsHide: true });
    const t = setTimeout(() => { child.kill(); reject(new Error("emu kill timeout")); }, 10_000);
    child.on("close", () => { clearTimeout(t); resolve(); });
    child.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

describe.skipIf(!adbAvailable)("android real ADB backend", () => {
  it(
    "acquires a live device (pre-existing or freshly booted AVD)",
    async () => {
      ctx = await acquireDevice();
      if (!ctx) {
        skipReason =
          "no live emulator and neither Nitro_API_36 nor CRBABot_API_36 could boot headlessly";
        console.warn(`[android-real] SKIPPED: ${skipReason}`);
        return;
      }
      expect(ctx.serial).toMatch(/^(emulator-|.*device)/);
      // Liveness proven by bounded echo round-trip inside devices()/shell().
      const out = await backend.shell(ctx.serial, "echo ok");
      expect(out.trim()).toContain("ok");
    },
    TOTAL_BUDGET_MS,
  );

  it(
    "exercises com.android.settings end to end",
    async () => {
      if (!ctx) {
        console.warn(`[android-real] SKIPPED downstream ops: ${skipReason || "no device"}`);
        return;
      }
      const serial = ctx.serial;

      // Launch via monkey (works without knowing launcher activity names).
      await backend.shell(serial, `monkey -p ${TARGET_PKG} -c android.intent.category.LAUNCHER 1`);

      // Dump yields real elements with resource-ids/bounds.
      const xml = await backend.dumpUi(serial);
      expect(xml).toContain("</hierarchy>");
      const els = parseUiautomatorDump(xml);
      expect(els.length).toBeGreaterThan(0);
      const tappable = els.find((e) => !e.hidden && !e.disabled);
      expect(tappable).toBeDefined();

      // Tap a real element by bounds center.
      await backend.shell(serial, `input tap ${tappable!.center.x} ${tappable!.center.y}`);

      // Type into a real text field if one is reachable.
      const field = parseUiautomatorDump(await backend.dumpUi(serial)).find(
        (e) => e.role === "input" && !e.hidden && !e.disabled,
      );
      if (field) {
        await backend.shell(serial, `input text ${quoteDeviceShellWord("inspector")}`);
      }

      // Screenshot captured (valid PNG).
      const png = await backend.screencap(serial);
      expect(png.length).toBeGreaterThan(100);

      // Process-death observation around force-stop / pm clear, via the
      // normalized pidof contract (null = not running, no throw).
      const pidOf = async (): Promise<string> =>
        (await (backend.pidOf
          ? backend.pidOf(serial, TARGET_PKG)
          : backend.shell(serial, `pidof ${TARGET_PKG} || true`).then((s) => s.trim() || null)
        )) ?? "";
      // Give the launched activity a moment to materialize as a process.
      let pidBefore = "";
      for (let i = 0; i < 5 && !pidBefore; i++) {
        pidBefore = await pidOf();
        if (!pidBefore) await new Promise((r) => setTimeout(r, 2000));
      }
      await backend.shell(serial, `am force-stop ${TARGET_PKG}`);
      const pidAfterStop = await pidOf();
      expect(pidBefore).not.toBe("");
      expect(pidAfterStop).toBe("");

      const clearOut = await backend.shell(serial, `pm clear ${TARGET_PKG}`);
      expect(clearOut.toLowerCase()).toContain("success");

      // Bounded logcat capture works.
      const logs = await backend.logcat(serial, 50);
      expect(Array.isArray(logs)).toBe(true);

      // appErrors harvests FATAL EXCEPTION lines without hanging.
      const errs = await backend.appErrors(serial);
      expect(Array.isArray(errs)).toBe(true);
    },
    TOTAL_BUDGET_MS,
  );
});
