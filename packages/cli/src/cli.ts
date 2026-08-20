import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { RunManager } from "@inspector/core";
import type { Action } from "@inspector/protocol";

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, "..", "..", "adapter-fake", "src", "bin.ts");

export interface Workspace {
  store: Store;
  artifacts: ArtifactStore;
  base: string;
}

export function workspaceDirFrom(cwd: string): string {
  return join(cwd, ".inspector");
}

export function openWorkspace(cwd: string): Workspace {
  const base = workspaceDirFrom(cwd);
  const store = Store.open(join(base, "runs.db"));
  const artifacts = new ArtifactStore(join(base, "artifacts"));
  return { store, artifacts, base };
}

export function fakeAdapterSpawn(): { adapterCommand: string; adapterArgs: string[]; adapterEnv: NodeJS.ProcessEnv } {
  return {
    adapterCommand: process.execPath,
    adapterArgs: ["--import", "tsx", fakeBin],
    adapterEnv: { ...process.env },
  };
}

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 5000, idempotency: "safe-retry", input };
}

export interface CliResult {
  code: number;
  data?: unknown;
}

export async function runCli(argv: string[], cwd: string = process.cwd()): Promise<CliResult> {
  const args = argv.slice();
  const json = args.includes("--json");
  const wsIdx = args.indexOf("--workspace");
  const workspaceArg = wsIdx >= 0 ? args[wsIdx + 1] : undefined;
  const workDir = workspaceArg ?? cwd;
  const out = (data: unknown) => {
    if (json) {
      process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    } else {
      process.stdout.write(String(data) + "\n");
    }
  };

  const command = args[0];
  if (!command) {
    out(usage());
    return { code: 1 };
  }

  switch (command) {
    case "doctor":
      return doctor(json, out);
    case "run":
      return runDemo(args, json, out, workDir);
    case "runs":
      return runsCommand(args, json, out, workDir);
    default:
      out(`unknown command: ${command}`);
      out(usage());
      return { code: 1 };
  }
}

function usage(): string {
  return [
    "inspector - autonomous environment inspector",
    "",
    "Usage:",
    "  inspector doctor                 Run environment/health checks",
    "  inspector run --adapter fake     Run a fake demonstration scenario",
    "  inspector runs list              List recorded runs",
    "  inspector runs show <id>         Show a run's steps and outcomes",
    "  Add --json for machine-readable output.",
  ].join("\n");
}

async function doctor(json: boolean, out: (d: unknown) => void): Promise<CliResult> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
  checks.push({ name: "node >= 22", ok: nodeOk, detail: `node ${process.versions.node}` });

  const fakeExists = existsSync(fakeBin);
  checks.push({ name: "fake adapter present", ok: fakeExists, detail: fakeBin });

  let storeOk = false;
  let storeDetail = "";
  try {
    const ws = openWorkspace(process.cwd());
    ws.store.listRuns(1);
    ws.store.close();
    storeOk = true;
    storeDetail = ws.base;
  } catch (e) {
    storeDetail = e instanceof Error ? e.message : String(e);
  }
  checks.push({ name: "sqlite store opens", ok: storeOk, detail: storeDetail });

  const failed = checks.filter((c) => !c.ok);
  if (json) {
    out({ ok: failed.length === 0, checks });
  } else {
    for (const c of checks) {
      out(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
    }
    out(failed.length === 0 ? "doctor: OK" : `doctor: ${failed.length} check(s) failed`);
  }
  return { code: failed.length === 0 ? 0 : 1 };
}

async function runDemo(args: string[], json: boolean, out: (d: unknown) => void, cwd: string): Promise<CliResult> {
  const adapterArg = args[args.indexOf("--adapter") + 1];
  if (adapterArg !== "fake") {
    out("only --adapter fake is supported in M0");
    return { code: 1 };
  }
  const { store, artifacts } = openWorkspace(cwd);
  try {
    const mgr = new RunManager(store, artifacts);
    const run = await mgr.startRun(fakeAdapterSpawn());
    const steps: unknown[] = [];

    const seq = [
      act("d1", "openForm"),
      act("d2", "fillField", { name: "default", value: "ok" }),
      act("d3", "submit"),
    ];
    for (const a of seq) {
      const r = await run.submitAction(a);
      steps.push({ id: a.id, ...((r as { outcome?: unknown }).outcome ? { outcome: (r as { outcome: unknown }).outcome } : { result: r.kind }) });
    }
    const obs = await run.observe(["state"]);

    // Demonstrate the deterministic failure oracle (reset first so we start clean).
    await run.reset();
    await run.submitAction(act("d4", "openForm"));
    await run.submitAction(act("d5", "fillField", { name: "default", value: "BAD" }));
    const fail = await run.submitAction(act("d6", "submit"));

    const summary = {
      runId: run.runId,
      steps: steps.length + 2,
      finalState: (obs.summary as { state?: string }).state,
      deterministicFailure: (fail as { outcome?: { status: string } }).outcome?.status ?? "none",
    };
    out(json ? summary : `run ${summary.runId} complete; finalState=${summary.finalState}; deterministicFailure=${summary.deterministicFailure}`);
    await run.close();
    return { code: 0, data: summary };
  } finally {
    store.close();
  }
}

async function runsCommand(args: string[], json: boolean, out: (d: unknown) => void, cwd: string): Promise<CliResult> {
  const sub = args[1];
  const { store } = openWorkspace(cwd);
  try {
    if (sub === "list" || !sub) {
      const runs = store.listRuns(100).map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, adapter: r.adapter }));
      out(json ? runs : runs.map((r) => `${r.id}  ${r.status}  ${r.adapter ?? ""}  ${r.createdAt}`).join("\n"));
      return { code: 0, data: runs };
    }
    if (sub === "show") {
      const id = args[2];
      if (!id) {
        out("usage: inspector runs show <id>");
        return { code: 1 };
      }
      const run = store.getRun(id);
      if (!run) {
        out(`run not found: ${id}`);
        return { code: 1 };
      }
      const steps = store.getRunSteps(id).map((s) => ({
        sequence: s.step.sequence,
        action: s.action ? { id: s.action.id, kind: s.action.kind, status: s.action.status } : null,
        observations: s.observations.length,
      }));
      const detail = { run: { id: run.id, status: run.status }, steps };
      out(json ? detail : `run ${id}\n` + steps.map((s) => `  #${s.sequence} ${s.action?.kind ?? "(observe)"} -> ${s.action?.status ?? "ok"} (${s.observations} obs)`).join("\n"));
      return { code: 0, data: detail };
    }
    out(`unknown runs subcommand: ${sub}`);
    return { code: 1 };
  } finally {
    store.close();
  }
}
