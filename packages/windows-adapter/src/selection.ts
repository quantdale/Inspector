import { spawn } from "node:child_process";
import type { UiaBackend } from "./types.js";
import { MockUiaBackend } from "./mock-uia.js";
import { RealUiaBackend } from "./real-uia.js";
import { PowerShellUiaBridge } from "./uia-bridge.js";

export const WINDOWS_BACKEND_ENV = "INSPECTOR_WINDOWS_BACKEND";

export type WindowsBackendKind = "real" | "mock";

export interface BackendSelection {
  kind: WindowsBackendKind;
  backend: UiaBackend;
  /** Set when auto mode degraded to mock. */
  warning?: string;
}

export interface SelectionDeps {
  /** Overridable probe (unit tests inject fakes). */
  probe?: () => Promise<boolean>;
  makeReal?: () => UiaBackend;
  log?: (message: string) => void;
}

/**
 * Fast availability probe for the production UIA path: PowerShell must load
 * the UIAutomation assemblies AND enumerate at least one top-level window.
 * Bounded to ~10s; any failure means "unavailable".
 */
export async function probeRealUia(): Promise<boolean> {
  const script =
    "Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; " +
    "$c = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(" +
    "[System.Windows.Automation.TreeScope]::Children, " +
    "(New-Object System.Windows.Automation.PropertyCondition(" +
    "[System.Windows.Automation.AutomationElement]::ControlTypeProperty, " +
    "[System.Windows.Automation.ControlType]::Window))); " +
    "if ($c.Count -ge 1) { Write-Output OK } else { exit 1 }";
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { stdio: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => {
      done(false);
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    }, 10000);
    timer.unref?.();
    child.on("error", () => done(false));
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

/**
 * Backend selection contract:
 * - INSPECTOR_WINDOWS_BACKEND=mock -> MockUiaBackend always.
 * - INSPECTOR_WINDOWS_BACKEND=real -> RealUiaBackend unconditionally.
 * - unset or auto -> real when the probe succeeds, otherwise mock with a
 *   logged warning.
 * Any other value is an error, never a silent fallback.
 */
export async function selectWindowsBackend(
  env: NodeJS.ProcessEnv = process.env,
  deps: SelectionDeps = {},
): Promise<BackendSelection> {
  const mode = env[WINDOWS_BACKEND_ENV] ?? "auto";
  const probe = deps.probe ?? probeRealUia;
  const log = deps.log ?? ((m: string) => console.warn(m));
  if (mode === "mock") return { kind: "mock", backend: new MockUiaBackend() };
  if (mode === "real") return { kind: "real", backend: deps.makeReal?.() ?? makeRealBackend() };
  if (mode !== "auto") throw new Error(`invalid ${WINDOWS_BACKEND_ENV} value: ${mode}`);
  if (await probe()) return { kind: "real", backend: deps.makeReal?.() ?? makeRealBackend() };
  const warning =
    `${WINDOWS_BACKEND_ENV}=auto: real UIA unavailable (probe failed); ` +
    `falling back to the injectable mock backend`;
  log(warning);
  return { kind: "mock", backend: new MockUiaBackend(), warning };
}

function makeRealBackend(): RealUiaBackend {
  return new RealUiaBackend(new PowerShellUiaBridge({ timeoutMs: 15000 }));
}
