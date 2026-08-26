import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Workspace package roots that may legitimately own an optional dependency:
 * pnpm links each package's deps only into that package's node_modules, so a
 * probe running from packages/workflows must also look where the owner lives
 * (adapter-web owns playwright, cli-adapter owns node-pty, ...).
 */
const PACKAGE_CONTEXTS = [
  "workflows",
  "cli",
  "adapter-web",
  "cli-adapter",
  "electron-adapter",
].map((pkg) => join(here, "..", "..", pkg));

function resolveFromContexts(spec: string): boolean {
  for (const dir of PACKAGE_CONTEXTS) {
    try {
      createRequire(join(dir, "package.json")).resolve(spec);
      return true;
    } catch {
      /* try next context */
    }
  }
  return false;
}

export interface BackendProbe {
  ok: boolean;
  detail: string;
}

interface ExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a short-lived probe process; kill the whole tree when it overruns. */
function execProbe(command: string, args: string[], timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Synchronous playwright probe via createRequire — robust across plain node
 * and test module-runners alike (no dynamic variable-specifier imports).
 */
export function probeBrowser(): BackendProbe {
  for (const dir of PACKAGE_CONTEXTS) {
    try {
      const req = createRequire(join(dir, "package.json"));
      const pw = req("playwright") as { chromium?: { executablePath?: () => string } };
      const exePath = pw.chromium?.executablePath?.();
      if (typeof exePath === "string" && exePath.length > 0 && existsSync(exePath)) {
        return { ok: true, detail: exePath };
      }
      return { ok: false, detail: `chromium executable not present at ${String(exePath ?? "?")}` };
    } catch {
      /* next context */
    }
  }
  return { ok: false, detail: "playwright package not resolvable" };
}

export function probePty(): BackendProbe {
  const ok = resolveFromContexts("@lydell/node-pty");
  return { ok, detail: ok ? "@lydell/node-pty resolvable" : "@lydell/node-pty not resolvable" };
}

export async function probeAdb(): Promise<BackendProbe> {
  const outcome = await execProbe("adb", ["version"], 2000);
  if (outcome.timedOut) return { ok: false, detail: "adb version timed out after 2s" };
  if (outcome.code !== 0) {
    return {
      ok: false,
      detail: outcome.code === null ? "adb not found on PATH" : `adb version exited ${outcome.code}`,
    };
  }
  return { ok: true, detail: outcome.stdout.split("\n")[0]?.trim() ?? "adb" };
}

const UIA_PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  "$root = [System.Windows.Automation.AutomationElement]::RootElement",
  "$cond = New-Object System.Windows.Automation.PropertyCondition(" +
    "[System.Windows.Automation.AutomationElement]::ControlTypeProperty," +
    " [System.Windows.Automation.ControlType]::Window)",
  "$n = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond).Count",
  "Write-Output ('UIA_OK count=' + $n)",
].join("; ");

export async function probeUia(): Promise<BackendProbe> {
  if (process.platform !== "win32") {
    return { ok: false, detail: `unsupported platform: ${process.platform}` };
  }
  // -EncodedCommand (UTF-16LE base64) so no quoting ever interpolates into the
  // script text; same pattern as the windows adapter's UIA bridge.
  const encoded = Buffer.from(UIA_PROBE_SCRIPT, "utf16le").toString("base64");
  const outcome = await execProbe(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    5000,
  );
  if (outcome.timedOut) return { ok: false, detail: "powershell UIA probe timed out after 5s" };
  const match = /UIA_OK count=(\d+)/.exec(outcome.stdout);
  if (outcome.code === 0 && match && Number(match[1]) >= 1) {
    return { ok: true, detail: `${match[1]} top-level window(s) enumerated` };
  }
  return {
    ok: false,
    detail:
      (match && Number(match[1]) === 0
        ? "UIA loaded but zero top-level windows enumerable"
        : outcome.stderr.split("\n")[0]?.trim()) || `powershell exited ${outcome.code}`,
  };
}

export async function probeElectron(): Promise<BackendProbe> {
  // HARDENING_5 H5.2.7: capability must never exceed executability. A real
  // Electron launch needs a display on non-Windows hosts; advertising
  // electron on a headless runner would route items into doomed launches.
  const displayAvailable =
    process.platform === "win32" ||
    !!process.env.DISPLAY ||
    !!process.env.WAYLAND_DISPLAY;
  for (const dir of PACKAGE_CONTEXTS) {
    try {
      const req = createRequire(join(dir, "package.json"));
      const electronEntry = req.resolve("electron") as string;
      const electronExecutable = join(
        dirname(electronEntry),
        "dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      );
      if (existsSync(electronExecutable)) {
        if (!displayAvailable) {
          return {
            ok: false,
            detail: "electron executable present but no display available (set DISPLAY or run under Xvfb)",
          };
        }
        return { ok: true, detail: "production Electron executable available" };
      }
      return { ok: false, detail: "electron package present but executable unavailable" };
    } catch {
      /* next context */
    }
  }
  return { ok: false, detail: "electron package not resolvable" };
}
