#!/usr/bin/env node
// GA field-campaign metrics extractor.
// Usage: node ga-metrics.mjs <workspace-dir> [runLabel]
// Emits one JSON record per run found in the workspace's runs.db.
// better-sqlite3 is loaded from the INSTALLED artifact (GA_ARTIFACT_NODE_MODULES
// or the global npm root); falls back to a workspace checkout resolution.
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

function artifactNodeModules() {
  if (process.env.GA_ARTIFACT_NODE_MODULES) return process.env.GA_ARTIFACT_NODE_MODULES;
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const candidate = join(globalRoot, "inspector-cli");
    if (existsSync(join(candidate, "package.json"))) return join(candidate, "node_modules");
  } catch {
    /* fall through */
  }
  // Workspace checkout fallback (repo root node_modules).
  return join(here, "..", "..", "..", "..");
}

const req = createRequire(join(artifactNodeModules(), "package.json"));
const Database = req("better-sqlite3");

const ws = resolve(process.argv[2]);
const label = process.argv[3] ?? ws;
const dbPath = join(ws, ".inspector", "runs.db");
let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  console.log(
    JSON.stringify({ label, error: "no runs.db", detail: String(e) }),
  );
  process.exit(0);
}

function walk(dir, depth = 0, acc = { files: 0, bytes: 0 }) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (depth < 8) walk(p, depth + 1, acc);
    } else {
      acc.files += 1;
      acc.bytes += st.size;
    }
  }
  return acc;
}

const artRoot = join(ws, ".inspector");
const artifacts = walk(artRoot);
const dbStat = statSync(dbPath);

const out = [];
for (const run of db.prepare("SELECT * FROM runs").all()) {
  const id = run.id ?? run.run_id;
  const byStatus = db
    .prepare(
      "SELECT status, COUNT(*) c FROM actions WHERE run_id=? GROUP BY status",
    )
    .all(id);
  const byKind = db
    .prepare(
      "SELECT kind, COUNT(*) c FROM actions WHERE run_id=? GROUP BY kind ORDER BY c DESC",
    )
    .all(id);
  const obs = db
    .prepare(
      "SELECT COUNT(*) c, COUNT(DISTINCT summary_json) d FROM observations WHERE run_id=?",
    )
    .get(id);
  const findings = db
    .prepare("SELECT COUNT(*) c FROM findings WHERE run_id=?")
    .get(id).c;
  const oracleEvals = db
    .prepare("SELECT COUNT(*) c FROM oracle_evaluations WHERE run_id=?")
    .get(id).c;
  const totalActions = byStatus.reduce((s, r) => s + r.c, 0);
  const meaningful = byKind
    .filter((k) =>
      [
        "click",
        "fill",
        "press",
        "type",
        "key",
        "invoke",
        "setvalue",
        "swipe",
        "tap",
      ].includes(String(k.kind).toLowerCase()),
    )
    .reduce((s, k) => s + k.c, 0);
  out.push({
    runId: id,
    status: run.status,
    adapter: run.adapter_kind ?? run.adapter,
    startedAt: run.started_at,
    closedAt: run.closed_at,
    actionTotal: totalActions,
    actionByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    actionKinds: Object.fromEntries(byKind.map((r) => [r.kind, r.c])),
    meaningfulInteractions: meaningful,
    meaningfulRatio: totalActions
      ? Number((meaningful / totalActions).toFixed(3))
      : 0,
    observationsTotal: obs.c,
    distinctObservations: obs.d,
    findingRows: findings,
    oracleEvaluations: oracleEvals,
    workspaceBytes: artifacts.bytes,
    artifactFiles: artifacts.files,
    runsDbBytes: dbStat.size,
  });
}
console.log(JSON.stringify({ label, workspace: ws, runs: out }, null, 1));
