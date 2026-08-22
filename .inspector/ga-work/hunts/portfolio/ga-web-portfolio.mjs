/**
 * GA P4/P8: real-target web portfolio against the INSTALLED artifact.
 *
 * Targets (independently developed, offline-served):
 *   - todomvc-react@1.0.4 (MIT)
 *   - todomvc-backbone (official todomvc@0.1.1 example, MIT)
 *   - inspector-seeded-control (fake adapter) -> LABELED CONTROL, excluded
 *     from novel-defect claims by design.
 *
 * Per target: ephemeral-port static server (same proven shape as the P3
 * install proof), readiness poll, unscripted `inspector hunt`, findings list,
 * compact runs.db metric extraction. One summary JSON at the end.
 *
 * Run from repo root:
 *   node .inspector/ga-work/hunts/portfolio/ga-web-portfolio.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveArtifactEntry,
  resolveBetterSqlite3,
} from "../../tools/discovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..", "..");
const ENTRY = resolveArtifactEntry();
const Database = resolveBetterSqlite3();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- static server (proven P3 shape: ephemeral port, guarded handler) -----
import { createServer } from "node:http";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff": "font/woff",
};

function serve(dir) {
  const events = [];
  const server = createServer((req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const fp = join(dir, p === "/" ? "index.html" : p);
      if (!fp.startsWith(dir) || !existsSync(fp) || statSync(fp).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      const ext = fp.slice(fp.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(readFileSync(fp));
    } catch (e) {
      events.push(`handler: ${String(e).slice(0, 120)}`);
      try { res.writeHead(500); res.end(); } catch { /* socket gone */ }
    }
  });
  server.on("error", (e) => events.push(`error: ${String(e).slice(0, 120)}`));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, events }),
    );
  });
}

async function waitReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await sleep(300);
  }
  return false;
}

// ---- CLI helpers -----------------------------------------------------------
function runInspector(args, timeoutMs = 900000) {
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
  const start = text.indexOf("{");
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

function workspaceMetrics(ws) {
  const dbPath = join(ws, ".inspector", "runs.db");
  if (!existsSync(dbPath)) return { error: "no runs.db" };
  const db = new Database(dbPath, { readonly: true });
  try {
    const run = db.prepare("SELECT id, status, adapter, created_at FROM runs ORDER BY created_at DESC LIMIT 1").get();
    const actions = db.prepare("SELECT status, COUNT(*) c FROM actions WHERE run_id=? GROUP BY status").all(run.id);
    const kinds = db.prepare("SELECT kind, COUNT(*) c FROM actions WHERE run_id=? GROUP BY kind ORDER BY c DESC").all(run.id);
    const obs = db.prepare("SELECT COUNT(*) c, COUNT(DISTINCT summary_json) d FROM observations WHERE run_id=?").get(run.id);
    const findings = db.prepare("SELECT COUNT(*) c FROM findings WHERE run_id=?").get(run.id);
    const oracleEvals = db.prepare("SELECT COUNT(*) c FROM oracle_evaluations WHERE run_id=?").get(run.id)?.c ?? 0;
    return {
      runId: run.id, status: run.status, adapter: run.adapter,
      actionByStatus: Object.fromEntries(actions.map((a) => [a.status, a.c])),
      actionKinds: Object.fromEntries(kinds.map((k) => [k.kind, k.c])),
      observations: obs.c, distinctObservations: obs.d,
      findingRows: findings.c, oracleEvaluations: oracleEvals,
    };
  } finally { db.close(); }
}

// ---- portfolio -------------------------------------------------------------
const targets = [
  {
    id: "web-todomvc-react",
    dir: join(REPO_ROOT, ".inspector", "rc-work", "targets", "todomvc-react"),
    provenance: "todomvc-react@1.0.4 from registry.npmjs.org (MIT)",
    maxActions: 220, maxMinutes: 10, seed: 41,
  },
  {
    id: "web-todomvc-backbone",
    dir: join(REPO_ROOT, ".inspector", "rc-work", "targets", "todomvc-backbone", "app"),
    provenance: "official todomvc@0.1.1 backbone example (MIT)",
    maxActions: 180, maxMinutes: 8, seed: 43,
  },
];

const results = [];
for (const t of targets) {
  if (!existsSync(join(t.dir, "index.html"))) {
    results.push({ id: t.id, skipped: `target missing at ${t.dir}` });
    continue;
  }
  const { server, port, events } = await serve(t.dir);
  const url = `http://127.0.0.1:${port}/`;
  const ready = await waitReady(url);
  const ws = mkdtempSync(join(tmpdir(), `ga-p4-${t.id}-`));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const hunt = await runInspector([
    "hunt", "--adapter", "web", "--url", url,
    "--workspace", ws, "--max-actions", String(t.maxActions),
    "--max-minutes", String(t.maxMinutes), "--seed", String(t.seed), "--json",
  ]);
  const wallMs = Date.now() - t0;
  const summary = parseJsonTail(hunt.stdout);
  const fl = await runInspector(["findings", "list", "--workspace", ws, "--json"]);
  let findingIds = [];
  try { findingIds = JSON.parse(fl.stdout).map((f) => f.id); } catch {}
  results.push({
    id: t.id,
    provenance: t.provenance,
    url,
    startedAt,
    wallMs,
    ready,
    serverEvents: events,
    huntExit: hunt.code,
    stoppedReason: summary?.stoppedReason,
    actionsExecuted: summary?.actionsExecuted,
    statesVisited: summary?.statesVisited,
    resets: summary?.resets,
    anomalies: summary?.anomalies,
    findings: summary?.findings ?? [],
    warnings: summary?.warnings ?? [],
    findingIdsShown: findingIds.length,
    dbMetrics: workspaceMetrics(ws),
    workspace: ws,
  });
  console.log(JSON.stringify({ id: t.id, exit: hunt.code, ready, actions: summary?.actionsExecuted, states: summary?.statesVisited, anomalies: summary?.anomalies }));
  server.close();
}

// labeled control: deterministic seeded pipeline proof, NOT defect evidence
{
  const ws = mkdtempSync(join(tmpdir(), "ga-p4-control-"));
  const ctrl = await runInspector([
    "hunt", "--adapter", "fake", "--workspace", ws,
    "--max-actions", "80", "--max-minutes", "5", "--seed", "7", "--json",
  ]);
  const summary = parseJsonTail(ctrl.stdout);
  results.push({
    id: "inspector-seeded-control",
    role: "LABELED CONTROL (fake adapter; excluded from novel-defect evidence)",
    huntExit: ctrl.code,
    stoppedReason: summary?.stoppedReason,
    actionsExecuted: summary?.actionsExecuted,
    statesVisited: summary?.statesVisited,
    anomalies: summary?.anomalies,
    findings: summary?.findings ?? [],
    dbMetrics: workspaceMetrics(ws),
    workspace: ws,
  });
  console.log(JSON.stringify({ id: "control", exit: ctrl.code, anomalies: summary?.anomalies }));
}

writeFileSync(join(here, "ga-web-portfolio.json"), JSON.stringify({
  artifactEntry: ENTRY,
  startedAt: new Date().toISOString(),
  results,
}, null, 2));
console.log("portfolio summary written");
process.exit(results.some((r) => !r.skipped && r.role === undefined && r.huntExit !== 0) ? 1 : 0);
