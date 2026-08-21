import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FindingRecord } from "@inspector/store-sqlite";
import { intFlag, parseArgs, requirePositional, CliError } from "./args.js";
import { workDirOf, warnRepoRootWorkspace, type CommandContext } from "./hunt.js";
import { openWorkspace } from "./workspace.js";

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Evidence bundles live at <base>/bundles/<runId>/<findingId>.json (hunt). */
export function bundlePathFor(base: string, rec: FindingRecord): string | null {
  if (!rec.runId) return null;
  return join(base, "bundles", rec.runId, `${rec.id}.json`);
}

/** Shared view model for list/show, human and JSON alike. */
export function findingView(rec: FindingRecord, base: string): Record<string, unknown> {
  const refs = safeParse(rec.artifactRefs);
  const artifactRefCount = Array.isArray(refs) ? refs.length : 0;
  const bundlePath = bundlePathFor(base, rec);
  return {
    id: rec.id,
    runId: rec.runId,
    status: rec.status,
    title: rec.title,
    signature: rec.signature,
    severity: rec.severity,
    confidence: rec.confidence,
    adapter: rec.adapter,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    artifactRefCount,
    evidenceBundlePath: bundlePath !== null && existsSync(bundlePath) ? bundlePath : null,
  };
}

function fmtConfidence(c: number): string {
  return Number.isFinite(c) ? c.toFixed(2) : String(c);
}

export async function findingsCommand(
  parentRest: string[],
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const sub = parentRest[0];
  if (sub === undefined || sub === "list") {
    const rest = sub === undefined ? parentRest : parentRest.slice(1);
    const parsed = parseArgs(rest, ["--run", "--limit"], []);
    const limit = intFlag(parsed.flags, "--limit", 100);
    const runFilter = typeof parsed.flags["--run"] === "string" ? parsed.flags["--run"] : undefined;
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store, base } = openWorkspace(dir);
    try {
      let records = store.listFindings(limit);
      if (runFilter !== undefined) records = records.filter((r) => r.runId === runFilter);
      const views = records.map((r) => findingView(r, base));
      if (ctx.json) {
        ctx.out(JSON.stringify(views, null, 2));
      } else if (views.length === 0) {
        ctx.out(runFilter === undefined ? "no findings recorded" : `no findings recorded for run ${runFilter}`);
      } else {
        for (const v of views) {
          ctx.out(
            `${v.id}  ${v.status}  ${v.severity ?? "-"}  conf=${fmtConfidence(v.confidence as number)}  ${v.signature ?? "-"}  ${v.updatedAt}`,
          );
        }
      }
      return { code: 0, data: views };
    } finally {
      store.close();
    }
  }

  if (sub === "show") {
    const parsed = parseArgs(parentRest.slice(1), [], []);
    const id = requirePositional(parsed.positionals, 0, "inspector findings show <id>");
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store, base } = openWorkspace(dir);
    try {
      const record = store.getFinding(id);
      if (!record) {
        ctx.out(`finding not found: ${id}`);
        return { code: 1 };
      }
      const detail: Record<string, unknown> = {
        ...findingView(record, base),
        oracleIds: safeParse(record.oracleIds),
        reproduction: safeParse(record.reproductionJson),
        minimization: safeParse(record.minimizationJson),
        lastTransition: safeParse(record.lastTransitionJson),
      };
      if (ctx.json) {
        ctx.out(JSON.stringify(detail, null, 2));
      } else {
        ctx.out(`finding ${record.id}`);
        ctx.out(`  run: ${record.runId ?? "-"}`);
        ctx.out(
          `  status: ${record.status}  severity: ${record.severity ?? "-"}  confidence: ${fmtConfidence(record.confidence)}`,
        );
        ctx.out(`  signature: ${record.signature ?? "-"}`);
        ctx.out(`  title: ${record.title}`);
        if (record.adapter) ctx.out(`  adapter: ${record.adapter}`);
        ctx.out(`  created: ${record.createdAt}  updated: ${record.updatedAt}`);
        ctx.out(`  artifact refs: ${detail.artifactRefCount}`);
        const repro = detail.reproduction as Record<string, unknown> | null;
        if (repro) {
          ctx.out(
            `  reproduction: attempts=${repro.attempts} successes=${repro.successes} errors=${repro.errors ?? 0}`,
          );
        }
        const mini = detail.minimization as Record<string, unknown> | null;
        if (mini) {
          ctx.out(
            `  minimization: probes=${mini.probes} removals=${mini.removals} verified=${String(mini.verifiedReproduction)}`,
          );
        }
        ctx.out(
          detail.evidenceBundlePath
            ? `  evidence bundle: ${detail.evidenceBundlePath}`
            : "  evidence bundle: not found on disk",
        );
      }
      return { code: 0, data: detail };
    } finally {
      store.close();
    }
  }

  throw new CliError("unknown-command", `unknown-command: findings ${sub} (try 'inspector help findings')`);
}
