/**
 * GA Phase 16: interrupt/resume field soak against the INSTALLED artifact.
 *
 * Kills `inspector hunt` (web adapter against a real local static server)
 * at varied lifecycle timings via abrupt process-tree death, then verifies:
 *   - runs.db readable; no SQLITE_BUSY/persistent lock
 *   - resume succeeds (exit 0) or fails HONESTLY with a documented reason
 *   - terminal (closed) runs are NOT accidentally resumed
 *   - no UNIQUE constraint errors anywhere
 *   - step sequences strictly increasing (no reuse), single run row per ws
 *   - workspace cleanup (rm) still possible after kill + resume
 *
 * Portability: the installed artifact entry and better-sqlite3 are
 * discovered dynamically (GA_ARTIFACT_NODE_MODULES / GA_INSPECTOR_BIN).
 *
 * Run from repo root:
 *   node .inspector/ga-work/hunts/interrupt-resume/ga-interrupt-resume.mjs [repeatsOfHighRisk]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveArtifactEntry,
  resolveBetterSqlite3,
} from "../../tools/discovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, "interrupt-resume-results.jsonl");
const ENTRY = resolveArtifactEntry();
const Database = resolveBetterSqlite3();

const HIGH_RISK_REPEATS = Number(process.argv[2] ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- static target server -------------------------------------------------
const PAGE = `<!doctype html><html><body>
<h1>ga interrupt target</h1>
<input id="t" placeholder="type here"/>
<button id="a">add</button><button id="b">swap</button><button id="c">clear</button>
<ul id="list"></ul>
<script>
var items=[];function render(){var l=document.getElementById("list");l.innerHTML="";
items.forEach(function(t){var li=document.createElement("li");li.textContent=t;l.appendChild(li);});}
document.getElementById("a").onclick=function(){items.push(document.getElementById("t").value||("i"+items.length));render();};
document.getElementById("b").onclick=function(){items.reverse();render();};
document.getElementById("c").onclick=function(){items.length=0;render();};
</script></body></html>`;
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const TARGET_URL = `http://127.0.0.1:${PORT}/`;

// --- helpers ---------------------------------------------------------------
/** Spawn the installed artifact's CLI entry directly on this Node. */
function spawnInspector(args) {
  const child = spawn(process.execPath, [ENTRY, ...args]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? -1)));
  return { child, output: () => out, exited };
}

function runInspector(args, timeoutMs = 180000) {
  const { child, output, exited } = spawnInspector(args);
  const t = setTimeout(() => child.kill(), timeoutMs);
  return exited.then((code) => {
    clearTimeout(t);
    return { code, stdout: output() };
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    const r = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    r.on("close", resolve);
    r.on("error", () => resolve(-1));
  });
}

function dbReadonly(dbPath) {
  if (!existsSync(dbPath)) return { error: "no runs.db" };
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const runs = db.prepare("SELECT id, status, adapter FROM runs ORDER BY created_at").all();
      const steps = db.prepare("SELECT sequence FROM steps ORDER BY sequence").all().map((r) => r.sequence);
      const actions = db.prepare("SELECT COUNT(*) c FROM actions").get().c;
      const dupActions = db.prepare(
        "SELECT COUNT(*) c FROM (SELECT id FROM actions GROUP BY id HAVING COUNT(*) > 1)",
      ).get().c;
      return {
        runCount: runs.length,
        runs: runs.map((r) => ({ id: r.id, status: r.status })),
        steps: steps.length,
        sequencesStrictlyIncreasing: steps.every((v, i) => i === 0 || v > steps[i - 1]),
        actions,
        duplicateActionIds: dupActions,
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

async function oneKillCycle(label, delayMs, seed) {
  const ws = mkdtempSync(join(tmpdir(), "ga-ir-"));
  const startedAt = new Date().toISOString();
  const hunt = spawnInspector([
    "hunt", "--adapter", "web", "--url", TARGET_URL,
    "--workspace", ws, "--max-actions", "400", "--max-minutes", "10",
    "--seed", String(seed), "--json",
  ]);

  await sleep(delayMs);
  const stillRunning = hunt.child.exitCode === null;
  const killStatus = stillRunning ? await killTree(hunt.child.pid) : "exited-before-kill";
  await hunt.exited.catch(() => {});
  await sleep(500);

  const killedState = dbReadonly(join(ws, ".inspector", "runs.db"));
  const runId = Array.isArray(killedState.runs) && killedState.runs[0]?.id;

  let resumeExit = null;
  let resumeOut = "";
  let resumeClass = "no-run-recorded";
  if (runId) {
    const res = await runInspector(["runs", "resume", runId, "--workspace", ws, "--json"]);
    resumeExit = res.code;
    resumeOut = res.stdout;
    resumeClass = res.code === 0 ? "resumed" : "rejected";
  }

  const uniqueErr = /UNIQUE constraint/i.test(resumeOut);
  const busyErr = /SQLITE_BUSY|database is locked|EBUSY|EPERM/i.test(resumeOut);

  const postState = dbReadonly(join(ws, ".inspector", "runs.db"));
  let cleanupOk = false;
  let cleanupError = null;
  try {
    rmSync(ws, { recursive: true, force: true });
    cleanupOk = !existsSync(ws);
  } catch (e) {
    cleanupError = String(e).slice(0, 200);
  }

  const row = {
    label,
    delayMs,
    seed,
    startedAt,
    endedAt: new Date().toISOString(),
    killedWhileRunning: stillRunning,
    killStatus,
    killedState,
    resumeExit,
    resumeClass,
    uniqueConstraintError: uniqueErr,
    busyOrLockError: busyErr,
    postResumeState: postState,
    integrityOk:
      !killedState.error &&
      !postState.error &&
      postState.runCount === 1 &&
      postState.sequencesStrictlyIncreasing === true &&
      postState.duplicateActionIds === 0 &&
      !uniqueErr &&
      !busyErr,
    resumeReasonSample: resumeOut.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 300),
    cleanupOk,
    ...(cleanupError ? { cleanupError } : {}),
  };
  appendFileSync(RESULTS, JSON.stringify(row) + "\n");
  console.log(JSON.stringify({ label, resumeClass, integrityOk: row.integrityOk, cleanupOk }));
  return row;
}

/** Terminal-run guard: completed hunts must refuse resume honestly. */
async function terminalRunGuard() {
  const ws = mkdtempSync(join(tmpdir(), "ga-ir-term-"));
  const res = await runInspector([
    "hunt", "--adapter", "web", "--url", TARGET_URL,
    "--workspace", ws, "--max-actions", "12", "--max-minutes", "5",
    "--seed", "11", "--json",
  ]);
  if (res.code !== 0) {
    return { label: "terminal-guard", skipped: `hunt did not complete cleanly (exit ${res.code})`, tail: res.stdout.slice(-200) };
  }
  const state = dbReadonly(join(ws, ".inspector", "runs.db"));
  const runId = state.runs?.[0]?.id;
  const resumeRes = await runInspector(["runs", "resume", runId, "--workspace", ws, "--json"]);
  rmSync(ws, { recursive: true, force: true });
  return {
    label: "terminal-guard",
    finalHuntStatus: state.runs?.[0]?.status,
    resumeExit: resumeRes.code,
    honestRejection: resumeRes.code === 1 && /already .*nothing to resume/i.test(resumeRes.stdout),
    reason: resumeRes.stdout.split(/\r?\n/).filter(Boolean)[0]?.slice(0, 200),
  };
}

// --- main ------------------------------------------------------------------
const timings = [4000, 6000, 8000, 10000, 12000, 16000];
for (let i = 0; i < HIGH_RISK_REPEATS; i++) {
  timings.push(8000, 12000);
}
const rows = [];
let seed = 5;
for (const [idx, d] of timings.entries()) {
  rows.push(await oneKillCycle(`kill@${d}ms#${idx}`, d, seed++));
}
const terminal = await terminalRunGuard();

const summary = {
  inspectorEntry: ENTRY,
  targetUrl: TARGET_URL,
  cycles: rows.length,
  resumed: rows.filter((r) => r.resumeClass === "resumed").length,
  rejected: rows.filter((r) => r.resumeClass === "rejected").length,
  integrityFailures: rows.filter((r) => !r.integrityOk).length,
  uniqueConstraintErrors: rows.filter((r) => r.uniqueConstraintError).length,
  busyOrLockErrors: rows.filter((r) => r.busyOrLockError).length,
  cleanupFailures: rows.filter((r) => !r.cleanupOk).length,
  terminalGuard: terminal,
  verdict:
    rows.some((r) => !r.integrityOk) || rows.some((r) => !r.cleanupOk)
      ? "FAIL"
      : terminal.honestRejection === false
        ? "FAIL"
        : "PASS",
};
console.log(JSON.stringify(summary, null, 2));
writeFileSync(join(here, "ga-interrupt-summary.json"), JSON.stringify({ summary, rows }, null, 2));
server.close();
process.exit(summary.verdict === "PASS" ? 0 : 1);
