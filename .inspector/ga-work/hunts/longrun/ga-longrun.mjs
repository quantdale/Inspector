/**
 * GA P5/P6/P7/P20: long unattended field campaign — repeated real hunts in a
 * SINGLE workspace, measuring at every checkpoint:
 *   RSS/heap (host orchestrator), node/powershell/chromium process counts,
 *   SQLite size, artifact bytes/files, step/action/observation counts,
 *   temp-dir growth.
 *
 * Distinguishes BOUNDED proportional growth from leaks: db/artifact growth
 * must track executed actions; process counts must return to baseline.
 *
 * Run from repo root:
 *   node .inspector/ga-work/hunts/longrun/ga-longrun.mjs [rounds]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import {
  resolveArtifactEntry,
  resolveBetterSqlite3,
  imagePids,
} from "../../tools/discovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolveArtifactEntry();
const Database = resolveBetterSqlite3();
const ROUNDS = Number(process.argv[2] ?? 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// inline target with interactive surface
const PAGE = `<!doctype html><html><body><h1>ga longrun</h1>
<input id="t"/><button id="add">add</button><button id="swap">swap</button><button id="clr">clear</button>
<ul id="l"></ul><script>var n=0;
document.getElementById("add").onclick=function(){var li=document.createElement("li");li.textContent="i"+(n++);document.getElementById("l").appendChild(li);};
document.getElementById("swap").onclick=function(){var l=document.getElementById("l");l.innerHTML=l.innerHTML.split("").reverse().join("");};
document.getElementById("clr").onclick=function(){document.getElementById("l").innerHTML="";};</script></body></html>`;
const server = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

function mem() {
  const mu = process.memoryUsage();
  return { rssMB: Number((mu.rss / 1048576).toFixed(1)), heapMB: Number((mu.heapUsed / 1048576).toFixed(1)) };
}
function dirStats(dir, depth = 0, acc = { files: 0, bytes: 0 }) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; } // vanishing temp entries
    if (st.isDirectory()) { if (depth < 8) dirStats(p, depth + 1, acc); }
    else { acc.files++; acc.bytes += st.size; }
  }
  return acc;
}
function checkpoint(ws, label) {
  const dbPath = join(ws, ".inspector", "runs.db");
  const art = dirStats(join(ws, ".inspector"));
  let counts = { runs: 0, steps: 0, actions: 0, observations: 0, findings: 0 };
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      counts = {
        runs: db.prepare("SELECT COUNT(*) c FROM runs").get().c,
        steps: db.prepare("SELECT COUNT(*) c FROM steps").get().c,
        actions: db.prepare("SELECT COUNT(*) c FROM actions").get().c,
        observations: db.prepare("SELECT COUNT(*) c FROM observations").get().c,
        findings: db.prepare("SELECT COUNT(*) c FROM findings").get().c,
      };
    } finally { db.close(); }
  }
  return {
    label, at: new Date().toISOString(),
    ...mem(),
    procCounts: {
      node: imagePids("node.exe").length,
      powershell: imagePids("powershell.exe").length,
      chrome: imagePids("chrome.exe").length,
      vim: imagePids("vim.exe").length,
      qemu: imagePids("qemu-system-x86_64.exe").length,
    },
    runsDbBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
    artifactFiles: art.files, artifactBytes: art.bytes,
    ...counts,
  };
}

function runInspector(args, timeoutMs = 600000) {
  const child = spawn(process.execPath, [ENTRY, ...args]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const t = setTimeout(() => child.kill(), timeoutMs);
  return new Promise((resolve) => {
    child.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, stdout: out }); });
  });
}
function parseJsonTail(text) {
  const i = text.indexOf("{");
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

const ws = mkdtempSync(join(tmpdir(), "ga-longrun-"));
const tempBaseBefore = dirStats(tmpdir());
const checkpoints = [checkpoint(ws, "baseline")];
let failures = 0;

for (let r = 0; r < ROUNDS; r++) {
  const res = await runInspector([
    "hunt", "--adapter", "web", "--url", URL_, "--workspace", ws,
    "--max-actions", "120", "--max-minutes", "6",
    "--seed", String(100 + r), "--json",
  ]);
  if (res.code !== 0) failures++;
  const s = parseJsonTail(res.stdout);
  checkpoints.push(checkpoint(ws, `after-round-${r}`));
  console.log(JSON.stringify({ round: r, exit: res.code, actions: s?.actionsExecuted, states: s?.statesVisited }));
}
// cleanup-possible check
let cleanupOk = false;
try { rmSync(ws, { recursive: true, force: true }); cleanupOk = !existsSync(ws); } catch {}
const tempBaseAfter = dirStats(tmpdir());

const first = checkpoints[1] ?? checkpoints[0];
const last = checkpoints.at(-1);
const summary = {
  rounds: ROUNDS,
  huntFailures: failures,
  startedAt: checkpoints[0].at,
  endedAt: last.at,
  growth: {
    runsDbBytes: { first: first.runsDbBytes, last: last.runsDbBytes },
    artifactBytes: { first: first.artifactBytes, last: last.artifactBytes },
    steps: { first: first.steps, last: last.steps },
    observations: { first: first.observations, last: last.observations },
    rssMB: checkpoints.map((c) => c.rssMB),
    heapMB: checkpoints.map((c) => c.heapMB),
    nodeProcs: checkpoints.map((c) => c.procCounts.node),
    chromeProcs: checkpoints.map((c) => c.procCounts.chrome),
  },
  tempDirDeltaFiles: tempBaseAfter.files - tempBaseBefore.files,
  workspaceCleanupPossible: cleanupOk,
  verdictTieBreaker: { cleanupOk, huntFailures: failures },
  checkpoints,
};
writeFileSync(join(here, "ga-longrun-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, checkpoints: undefined }, null, 1));
server.close();
process.exit(failures === 0 && cleanupOk ? 0 : 1);
