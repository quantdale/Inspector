import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store } from "@inspector/store-sqlite";
import { resolveAdapterBin, type AdapterBinRef } from "@inspector/adapter-sdk";

export interface ProbeResult {
  name: string;
  ok: boolean;
  /** Core probes gate the exit code; capability probes only warn. */
  required: boolean;
  detail: string;
  remediation?: string;
}

// Resolved lazily per probe so doctor works from a workspace checkout (tsx +
// sources) AND from an installed artifact (bundled siblings), and never
// throws at import time when the layout is unexpected.
function fakeAdapterBin(): AdapterBinRef | null {
  try {
    return resolveAdapterBin(
      import.meta.url,
      "inspector-adapter-fake.js",
      "..",
      "..",
      "adapter-fake",
      "src",
      "bin",
    );
  } catch {
    return null;
  }
}

/**
 * Workspace package roots that may legitimately own an optional dependency:
 * pnpm links each package's deps only into that package's node_modules, so a
 * probe running from packages/cli must also look where the consumer lives
 * (adapter-web owns playwright, cli-adapter owns node-pty, etc.).
 */
const here = dirname(fileURLToPath(import.meta.url));

const PACKAGE_CONTEXTS = [
  "cli",
  "adapter-web",
  "cli-adapter",
  "electron-adapter",
].map((pkg) => join(here, "..", "..", pkg));

/** Resolve a specifier from any workspace package context; null when nowhere. */
function resolveFromContexts(
  spec: string,
): { path: string; via: string } | null {
  for (const dir of PACKAGE_CONTEXTS) {
    try {
      const resolved = createRequire(join(dir, "package.json")).resolve(spec);
      return { path: resolved, via: dir };
    } catch {
      /* try next context */
    }
  }
  return null;
}

/**
 * Resolve a module specifier without executing it. Used for native/optional
 * packages where a full import would run initialization code just to answer
 * "is it installed?".
 */
function resolvable(spec: string): boolean {
  if (resolveFromContexts(spec) !== null) return true;
  try {
    createRequire(import.meta.url).resolve(spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dynamic import with a variable specifier on purpose: literal specifiers for
 * optional peer packages (playwright, electron) would fail `tsc` module
 * resolution because packages/cli does not declare them as dependencies.
 */
async function importOptional(
  spec: string,
): Promise<Record<string, unknown> | null> {
  let mod: Record<string, unknown> | null = null;
  try {
    mod = (await import(spec)) as Record<string, unknown>;
  } catch {
    /* fall through to workspace-context resolution */
  }
  if (!mod) {
    const resolved = resolveFromContexts(spec);
    if (!resolved) return null;
    try {
      mod = (await import(pathToFileURL(resolved.path).href)) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }
  // CJS modules surface their exports on `default` under dynamic ESM import.
  const interop = (mod as { default?: unknown }).default;
  if (
    mod.chromium === undefined &&
    interop !== null &&
    typeof interop === "object"
  ) {
    return interop as Record<string, unknown>;
  }
  return mod;
}

interface ExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a short-lived probe process; kill the whole tree when it overruns. */
function execProbe(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: `${stderr}${err.message}`,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function probeNode(): ProbeResult {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "node >= 22",
    ok: major >= 22,
    required: true,
    detail: `node ${process.versions.node}`,
    remediation: major >= 22 ? undefined : "install Node.js 22 or newer",
  };
}

function probeWorkspaceWritable(base: string): ProbeResult {
  try {
    mkdirSync(base, { recursive: true });
    const probeFile = join(base, ".doctor-write-probe");
    writeFileSync(probeFile, "probe");
    rmSync(probeFile);
    return {
      name: "workspace writable",
      ok: true,
      required: true,
      detail: base,
    };
  } catch (e) {
    return {
      name: "workspace writable",
      ok: false,
      required: true,
      detail: e instanceof Error ? e.message : String(e),
      remediation: `grant write access to ${base} or pass --workspace <dir>`,
    };
  }
}

function probeStore(base: string): ProbeResult {
  let store: ReturnType<typeof Store.open> | null = null;
  try {
    store = Store.open(join(base, "runs.db"));
    store.listRuns(1);
    return {
      name: "sqlite store opens",
      ok: true,
      required: true,
      detail: join(base, "runs.db"),
    };
  } catch (e) {
    return {
      name: "sqlite store opens",
      ok: false,
      required: true,
      detail: e instanceof Error ? e.message : String(e),
      remediation:
        "check disk health and that the workspace path is not read-only",
    };
  } finally {
    try {
      store?.close();
    } catch {
      /* already closed */
    }
  }
}

function probeFakeAdapter(): ProbeResult {
  const bin = fakeAdapterBin();
  const ok = bin !== null;
  return {
    name: "fake adapter resolvable",
    ok,
    required: true,
    detail: bin
      ? bin.binFile
      : "fake adapter binary not found in this installation",
    remediation: ok
      ? undefined
      : "fake adapter missing; reinstall Inspector (dev: pnpm install at the repo root)",
  };
}

async function probeWeb(): Promise<ProbeResult> {
  const pw = await importOptional("playwright");
  if (!pw || typeof pw.chromium !== "object" || pw.chromium === null) {
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: "playwright package not resolvable",
      remediation: "run pnpm install at the repository root",
    };
  }
  try {
    const chromium = pw.chromium as { executablePath(): string };
    const exePath = chromium.executablePath();
    if (
      typeof exePath === "string" &&
      exePath.length > 0 &&
      existsSync(exePath)
    ) {
      return {
        name: "web adapter (Playwright + Chromium)",
        ok: true,
        required: false,
        detail: exePath,
      };
    }
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: `chromium executable not present at ${String(exePath)}`,
      remediation: "pnpm exec playwright install chromium",
    };
  } catch (e) {
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: e instanceof Error ? e.message : String(e),
      remediation: "pnpm exec playwright install chromium",
    };
  }
}

function probePty(): ProbeResult {
  const ok = resolvable("@lydell/node-pty");
  return {
    name: "pty support (@lydell/node-pty)",
    ok,
    required: false,
    detail: ok
      ? "@lydell/node-pty resolvable"
      : "@lydell/node-pty not resolvable",
    remediation: ok
      ? undefined
      : "install workspace dependencies (@lydell/node-pty powers the terminal adapters)",
  };
}

async function probeAndroid(): Promise<ProbeResult> {
  const outcome = await execProbe("adb", ["version"], 2000);
  if (outcome.timedOut) {
    return {
      name: "android adb on PATH",
      ok: false,
      required: false,
      detail: "adb version timed out after 2s",
      remediation:
        "ensure Android platform-tools are installed and adb responds",
    };
  }
  if (outcome.code !== 0) {
    return {
      name: "android adb on PATH",
      ok: false,
      required: false,
      detail:
        outcome.code === null
          ? "adb not found on PATH"
          : `adb version exited ${outcome.code}`,
      remediation: "install Android platform-tools and put adb on PATH",
    };
  }
  const firstLine = outcome.stdout.split("\n")[0]?.trim() ?? "adb";
  return {
    name: "android adb on PATH",
    ok: true,
    required: false,
    detail: firstLine,
  };
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

async function probeWindowsUia(): Promise<ProbeResult> {
  if (process.platform !== "win32") {
    return {
      name: "windows-uia automation",
      ok: false,
      required: false,
      detail: `unsupported platform: ${process.platform}`,
      remediation: "the windows-uia adapter requires Windows",
    };
  }
  // -EncodedCommand (UTF-16LE base64) so no quoting ever interpolates into the
  // script text; same pattern as the windows adapter's UIA bridge.
  const encoded = Buffer.from(UIA_PROBE_SCRIPT, "utf16le").toString("base64");
  const outcome = await execProbe(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    5000,
  );
  if (outcome.timedOut) {
    return {
      name: "windows-uia automation",
      ok: false,
      required: false,
      detail: "powershell UIA probe timed out after 5s",
      remediation:
        "verify Windows PowerShell and UIAutomationClient availability",
    };
  }
  const match = /UIA_OK count=(\d+)/.exec(outcome.stdout);
  if (outcome.code === 0 && match && Number(match[1]) >= 1) {
    return {
      name: "windows-uia automation",
      ok: true,
      required: false,
      detail: `${match[1]} top-level window(s) enumerated`,
    };
  }
  const detail =
    match && Number(match[1]) === 0
      ? "UIA loaded but zero top-level windows enumerable"
      : outcome.stderr.split("\n")[0]?.trim() ||
        `powershell exited ${outcome.code}`;
  return {
    name: "windows-uia automation",
    ok: false,
    required: false,
    detail,
    remediation:
      "verify Windows PowerShell and UIAutomationClient availability",
  };
}

function electronAdapterBinFile(): string | null {
  try {
    return resolveAdapterBin(
      import.meta.url,
      "inspector-adapter-electron.js",
      "..",
      "..",
      "electron-adapter",
      "src",
      "bin",
    ).binFile;
  } catch {
    return null;
  }
}

async function probeElectron(): Promise<ProbeResult> {
  const adapterSrc = electronAdapterBinFile();
  const adapterPresent = adapterSrc !== null && existsSync(adapterSrc);
  if (resolvable("electron")) {
    return {
      name: "electron runtime",
      ok: true,
      required: false,
      detail: `electron package resolvable${adapterPresent ? "; electron-adapter present" : ""}`,
    };
  }
  return {
    name: "electron runtime",
    ok: false,
    required: false,
    detail: adapterPresent
      ? "electron-adapter binary present but the electron package is not installed"
      : "electron package not resolvable",
    remediation:
      "install electron (see packages/electron-adapter) to use the electron adapter",
  };
}

/** Run every doctor probe against the given workspace directory. */
export async function runDoctorProbes(base: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [
    probeNode(),
    probeWorkspaceWritable(base),
    probeStore(base),
    probeFakeAdapter(),
  ];
  results.push(await probeWeb());
  results.push(probePty());
  results.push(await probeAndroid());
  results.push(await probeWindowsUia());
  results.push(await probeElectron());
  return results;
}

/** Human-readable doctor report; WARN marks failing optional probes. */
export function renderDoctorReport(checks: ProbeResult[]): string {
  const lines = checks.map((c) => {
    const status = c.ok ? "PASS" : c.required ? "FAIL" : "WARN";
    const line = `${status}  ${c.name}  (${c.detail})`;
    return c.ok || !c.remediation ? line : `${line}\n      -> ${c.remediation}`;
  });
  const failedRequired = checks.filter((c) => !c.ok && c.required).length;
  const failedOptional = checks.filter((c) => !c.ok && !c.required).length;
  if (failedRequired === 0) {
    lines.push(
      failedOptional === 0
        ? "doctor: OK"
        : `doctor: core checks OK (${failedOptional} optional capability warning(s))`,
    );
  } else {
    lines.push(`doctor: ${failedRequired} core check(s) failed`);
  }
  return lines.join("\n");
}
