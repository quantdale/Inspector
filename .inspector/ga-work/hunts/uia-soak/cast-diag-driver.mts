/**
 * GA P6 driver: runs cast-autopsy.ps1 against fresh Notepad instances and
 * aggregates the "Specified cast is not valid." classification evidence.
 * Run from repo root: node --import tsx .inspector/ga-work/hunts/uia-soak/cast-diag-driver.mts [instances]
 */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const INSTANCES = Number(process.argv[2] ?? 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function psJsonLines(script: string, args: string[], timeoutMs = 120000) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { encoding: "utf8", timeout: timeoutMs },
  );
  return (r.stdout ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => {
      try { return JSON.parse(l); } catch { return { unparseable: l.slice(0, 200) }; }
    });
}

function notepadPid(): number | null {
  const out = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-Process Notepad -ErrorAction SilentlyContinue | Select-Object -Last 1).Id"],
    { encoding: "utf8", timeout: 20000 },
  );
  const n = Number.parseInt((out.stdout ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function killPid(pid: number) {
  try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15000 }); } catch {}
}

const allRuns: Record<string, unknown>[] = [];
for (let i = 0; i < INSTANCES; i++) {
  spawn("cmd", ["/c", "start", "", "notepad"], { detached: true, stdio: "ignore" }).unref();
  await sleep(2500);
  const pid = notepadPid();
  if (!pid) {
    allRuns.push({ instance: i, fatal: "no notepad pid" });
    continue;
  }
  await sleep(1500);
  const rows = psJsonLines(join(here, "cast-autopsy.ps1"), ["-ProcId", String(pid), "-Max", "12"]);
  const failures = rows.filter((r) => r.invokeResult === "failed");
  const retried = failures.filter((f) => String(f.retryAfterReresolve).includes("invoked"));
  allRuns.push({
    instance: i,
    pid,
    candidatesTested: rows.filter((r) => r.rid).length,
    invokeFailures: failures.length,
    transientAfterReresolve: retried.length,
    deterministicFailures: failures.length - retried.length,
    failureDetails: failures.map((f) => ({
      name: f.name,
      controlType: f.controlType,
      automationId: f.automationId,
      className: f.className,
      framework: f.framework,
      getCurrentPattern: f.getCurrentPattern,
      errorType: f.innerType ?? f.invokeErrorType,
      errorMessage: (f.innerMessage ?? f.invokeErrorMessage ?? "").slice(0, 160),
      hresult: f.innerHResult,
      retry: f.retryAfterReresolve,
    })),
  });
  await killPid(pid);
  await sleep(1000);
}
writeFileSync(join(here, "cast-autopsy-summary.json"), JSON.stringify(allRuns, null, 2));
console.log(JSON.stringify(allRuns, null, 1));
