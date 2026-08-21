import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdbError } from "./adb-errors.js";
import { MockAdbBackend } from "./mock-backend.js";
import type { AdbBackend } from "./types.js";

/**
 * Production ADB backend. Wraps the real `adb` CLI with the same contract as
 * MockAdbBackend. Design points:
 *
 * - Every adb invocation is a bounded subprocess spawn; nothing can hang
 *   forever (the stale `emulator-5554` trap where `adb devices` reports
 *   `device` but `adb shell` blocks indefinitely).
 * - devices() applies a LIVENESS filter: a serial listed as `device` is only
 *   returned after a bounded `shell echo ok` round-trip succeeds.
 * - Subprocess cleanup is guaranteed via timer-driven kill on every spawn.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 5_000;
const ADB_PROBE_TIMEOUT_MS = 5_000;

interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

/** Spawn the adb binary with args and a hard deadline; kill on expiry. */
function runAdb(adbPath: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      // Windows kill() may leave the process briefly; do not wait on it.
      reject(
        new AdbError("ADB_TIMEOUT", `adb ${args[0]} timed out after ${timeoutMs}ms`, {
          command: args.join(" "),
          timeoutMs,
        }),
      );
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new AdbError("ADB_NOT_FOUND", `adb binary not found at '${adbPath}'`)
          : new AdbError("ADB_COMMAND_FAILED", `failed to spawn adb: ${err.message}`),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

async function runAdbOrThrow(
  adbPath: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const r = await runAdb(adbPath, args, timeoutMs);
  if (r.code !== 0) {
    throw new AdbError("ADB_COMMAND_FAILED", `adb ${args.join(" ")} exited ${r.code}: ${r.stderr.trim() || r.stdout.toString("utf8").trim()}`, {
      command: args.join(" "),
      stderr: r.stderr.trim(),
    });
  }
  return r.stdout.toString("utf8");
}

/** True when `adb version` succeeds within the probe window. */
export async function probeAdbAvailable(
  adbPath = "adb",
  timeoutMs = ADB_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await runAdbOrThrow(adbPath, ["version"], timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Quote a value as one POSIX device-shell word (mirrors H-61 rigor). */
export function quoteDeviceShellWord(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export class RealAdbBackend implements AdbBackend {
  constructor(
    private readonly adbPath: string = "adb",
    private readonly defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Device serials that are listed AND proven alive. Presence lies: a dead
   * emulator can sit in `adb devices` as `device` while every shell call
   * hangs, so each candidate must survive a bounded echo round-trip.
   */
  async devices(): Promise<string[]> {
    const out = await runAdbOrThrow(this.adbPath, ["devices"], this.defaultTimeoutMs);
    const candidates = out
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.split(/\s+/))
      .filter(([serial, state]) => serial && state === "device")
      .map(([serial]) => serial ?? "")
      .filter((s) => s.length > 0);

    const alive = await Promise.all(
      candidates.map(async (serial) => {
        try {
          await this.assertAlive(serial);
          return serial;
        } catch {
          return null;
        }
      }),
    );
    return alive.filter((s): s is string => s !== null);
  }

  async shell(serial: string, cmd: string): Promise<string> {
    await this.assertAlive(serial);
    return runAdbOrThrow(this.adbPath, ["-s", serial, "shell", cmd], this.defaultTimeoutMs);
  }

  async screencap(serial: string): Promise<Buffer> {
    await this.assertAlive(serial);
    // exec-out streams raw PNG bytes without CRLF mangling.
    const r = await runAdb(this.adbPath, ["-s", serial, "exec-out", "screencap -p"], this.defaultTimeoutMs);
    if (r.code !== 0) {
      throw new AdbError("ADB_COMMAND_FAILED", `screencap failed: ${r.stderr.trim()}`, { serial });
    }
    const buf = r.stdout;
    if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new AdbError("ADB_COMMAND_FAILED", "screencap produced non-PNG output", { serial });
    }
    return buf;
  }

  async logcat(serial: string, lines = 200): Promise<string[]> {
    await this.assertAlive(serial);
    const out = await runAdbOrThrow(
      this.adbPath,
      ["-s", serial, "logcat", "-d", "-t", String(lines)],
      this.defaultTimeoutMs,
    );
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  }

  async install(serial: string, apkPath: string): Promise<void> {
    await this.assertAlive(serial);
    const out = await runAdbOrThrow(this.adbPath, ["-s", serial, "install", "-r", apkPath], 120_000);
    if (!out.includes("Success")) {
      throw new AdbError("ADB_COMMAND_FAILED", `install failed: ${out.trim()}`, { serial });
    }
  }

  async uninstall(serial: string, pkg: string): Promise<void> {
    await this.assertAlive(serial);
    // SUCCESS / Success / "not installed" are all acceptable reset outcomes.
    await runAdbOrThrow(this.adbPath, ["-s", serial, "uninstall", pkg], 60_000).catch((e) => {
      throw e instanceof AdbError ? e : new AdbError("ADB_COMMAND_FAILED", String(e), { serial });
    });
  }

  /** Fatal application errors since boot, harvested from logcat. */
  async appErrors(serial: string): Promise<string[]> {
    const lines = await this.logcat(serial, 5000);
    const errors: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes("FATAL EXCEPTION")) continue;
      // Attach the exception class line so repeated crashes of different
      // causes remain distinguishable in the count-based freshness diff.
      const cause = lines[i + 1]?.trim() ?? "";
      errors.push(cause || lines[i]!);
    }
    return errors;
  }

  /**
   * uiautomator dump to /sdcard/window_dump.xml, pull to a temp file, parse
   * caller-side. Bounded end-to-end; any failure is DUMP_FAILED.
   */
  async dumpUi(serial: string): Promise<string> {
    await this.assertAlive(serial);
    const tmpDir = mkdtempSync(join(tmpdir(), "inspector-uia-"));
    const local = join(tmpDir, "window_dump.xml");
    try {
      // uiautomator can transiently return empty output ("could not get idle
      // state" variants) while animations settle; retry a bounded number of
      // times before declaring DUMP_FAILED.
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const dumpOut = await runAdbOrThrow(
            this.adbPath,
            ["-s", serial, "shell", "uiautomator dump /sdcard/window_dump.xml"],
            30_000,
          );
          if (!dumpOut.includes("dumped")) {
            throw new AdbError("DUMP_FAILED", `uiautomator dump did not confirm: ${dumpOut.trim()}`, { serial });
          }
          await runAdbOrThrow(
            this.adbPath,
            ["-s", serial, "pull", "/sdcard/window_dump.xml", local],
            15_000,
          );
          return readFileSync(local, "utf8");
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw lastErr instanceof AdbError
        ? lastErr
        : new AdbError("DUMP_FAILED", `uiautomator dump failed: ${String(lastErr)}`, { serial });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Bounded liveness probe; throws DEVICE_NOT_ALIVE when the device lies. */
  private async assertAlive(serial: string): Promise<void> {
    let r: RunResult;
    try {
      r = await runAdb(this.adbPath, ["-s", serial, "shell", "echo ok"], LIVENESS_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof AdbError && e.code === "ADB_TIMEOUT") {
        throw new AdbError(
          "DEVICE_NOT_ALIVE",
          `device ${serial} listed but unresponsive (stale device); shell echo exceeded ${LIVENESS_TIMEOUT_MS}ms`,
          { serial },
        );
      }
      throw e;
    }
    if (r.code !== 0 || !r.stdout.includes("ok")) {
      throw new AdbError(
        "DEVICE_OFFLINE",
        `device ${serial} not usable: exit=${r.code} out=${r.stdout.toString("utf8").trim()} err=${r.stderr.trim()}`,
        { serial },
      );
    }
  }
}

export type AndroidBackendMode = "real" | "mock" | "auto";

/** Resolve INSPECTOR_ANDROID_BACKEND=real|mock|auto (default auto). */
export function backendModeFromEnv(env: NodeJS.ProcessEnv = process.env): AndroidBackendMode {
  const v = env["INSPECTOR_ANDROID_BACKEND"];
  if (v === "real" || v === "mock" || v === "auto") return v;
  return "auto";
}

/**
 * Backend factory honoring the selection contract. In auto mode the real
 * backend is used when `adb version` succeeds within the probe window,
 * otherwise the mock is selected with an explicit warning.
 */
export async function createAdbBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ backend: AdbBackend; mode: Exclude<AndroidBackendMode, "auto"> }> {
  const mode = backendModeFromEnv(env);
  if (mode === "mock") return { backend: new MockAdbBackend(), mode };
  if (mode === "real") return { backend: new RealAdbBackend(), mode };
  if (await probeAdbAvailable()) return { backend: new RealAdbBackend(), mode: "real" };
  console.warn(
    "[inspector-android] INSPECTOR_ANDROID_BACKEND=auto: adb unavailable or probe failed; falling back to mock backend",
  );
  return { backend: new MockAdbBackend(), mode: "mock" };
}
