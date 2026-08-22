import { RunManager, type RunController } from "@inspector/core";
import { intFlag, parseArgs, requirePositional, CliError } from "./args.js";
import { closeRunGuarded, warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";
import { adapterSpawn, openWorkspace, remapWorkspaceConflict, type AdapterSpawnSpec } from "./workspace.js";

/**
 * Map a stored adapter identity (self-reported at initialize) back to a spawn
 * spec. Exact matches only: when the kind is not recoverable the caller must
 * say so rather than guess.
 */
export function spawnForStoredAdapter(adapter: string | null): AdapterSpawnSpec | null {
  if (adapter === "adapter-fake") return adapterSpawn("fake");
  if (adapter === "web-playwright") return adapterSpawn("web");
  if (adapter === "cli-pty") return adapterSpawn("cli");
  if (adapter === "windows-uia") return adapterSpawn("windows");
  if (adapter === "android-uiautomator") return adapterSpawn("android");
  return null;
}

export async function runsCommand(
  parentRest: string[],
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const sub = parentRest[0];
  if (sub === undefined || sub === "list") {
    const rest = sub === undefined ? parentRest : parentRest.slice(1);
    const parsed = parseArgs(rest, ["--limit"], []);
    const limit = intFlag(parsed.flags, "--limit", 100);
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store } = openWorkspace(dir);
    try {
      const runs = store
        .listRuns(limit)
        .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, adapter: r.adapter }));
      if (ctx.json) {
        ctx.out(JSON.stringify(runs, null, 2));
      } else if (runs.length === 0) {
        ctx.out("no runs recorded");
      } else {
        for (const r of runs) {
          ctx.out(`${r.id}  ${r.status}  ${r.adapter ?? ""}  ${r.createdAt}`);
        }
      }
      return { code: 0, data: runs };
    } finally {
      store.close();
    }
  }

  if (sub === "show") {
    const parsed = parseArgs(parentRest.slice(1), [], []);
    const id = requirePositional(parsed.positionals, 0, "inspector runs show <id>");
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store } = openWorkspace(dir);
    try {
      const run = store.getRun(id);
      if (!run) {
        ctx.out(`run not found: ${id}`);
        return { code: 1 };
      }
      const steps = store.getRunSteps(id).map((s) => ({
        sequence: s.step.sequence,
        action: s.action ? { id: s.action.id, kind: s.action.kind, status: s.action.status } : null,
        observations: s.observations.length,
      }));
      const detail = { run: { id: run.id, status: run.status }, steps };
      if (ctx.json) {
        ctx.out(JSON.stringify(detail, null, 2));
      } else {
        ctx.out(`run ${id} (${run.status})`);
        if (steps.length === 0) {
          ctx.out("  no steps recorded");
        } else {
          for (const s of steps) {
            ctx.out(
              `  #${s.sequence} ${s.action?.kind ?? "(observe)"} -> ${s.action?.status ?? "ok"} (${s.observations} obs)`,
            );
          }
        }
      }
      return { code: 0, data: detail };
    } finally {
      store.close();
    }
  }

  if (sub === "resume") {
    return resumeRunCommand(parentRest.slice(1), ctx);
  }

  throw new CliError("unknown-command", `unknown-command: runs ${sub} (try 'inspector help runs')`);
}

/** Re-attach a fresh adapter process to a recorded run and re-observe. */
async function resumeRunCommand(
  rest: string[],
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const parsed = parseArgs(rest, [], []);
  const id = requirePositional(parsed.positionals, 0, "inspector runs resume <id>");
  const dir = workDirOf(ctx, parsed);
  warnRepoRootWorkspace(ctx, dir);
  let store, artifacts;
  try {
    ({ store, artifacts } = openWorkspace(dir));
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  let controller: RunController | null = null;
  try {
    const record = store.getRun(id);
    if (!record) {
      ctx.out(`run not found: ${id}`);
      return { code: 1 };
    }
    // Resume re-attaches a fresh adapter to continue an interrupted run;
    // a run that already reached a terminal state has nothing to resume.
    if (record.status === "closed" || record.status === "failed" || record.status === "crashed") {
      ctx.out(`run ${id} already ${record.status}; there is nothing to resume`);
      return { code: 1 };
    }
    const spec = spawnForStoredAdapter(record.adapter);
    if (!spec) {
      ctx.out(
        `cannot determine the original adapter kind for run ${id} ` +
          `(recorded adapter: '${record.adapter ?? "unknown"}'); refusing to guess`,
      );
      return { code: 1 };
    }

    const mgr = new RunManager(store, artifacts);
    let observationSummary: unknown = null;
    let observeError: string | null = null;
    try {
      try {
        controller = await mgr.resumeRun(id, spec);
      } catch (e) {
        // A shared/locked db must surface as an actionable error, not an
        // observeError on an already-broken run.
        const mapped = remapWorkspaceConflict(e);
        throw mapped === e ? e : mapped;
      }
      // Re-observation proves the fresh environment actually answers; a
      // failure here is reported honestly instead of being dressed up.
      const obs = await controller.observe(["state"]);
      observationSummary = obs.summary;
    } catch (e) {
      observeError = e instanceof Error ? e.message : String(e);
    }

    const stepsRecorded = store.getRunSteps(id).length;
    const finalStatus = store.getRun(id)?.status ?? "unknown";
    const detail = {
      runId: id,
      adapter: record.adapter,
      reattached: controller !== null,
      observeError,
      observation: observationSummary,
      stepsRecorded,
      finalStatus,
    };

    if (ctx.json) {
      ctx.out(JSON.stringify(detail, null, 2));
    } else {
      ctx.out(`resumed ${id} on ${record.adapter}`);
      ctx.out("  re-attached a fresh adapter process; in-flight actions marked unknown");
      if (observeError !== null) {
        ctx.out(`  re-observation FAILED: ${observeError}`);
      } else {
        ctx.out(`  latest observation: ${JSON.stringify(observationSummary)}`);
      }
      ctx.out(`  steps recorded: ${stepsRecorded}`);
      ctx.out(`  final status: ${finalStatus}`);
    }
    return { code: observeError === null ? 0 : 1, data: detail };
  } finally {
    if (controller) await closeRunGuarded(controller, ctx.progress);
    store.close();
  }
}
