import { openWorkspace } from "./workspace.js";
import type { CommandContext } from "./hunt.js";
import { warnRepoRootWorkspace, workDirOf } from "./hunt.js";
import { CliError, intFlag } from "./args.js";
import type { ParsedInvocation } from "./args.js";

const MODELS_SCHEMA = "inspector-cli/models/1";

/**
 * Bounded inspection surface for the durable model-call control plane
 * (M13 F24). Detailed call history stays in durable state/query APIs; this
 * prints an aggregate summary plus the most recent attempts.
 */
export async function modelsCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const sub = parsed.positionals[0] ?? "summary";
  if (sub !== "summary") {
    throw new CliError("invalid-value", `unknown models subcommand '${sub}' (expected 'summary')`);
  }
  const limit = intFlag(parsed.flags, "--limit", 20);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let workspace;
  try {
    workspace = openWorkspace(dir);
  } catch (err) {
    throw remap(err);
  }
  const { store } = workspace;
  try {
    const summary = store.summarizeModelCalls();
    const recent = store.listModelCalls({}, limit).map((r) => ({
      id: r.id,
      requestId: r.requestId,
      attemptNumber: r.attemptNumber,
      status: r.status,
      role: r.role,
      requestClass: r.requestClass,
      providerId: r.providerId,
      errorClassification: r.errorClassification,
      runId: r.attribution.runId ?? null,
      campaignId: r.attribution.campaignId ?? null,
      itemId: r.attribution.itemId ?? null,
      workerId: r.attribution.workerId ?? null,
      totalChargedTokens: r.totalChargedTokens ?? r.outputTokens ?? null,
      costUsd: r.costUsd ?? null,
      latencyMs: r.latencyMs ?? null,
      startedAt: r.startedAt,
    }));
    const payload = {
      schema: MODELS_SCHEMA,
      ok: true,
      ...(warning !== null ? { warning } : {}),
      summary,
      recent,
    };
    if (ctx.json) ctx.out(JSON.stringify(payload, null, 2));
    else renderHuman(ctx, summary, recent);
    return { code: 0, data: payload };
  } finally {
    store.close();
  }
}

function renderHuman(
  ctx: CommandContext,
  summary: import("@inspector/store-sqlite").ModelCallsSummary,
  recent: Array<Record<string, unknown>>,
): void {
  ctx.out("model calls:");
  for (const [key, value] of Object.entries(summary)) {
    ctx.out(`  ${key}: ${String(value)}`);
  }
  if (recent.length === 0) {
    ctx.out("recent: none");
    return;
  }
  ctx.out(`recent (${recent.length}):`);
  for (const row of recent) {
    ctx.out(
      `  ${String(row.startedAt)} ${String(row.status)}/${String(row.errorClassification ?? "-")} ${String(row.role)} via ${String(row.providerId ?? "-")} tokens=${String(row.totalChargedTokens ?? "?")} cost=${String(row.costUsd ?? "?")}`,
    );
  }
}

function remap(err: unknown): Error {
  // Workspace conflicts reuse the shared classification.
  return err instanceof Error ? err : new Error(String(err));
}
