import { WorkflowError, runExploration, validateTargetUrl } from "@inspector/workflows";
import type { ModelAssistanceConfig } from "@inspector/workflows";
import { loadModelProviderModule, ProviderModuleError } from "@inspector/model-runtime";
import type { ParsedInvocation } from "./args.js";
import { CliError, intFlag } from "./args.js";
import { isRepoRoot, REPO_ROOT_WARNING } from "./workspace.js";

/** Compatibility re-export for library consumers of the CLI package. */
export { closeRunGuarded, writeEvidenceBundles } from "@inspector/workflows";

// Public workspace/spawn helpers re-exported for library consumers live in
// cli/workspace.ts (kept as a thin compatibility layer over @inspector/workflows).

/** Parse and validate hunt flags into a HuntRequest. */
export function parseHuntRequest(parsed: ParsedInvocation): import("@inspector/workflows").HuntRequest {
  const adapterRaw = parsed.flags["--adapter"];
  const adapter = adapterRaw === undefined ? "web" : adapterRaw;
  if (
    adapter !== "web" &&
    adapter !== "fake" &&
    adapter !== "cli" &&
    adapter !== "windows" &&
    adapter !== "android" &&
    adapter !== "electron"
  ) {
    throw new CliError(
      "invalid-value",
      `--adapter expects 'web' | 'fake' | 'cli' | 'windows' | 'android' | 'electron', got '${adapter}'`,
    );
  }
  const urlRaw = parsed.flags["--url"];
  if (urlRaw !== undefined && adapter !== "web") {
    throw new CliError("invalid-value", "--url is only valid with --adapter web");
  }
  const targetRaw = parsed.flags["--target"];
  if (targetRaw !== undefined && (adapter === "web" || adapter === "electron")) {
    throw new CliError(
      "invalid-value",
      adapter === "web"
        ? "--target is not valid with --adapter web (use --url)"
        : "--target is not valid with --adapter electron (only the bundled seeded fixture is supported)",
    );
  }
  const resumeRaw = parsed.flags["--resume"];
  if (resumeRaw !== undefined && typeof resumeRaw !== "string") {
    throw new CliError("invalid-value", "--resume requires a run id");
  }
  if (resumeRaw !== undefined && parsed.positionals.length > 0) {
    throw new CliError("invalid-value", "hunt --resume takes the run id as the --resume value, not a positional argument");
  }
  return {
    adapter,
    targetUrl:
      urlRaw === undefined || typeof urlRaw !== "string"
        ? undefined
        : validateTargetUrl(urlRaw),
    target: typeof targetRaw === "string" ? targetRaw : undefined,
    seed: intFlag(parsed.flags, "--seed", 7),
    maxActions: intFlag(parsed.flags, "--max-actions", 200),
    maxMinutes: intFlag(parsed.flags, "--max-minutes", 10),
    maxFindings: intFlag(parsed.flags, "--max-findings", 4),
    ...(typeof resumeRaw === "string" ? { resumeRunId: resumeRaw } : {}),
  };
}

/**
 * M13 F13: parse optional model-assistance flags. Provider configuration is
 * ALWAYS explicit; no flag here ever requires a provider for the rest of the
 * command. Provider module paths are trusted operator configuration loaded
 * through the shared validated loader; load errors are redacted.
 */
export async function parseModelAssistance(parsed: ParsedInvocation): Promise<ModelAssistanceConfig | undefined> {
  const providerPath = parsed.flags["--model-provider"];
  if (providerPath === undefined) {
    for (const flag of ["--planner", "--semantic-oracle", "--summarize", "--model-max-requests", "--model-max-tokens", "--model-max-cost", "--model-timeout-ms", "--model-max-calls"]) {
      if (parsed.flags[flag] !== undefined) {
        throw new CliError("provider-required", `${flag} requires --model-provider <module path>`);
      }
    }
    return undefined;
  }
  if (typeof providerPath !== "string" || providerPath.length === 0) {
    throw new CliError("invalid-value", "--model-provider requires a module path");
  }
  let providers;
  try {
    providers = await loadModelProviderModule(providerPath, {
      redact: (text) => text.replace(/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})/g, "***"),
    });
  } catch (err) {
    if (err instanceof ProviderModuleError) {
      throw new CliError(err.classification, err.message);
    }
    throw err;
  }
  const wantsPlanner = parsed.flags["--planner"] === true || parsed.flags["--semantic-oracle"] === true || parsed.flags["--summarize"] === true;
  if (!wantsPlanner && parsed.flags["--model-max-requests"] === undefined && parsed.flags["--model-timeout-ms"] === undefined) {
    // Loading a provider alone is valid: it enables capability reporting.
  }
  const roles = new Set(providers.flatMap((p) => p.meta.roles));
  const requireRole = (flag: string, role: "planner" | "oracle" | "summarizer") => {
    if (parsed.flags[flag] === true && !roles.has(role)) {
      throw new CliError("invalid-provider", `provider does not declare the '${role}' role required by ${flag}`);
    }
  };
  requireRole("--planner", "planner");
  requireRole("--semantic-oracle", "oracle");
  requireRole("--summarize", "summarizer");
  return {
    providers,
    planner: parsed.flags["--planner"] === true,
    semanticOracle: parsed.flags["--semantic-oracle"] === true,
    summarize: parsed.flags["--summarize"] === true,
    ...(parsed.flags["--model-max-requests"] !== undefined
      ? { budgets: { maxRequests: intFlag(parsed.flags, "--model-max-requests", 1000), ...(parsed.flags["--model-max-tokens"] !== undefined ? { maxTokens: intFlag(parsed.flags, "--model-max-tokens", 10_000_000) } : {}) } }
      : {}),
    ...(parsed.flags["--model-timeout-ms"] !== undefined ? { timeoutMs: intFlag(parsed.flags, "--model-timeout-ms", 8000) } : {}),
    ...(parsed.flags["--model-max-calls"] !== undefined ? { maxCallsPerRun: intFlag(parsed.flags, "--model-max-calls", 24) } : {}),
  };
}

export interface CommandContext {
  /** The process working directory (fallback workspace root). */
  baseCwd: string;
  /** --workspace value observed before the command token, if any. */
  workspaceArg?: string;
  json: boolean;
  /** Write a line to stdout (final summaries). */
  out: (line: string) => void;
  /** Write a progress line to stderr (suppressed under --json). */
  progress: (line: string) => void;
}

/**
 * Resolve the workspace directory: the command's own --workspace flag wins,
 * then a pre-command --workspace, then INSPECTOR_WORKSPACE, then the working
 * directory. --workspace is THE isolation mechanism: `pnpm run` re-cwd's to
 * the package directory before executing, so an absent --workspace cannot be
 * assumed to resolve to the operator's shell cwd.
 */
export function workDirOf(ctx: CommandContext, parsed: ParsedInvocation): string {
  return parsed.workspace ?? ctx.workspaceArg ?? process.env.INSPECTOR_WORKSPACE ?? ctx.baseCwd;
}

/**
 * Warn on stderr (suppressed under --json) when the resolved workspace is the
 * Inspector repository root; returns the message so JSON payloads can carry a
 * `warning` field instead.
 */
export function warnRepoRootWorkspace(ctx: CommandContext, dir: string): string | null {
  if (!isRepoRoot(dir)) return null;
  if (!ctx.json) ctx.progress(REPO_ROOT_WARNING);
  return REPO_ROOT_WARNING;
}

export async function huntCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  return runExplorationCommand(parsed, ctx, "hunt");
}

/**
 * Explicit operator exploration workflow. It shares the proven hunt engine,
 * but records a distinct workflow and emits coverage/novelty-oriented output.
 * Exploration never grants patching permission and accepts no repair flag.
 */
export async function exploreCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  return runExplorationCommand(parsed, ctx, "explore");
}

async function runExplorationCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
  workflow: "hunt" | "explore",
): Promise<{ code: number; data?: unknown }> {
  const req = parseHuntRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let model;
  try {
    model = await parseModelAssistance(parsed);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw err;
  }
  if (model !== undefined && req.adapter !== "web") {
    ctx.progress(
      `note: model assistance applies to the web explorer (--adapter web); '${req.adapter}' exploration stays deterministic`,
    );
  }

  let outcome;
  try {
    outcome = await runExploration({
      workspaceDir: dir,
      workflow,
      request: req,
      progress: ctx.progress,
      resumeFlags: parsed.flags,
      warning,
      ...(model !== undefined ? { model } : {}),
    });
  } catch (err) {
    if (err instanceof WorkflowError) throw new CliError(err.kind, err.message);
    throw err;
  }

  const { code, result, bundlePaths, badStop, errorOutcomes } = outcome;
  const warningField = outcome.warning ?? null;

  const huntSummary = {
    schema: "inspector-cli/hunt/1" as const,
    command: "hunt" as const,
    ok: code === 0,
    ...(warningField !== null ? { warning: warningField } : {}),
    runId: result.runId,
    adapter: req.adapter,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: result.resets,
    anomalies: result.anomalyCount,
    findings: result.findings.map((f) => ({
      id: f.id,
      signature: f.signature ?? null,
      status: f.status,
      severity: f.severity,
      confidence: f.confidence,
    })),
    bundles: bundlePaths,
    warnings: result.warnings,
    ...(result.model !== undefined ? { model: result.model } : {}),
  };
  const summary = workflow === "explore"
    ? {
        schema: "inspector-cli/explore/1" as const,
        ok: huntSummary.ok,
        command: "explore" as const,
        warning: warningField,
        runId: result.runId,
        adapter: req.adapter,
        seed: result.seed,
        resumed: outcome.resumed,
        stoppedReason: result.stoppedReason,
        campaign: {
          durable: true,
          checkpointed: true,
          resumeSupported: true,
          runId: result.runId,
        },
        coverage: {
          actionsExecuted: result.actionsExecuted,
          statesVisited: result.statesVisited,
          resets: result.resets,
          noveltyStates: result.statesVisited,
          anomalies: result.anomalyCount,
        },
        discovery: {
          findingsObserved: result.findings.length,
          confirmedFindings: result.findings.filter((f) => f.status === "CONFIRMED").length,
          lifecycle: "observations-feed-finding-pipeline",
        },
        patching: {
          enabled: false,
          reason: "explore is discovery-only; repair requires a separate explicit command",
        },
        findings: huntSummary.findings,
        bundles: huntSummary.bundles,
        warnings: result.warnings,
        ...(result.model !== undefined ? { model: result.model } : {}),
      }
    : huntSummary;

  if (ctx.json) {
    ctx.out(JSON.stringify(summary, null, 2));
  } else {
    renderExplorationHuman(ctx, workflow, req.adapter, result, bundlePaths, badStop, errorOutcomes, code);
  }
  return { code, data: summary };
}

function renderExplorationHuman(
  ctx: CommandContext,
  workflow: "hunt" | "explore",
  adapter: string,
  result: import("@inspector/workflows").HuntRunResult,
  bundlePaths: Array<{ findingId: string; path: string }>,
  badStop: boolean,
  errorOutcomes: number,
  code: number,
): void {
  const pathByFinding = new Map(bundlePaths.map((b) => [b.findingId, b.path] as const));
  ctx.out(`${workflow} complete: ${result.runId}`);
  ctx.out(
    `  stopped: ${result.stoppedReason} | actions: ${result.actionsExecuted} | ` +
      `states: ${result.statesVisited} | resets: ${result.resets} | anomalies: ${result.anomalyCount}`,
  );
  if (result.findings.length === 0) {
    ctx.out("  findings: none");
  } else {
    ctx.out(`  findings: ${result.findings.length}`);
    for (const f of result.findings) {
      ctx.out(
        `    ${f.id}  ${f.signature ?? "-"}  ${f.status}  ${f.severity}  ${f.confidence.toFixed(2)}`,
      );
      const p = pathByFinding.get(f.id);
      if (p) ctx.out(`      evidence: ${p}`);
    }
  }
  if (result.warnings.length > 0) {
    ctx.out(`  warnings: ${result.warnings.length}`);
    for (const w of result.warnings) ctx.out(`    - ${w}`);
  }
  if (workflow === "explore") {
    ctx.out("  patching: disabled (use inspector repair with a confirmed finding)");
  }
  if (adapter === "fake") {
    // Fake hunts print nothing extra today.
  }
  if (code !== 0) {
    ctx.out(
      badStop
        ? `hunt failed: exploration stopped with '${result.stoppedReason}'`
        : `hunt finished with ${errorOutcomes} error-level finding outcome(s)`,
    );
  }
}
