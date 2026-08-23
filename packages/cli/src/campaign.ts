import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { newId, isId } from "@inspector/protocol";
import {
  UnattendedCampaign,
  type Budget,
  type CampaignReport,
  type WorkItem,
} from "@inspector/scale";
import { CliError, intFlag, type ParsedInvocation } from "./args.js";
import { warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";

const CAMPAIGN_SCHEMA = "inspector-cli/campaign/1";
const CAMPAIGN_LIST_SCHEMA = "inspector-cli/campaign-list/1";
const CAMPAIGN_SHOW_SCHEMA = "inspector-cli/campaign-show/1";
const MAX_WORKERS = 32;
const MAX_STEPS = 10_000;

type CampaignStatus = "configured" | "running" | "stopped" | "complete" | "failed";

interface CampaignManifest {
  schema: "inspector-campaign/1";
  id: string;
  createdAt: string;
  updatedAt: string;
  stateDir: string;
  artifactsDir: string;
  workerCount: number;
  items: WorkItem[];
  usagePerStep: { modelRequests: number; tokens: number; costUsd: number; actions: number };
  globalBudget: Budget | null;
  workerBudget: Budget | null;
  leaseTtlMs: number;
  leaseBackend: "json" | "sqlite";
  maxWallMs: number;
  status: CampaignStatus;
  lastReport?: CampaignReport;
  lastError?: string;
}

interface CampaignRequest {
  operation: "run" | "list" | "show" | "stop" | "resume";
  id?: string;
  workerCount: number;
  items?: WorkItem[];
  usagePerStep: CampaignManifest["usagePerStep"];
  globalBudget: Budget | null;
  workerBudget: Budget | null;
  leaseTtlMs: number;
  leaseBackend: "json" | "sqlite";
  maxWallMs: number;
  limit: number;
  provided: Set<string>;
}

interface CampaignSnapshot {
  id: string;
  status: CampaignStatus;
  workerCount: number;
  assignments: Array<{ id: string; target: string; mode: WorkItem["mode"]; seed: number; steps: number }>;
  queue: number;
  inFlight: number;
  completed: string[];
  failed: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  usage: ReturnType<UnattendedCampaign["ledgerRef"]["totals"]>;
  findings: CampaignReport["findings"];
  clusters: number;
  staleCompletions: number;
  restartsInjected: number;
  leaseBackend: CampaignManifest["leaseBackend"];
  lastError?: string;
}

export function parseCampaignRequest(parsed: ParsedInvocation): CampaignRequest {
  const operation = parsed.positionals[0];
  if (operation !== "run" && operation !== "list" && operation !== "show" && operation !== "stop" && operation !== "resume") {
    throw new CliError("missing-argument", "campaign requires run, list, show, stop, or resume");
  }
  const id = parsed.positionals[1];
  if (operation === "list" && parsed.positionals.length > 1) {
    throw new CliError("unexpected-argument", "campaign list does not take a campaign id");
  }
  if (operation !== "run" && operation !== "list" && (!id || parsed.positionals.length > 2)) {
    throw new CliError("missing-argument", `campaign ${operation} requires one campaign id`);
  }
  if (operation === "run" && parsed.positionals.length > 1) {
    throw new CliError("unexpected-argument", "campaign run uses --id <campaignId>");
  }
  if (id !== undefined && !isId(id)) throw new CliError("invalid-value", `invalid campaign id '${id}'`);

  const workerCount = intFlag(parsed.flags, "--workers", 2);
  if (workerCount < 1 || workerCount > MAX_WORKERS) {
    throw new CliError("invalid-value", `--workers must be between 1 and ${MAX_WORKERS}`);
  }
  const steps = intFlag(parsed.flags, "--steps", 4);
  if (steps < 1 || steps > MAX_STEPS) throw new CliError("invalid-value", `--steps must be between 1 and ${MAX_STEPS}`);
  const seed = intFlag(parsed.flags, "--seed", 7);
  const modeRaw = stringFlag(parsed.flags, "--mode", "hunt");
  if (modeRaw !== "hunt" && modeRaw !== "regression" && modeRaw !== "repair") {
    throw new CliError("invalid-value", "--mode must be hunt, regression, or repair");
  }
  const itemsRaw = parsed.flags["--items"];
  const items = typeof itemsRaw === "string" ? parseItems(itemsRaw, seed, steps, modeRaw) : undefined;
  const backendRaw = stringFlag(parsed.flags, "--lease-backend", "sqlite");
  if (backendRaw !== "json" && backendRaw !== "sqlite") {
    throw new CliError("invalid-value", "--lease-backend must be json or sqlite");
  }
  const maxMinutes = intFlag(parsed.flags, "--max-minutes", 10);
  if (maxMinutes < 1) throw new CliError("invalid-value", "--max-minutes must be at least 1");
  const leaseTtlMs = intFlag(parsed.flags, "--lease-ttl-ms", 60_000);
  if (leaseTtlMs < 50) throw new CliError("invalid-value", "--lease-ttl-ms must be at least 50");

  const usagePerStep = {
    modelRequests: intFlag(parsed.flags, "--model-requests-per-step", 1),
    tokens: intFlag(parsed.flags, "--tokens-per-step", 10),
    costUsd: numberFlag(parsed.flags, "--cost-per-step", 0.001),
    actions: intFlag(parsed.flags, "--actions-per-step", 1),
  };
  if (usagePerStep.actions < 1) throw new CliError("invalid-value", "--actions-per-step must be at least 1");
  const globalBudget = budgetFromFlags(parsed.flags, "--max-actions", "--max-tokens", "--max-cost-usd");
  const maxWorkerActions = intFlag(parsed.flags, "--max-worker-actions", 0);
  const workerBudget = maxWorkerActions > 0 ? { maxActions: maxWorkerActions } : null;
  const requestedId = stringFlag(parsed.flags, "--id", "");
  if (requestedId && !isId(requestedId)) throw new CliError("invalid-value", `invalid campaign id '${requestedId}'`);
  if (operation === "run" && id !== undefined) throw new CliError("unexpected-argument", "campaign run uses --id <campaignId>");
  return {
    operation,
    ...(id !== undefined ? { id } : {}),
    ...(requestedId ? { id: requestedId } : {}),
    workerCount,
    items,
    usagePerStep,
    globalBudget,
    workerBudget,
    leaseTtlMs,
    leaseBackend: backendRaw,
    maxWallMs: maxMinutes * 60_000,
    limit: intFlag(parsed.flags, "--limit", 100),
    provided: new Set(Object.keys(parsed.flags)),
  };
}

export async function campaignCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const req = parseCampaignRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  const root = join(dir, ".inspector", "campaigns");
  mkdirSync(root, { recursive: true });

  if (req.operation === "list") {
    const manifests = listManifests(root).slice(0, req.limit);
    const campaigns = manifests.map((manifest) => inspectManifest(manifest));
    const output = { schema: CAMPAIGN_LIST_SCHEMA, ok: true, command: "campaign", operation: "list", campaigns, warnings: warning ? [warning] : [] };
    emit(ctx, output, `campaign list: ${campaigns.length} campaign(s)`);
    return { code: 0, data: output };
  }

  const id = (req.id ?? stringFlag(parsed.flags, "--id", "")) || (req.operation === "run" ? `campaign-${newId()}` : "");
  if (!id) throw new CliError("missing-argument", `campaign ${req.operation} requires a campaign id`);
  if (!isId(id)) throw new CliError("invalid-value", `invalid campaign id '${id}'`);
  const manifestPath = join(root, id, "manifest.json");
  let manifest = existsSync(manifestPath) ? readManifest(manifestPath) : undefined;

  if (req.operation === "run" && !manifest) {
    if (!req.items || req.items.length === 0) {
      throw new CliError("missing-value", "campaign run requires --items id=target,id=target; target must be fake in the current CLI executor");
    }
    manifest = createManifest(root, id, req);
    writeManifest(manifestPath, manifest);
  } else if (!manifest) {
    throw new CliError("not-found", `campaign not found: ${id}`);
  } else if (req.operation === "run") {
    validateOverrides(manifest, req);
  }

  if (!manifest) throw new CliError("internal", `campaign manifest unavailable: ${id}`);
  if (req.operation === "show") {
    const snapshot = inspectManifest(manifest);
    const output = { schema: CAMPAIGN_SHOW_SCHEMA, ok: true, command: "campaign", operation: "show", campaign: snapshot, warnings: warning ? [warning] : [] };
    emit(ctx, output, `campaign ${id}: ${snapshot.status}`);
    return { code: 0, data: output };
  }

  const campaign = createCampaign(manifest);
  try {
    if (req.operation === "stop") {
      campaign.stop();
      manifest = updateManifest(manifest, { status: "stopped", lastError: undefined });
      writeManifest(manifestPath, manifest);
      const output = campaignOutput("stop", manifest, campaign, warning);
      emit(ctx, output, `campaign ${id}: stopped`);
      return { code: 0, data: output };
    }
    if (req.operation === "resume") campaign.resume();
    manifest = updateManifest(manifest, { status: "running", lastError: undefined });
    writeManifest(manifestPath, manifest);
    let report: CampaignReport;
    try {
      report = await runBounded(campaign, manifest.maxWallMs);
    } catch (err) {
      manifest = updateManifest(manifest, { status: "failed", lastError: errorMessage(err) });
      writeManifest(manifestPath, manifest);
      throw new CliError("campaign-failed", `campaign ${id} failed: ${errorMessage(err)}`);
    }
    const status = deriveStatus(manifest, campaign);
    manifest = updateManifest(manifest, { status, lastReport: report });
    writeManifest(manifestPath, manifest);
    const output = campaignOutput(req.operation, manifest, campaign, warning);
    emit(ctx, output, `campaign ${id}: ${status}`);
    return { code: report.failed.length > 0 ? 2 : 0, data: output };
  } finally {
    campaign.close();
  }
}

function createCampaign(manifest: CampaignManifest): UnattendedCampaign {
  const workerBudget = manifest.workerBudget;
  const workerBudgets = workerBudget
    ? Object.fromEntries(Array.from({ length: manifest.workerCount }, (_, i) => [`worker-${i}`, workerBudget]))
    : undefined;
  return new UnattendedCampaign(
    {
      stateDir: manifest.stateDir,
      workerCount: manifest.workerCount,
      items: manifest.items,
      usagePerStep: manifest.usagePerStep,
      ...(manifest.globalBudget ? { globalBudget: manifest.globalBudget } : {}),
      ...(workerBudgets ? { workerBudgets } : {}),
      leaseTtlMs: manifest.leaseTtlMs,
      leaseBackend: manifest.leaseBackend,
    },
    manifest.artifactsDir,
  );
}

async function runBounded(campaign: UnattendedCampaign, maxWallMs: number): Promise<CampaignReport> {
  const run = campaign.run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<CampaignReport>((resolve, reject) => {
        timer = setTimeout(() => {
          campaign.stop();
          void run.then(resolve, reject);
        }, maxWallMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function campaignOutput(
  operation: CampaignRequest["operation"],
  manifest: CampaignManifest,
  campaign: UnattendedCampaign,
  warning: string | null,
): Record<string, unknown> {
  return {
    schema: CAMPAIGN_SCHEMA,
    ok: manifest.status === "complete" || manifest.status === "stopped" || manifest.status === "configured",
    command: "campaign",
    operation,
    campaign: inspectManifest(manifest, campaign),
    warnings: warning ? [warning] : [],
  };
}

function inspectManifest(manifest: CampaignManifest, existing?: UnattendedCampaign): CampaignSnapshot {
  const campaign = existing ?? createCampaign(manifest);
  try {
    const raw = readJson<Partial<{ queue: string[]; executions: Array<{ itemId: string; workerId: string }>; failed: string[]; restarts: number; staleCompletions: number }>>(join(manifest.stateDir, "campaign.json"), {});
    const report = manifest.lastReport;
    const stopped = campaign.ledgerRef.isStopped;
    const status: CampaignStatus = stopped
      ? "stopped"
      : raw.queue?.length === 0 && (raw.failed?.length ?? 0) === 0 && report
        ? "complete"
        : raw.queue?.length === 0 && (raw.failed?.length ?? 0) > 0
          ? "failed"
          : manifest.status === "configured" && !report
            ? "configured"
            : manifest.status === "running"
              ? "running"
              : manifest.status;
    return {
      id: manifest.id,
      status,
      workerCount: manifest.workerCount,
      assignments: manifest.items.map(({ id, target, mode, seed, steps }) => ({ id, target, mode, seed, steps })),
      queue: raw.queue?.length ?? 0,
      inFlight: campaign.leasesRef.inFlight().length,
      completed: report?.completed ?? (raw.executions ?? []).map((execution) => execution.itemId),
      failed: report?.failed ?? raw.failed ?? [],
      executions: report?.executions ?? raw.executions ?? [],
      usage: campaign.ledgerRef.totals(),
      findings: report?.findings ?? [],
      clusters: report?.clusters ?? 0,
      staleCompletions: report?.staleCompletions ?? raw.staleCompletions ?? 0,
      restartsInjected: report?.restartsInjected ?? raw.restarts ?? 0,
      leaseBackend: manifest.leaseBackend,
      ...(manifest.lastError ? { lastError: manifest.lastError } : {}),
    };
  } finally {
    if (!existing) campaign.close();
  }
}

function createManifest(root: string, id: string, req: CampaignRequest): CampaignManifest {
  const campaignRoot = join(root, id);
  const stateDir = join(campaignRoot, "state");
  const artifactsDir = join(campaignRoot, "artifacts");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  const now = new Date().toISOString();
  return {
    schema: "inspector-campaign/1",
    id,
    createdAt: now,
    updatedAt: now,
    stateDir,
    artifactsDir,
    workerCount: req.workerCount,
    items: req.items ?? [],
    usagePerStep: req.usagePerStep,
    globalBudget: req.globalBudget,
    workerBudget: req.workerBudget,
    leaseTtlMs: req.leaseTtlMs,
    leaseBackend: req.leaseBackend,
    maxWallMs: req.maxWallMs,
    status: "configured",
  };
}

function updateManifest(manifest: CampaignManifest, update: Partial<CampaignManifest>): CampaignManifest {
  const next = { ...manifest, ...update, updatedAt: new Date().toISOString() };
  if (next.lastError === undefined) delete next.lastError;
  return next;
}

function validateOverrides(manifest: CampaignManifest, req: CampaignRequest): void {
  const checks: Array<[string, unknown, unknown]> = [
    ["--workers", req.workerCount, manifest.workerCount],
    ["--lease-ttl-ms", req.leaseTtlMs, manifest.leaseTtlMs],
    ["--lease-backend", req.leaseBackend, manifest.leaseBackend],
    ["--max-minutes", req.maxWallMs, manifest.maxWallMs],
  ];
  for (const [flag, requested, stored] of checks) {
    if (req.provided.has(flag) && requested !== stored) {
      throw new CliError("incompatible-override", `${flag} does not match the durable campaign configuration`);
    }
  }
  const budgetFields: Array<[string, keyof Budget]> = [
    ["--max-actions", "maxActions"],
    ["--max-tokens", "maxTokens"],
    ["--max-cost-usd", "maxCostUsd"],
  ];
  for (const [flag, field] of budgetFields) {
    if (req.provided.has(flag) && (req.globalBudget?.[field] ?? null) !== (manifest.globalBudget?.[field] ?? null)) {
      throw new CliError("incompatible-override", `${flag} does not match the durable campaign budget`);
    }
  }
  if (req.provided.has("--max-worker-actions") && (req.workerBudget?.maxActions ?? null) !== (manifest.workerBudget?.maxActions ?? null)) {
    throw new CliError("incompatible-override", "--max-worker-actions does not match the durable campaign budget");
  }
  const usageFields: Array<[string, keyof CampaignManifest["usagePerStep"]]> = [
    ["--model-requests-per-step", "modelRequests"],
    ["--tokens-per-step", "tokens"],
    ["--cost-per-step", "costUsd"],
    ["--actions-per-step", "actions"],
  ];
  for (const [flag, field] of usageFields) {
    if (req.provided.has(flag) && req.usagePerStep[field] !== manifest.usagePerStep[field]) {
      throw new CliError("incompatible-override", `${flag} does not match the durable campaign configuration`);
    }
  }
  if ((req.provided.has("--steps") || req.provided.has("--seed") || req.provided.has("--mode")) && req.items === undefined) {
    throw new CliError("incompatible-override", "item configuration flags require the original --items assignment list");
  }
  if (req.items !== undefined && JSON.stringify(req.items) !== JSON.stringify(manifest.items)) {
    throw new CliError("incompatible-override", "--items does not match the durable campaign assignments");
  }
}

function listManifests(root: string): CampaignManifest[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isId(entry.name))
    .map((entry) => {
      const path = join(root, entry.name, "manifest.json");
      return existsSync(path) ? readManifest(path) : undefined;
    })
    .filter((manifest): manifest is CampaignManifest => manifest !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readManifest(path: string): CampaignManifest {
  const manifest = readJson<CampaignManifest | undefined>(path, undefined);
  if (!manifest || manifest.schema !== "inspector-campaign/1" || !isId(manifest.id)) {
    throw new CliError("invalid-state", `invalid campaign manifest: ${path}`);
  }
  return manifest;
}

function writeManifest(path: string, manifest: CampaignManifest): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temp = `${path}.tmp-${newId()}`;
  writeFileSync(temp, JSON.stringify(manifest, null, 2), "utf8");
  try {
    renameSync(temp, path);
  } catch (err) {
    try { unlinkSync(temp); } catch { /* preserve primary error */ }
    throw err;
  }
}

function parseItems(raw: string, seed: number, steps: number, mode: WorkItem["mode"]): WorkItem[] {
  const items = raw.split(",").map((entry, index) => {
    const [id, target] = entry.split("=", 2).map((part) => part?.trim());
    if (!id || !target || !isId(id)) throw new CliError("invalid-value", `--items expects id=target entries; got '${entry}'`);
    if (target !== "fake") throw new CliError("unsupported-target", `campaign target '${target}' is not available in the CLI executor; use target=fake`);
    return { id, priority: index, mode, target, seed: seed + index, steps };
  });
  if (items.length === 0 || new Set(items.map((item) => item.id)).size !== items.length) {
    throw new CliError("invalid-value", "--items must contain at least one unique assignment");
  }
  return items;
}

function budgetFromFlags(
  flags: Record<string, string | true>,
  actionFlag: string,
  tokenFlag: string,
  costFlag: string,
): Budget | null {
  const maxActions = intFlag(flags, actionFlag, 0);
  const maxTokens = intFlag(flags, tokenFlag, 0);
  const maxCostUsd = numberFlag(flags, costFlag, 0);
  return maxActions > 0 || maxTokens > 0 || maxCostUsd > 0
    ? {
        ...(maxActions > 0 ? { maxActions } : {}),
        ...(maxTokens > 0 ? { maxTokens } : {}),
        ...(maxCostUsd > 0 ? { maxCostUsd } : {}),
      }
    : null;
}

function stringFlag(flags: Record<string, string | true>, name: string, fallback: string): string {
  const value = flags[name];
  return typeof value === "string" ? value : fallback;
}

function numberFlag(flags: Record<string, string | true>, name: string, fallback: number): number {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new CliError("invalid-value", `${name} expects a non-negative number`);
  return value;
}

function deriveStatus(manifest: CampaignManifest, campaign: UnattendedCampaign): CampaignStatus {
  if (campaign.ledgerRef.isStopped) return "stopped";
  const state = readJson<{ queue?: string[]; failed?: string[] }>(join(manifest.stateDir, "campaign.json"), {});
  if ((state.queue?.length ?? 0) === 0) return (state.failed?.length ?? 0) > 0 ? "failed" : "complete";
  return "running";
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (err) { throw new CliError("invalid-state", `cannot read durable campaign state ${path}: ${errorMessage(err)}`); }
}

function emit(ctx: CommandContext, output: Record<string, unknown>, human: string): void {
  if (ctx.json) ctx.out(JSON.stringify(output, null, 2));
  else ctx.out(human);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
