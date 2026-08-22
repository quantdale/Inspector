/** Debug: what does listWindows show for 12s after invoking "Keep on top"? */
import { spawn, spawnSync } from "node:child_process";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
const backend = new RealUiaBackend(bridge);

// reuse any running calculator or start one
let wins = await backend.listWindows();
let win = wins.find((w) => /calcul/i.test(w.title));
if (!win) {
  spawn("cmd", ["/c", "start", "", "calc.exe"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40 && !win; i++) {
    await sleep(500);
    wins = await backend.listWindows();
    win = wins.find((w) => /calcul/i.test(w.title));
  }
}
console.log("attach target:", win);
await backend.attach({ pid: win!.pid });
const base = await backend.richTree();
console.log("baseline nodes:", base.nodes.length);
const kot = base.nodes.find((n) => /keep on top/i.test(n.name));
if (!kot) { console.log("no keep-on-top button"); bridge.dispose(); process.exit(1); }
await backend.invoke(kot.id);
for (let i = 0; i < 12; i++) {
  await sleep(500);
}
// Deep probe: ALL desktop-root children regardless of control type + processes.
const psScript = [
  'Add-Type -AssemblyName UIAutomationClient',
  'Add-Type -AssemblyName UIAutomationTypes',
  '$root = [System.Windows.Automation.AutomationElement]::RootElement',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
  'foreach ($e in $all) {',
  '  try { $c = $e.Current; Write-Output (("{0}|{1}|{2}" -f $c.ControlType.ProgrammaticName, ($c.Name -replace "[\r\n]", " "), $c.ProcessId)) } catch {}',
  '}',
];
const deep = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript.join("; ")], { encoding: "utf8", timeout: 60000 });
console.log((deep.stdout ?? "").split(/\r?\n/).join("\n"));
const procs = spawnSync("tasklist", ["/FI", "IMAGENAME eq CalculatorApp.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
console.log("CalculatorApp procs:", (procs.stdout ?? "").trim() || "none");
spawnSync("taskkill", ["/IM", "CalculatorApp.exe", "/T", "/F"], { timeout: 15000 });
bridge.dispose();
