import { EXPLORER_VERSION } from "@inspector/explore";
import { isId } from "@inspector/protocol";
import { WorkflowError } from "./errors.js";
import { adapterSpawn } from "./workspace.js";
import type { HuntRequest } from "./types.js";

interface DurableHuntMeta {
  schema: "inspector-hunt/1";
  version: 1;
  workflow: "hunt" | "explore";
  request: Omit<HuntRequest, "resumeRunId">;
  explorerKind: "web" | "native" | "fake";
  explorerVersion: string;
}

/** Extra provenance recorded on campaign-driven runs (M12 F3). */
export interface CampaignProvenance {
  campaignId: string;
  itemId: string;
  workerId: string;
}

function buildDurableHuntMeta(
  req: HuntRequest,
  workflow: "hunt" | "explore",
  campaign?: CampaignProvenance,
): DurableHuntMeta & { campaign?: CampaignProvenance } {
  const { resumeRunId: _resumeRunId, ...request } = req;
  return {
    schema: "inspector-hunt/1",
    version: 1,
    workflow,
    request,
    explorerKind: req.adapter === "web" ? "web" : req.adapter === "fake" ? "fake" : "native",
    explorerVersion: EXPLORER_VERSION,
    ...(campaign ? { campaign: { ...campaign } } : {}),
  };
}

function storedAdapterSpawn(adapter: string | null): ReturnType<typeof adapterSpawn> | null {
  if (adapter === "adapter-fake") return adapterSpawn("fake");
  if (adapter === "web-playwright") return adapterSpawn("web");
  if (adapter === "cli-pty") return adapterSpawn("cli");
  if (adapter === "windows-uia") return adapterSpawn("windows");
  if (adapter === "android-uiautomator") return adapterSpawn("android");
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseDurableHuntMeta(raw: string | null, runId: string): DurableHuntMeta & { campaign?: CampaignProvenance } {
  if (!raw) throw new WorkflowError("not-resumable", `run ${runId} has no durable autonomous hunt configuration`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorkflowError("not-resumable", `run ${runId} has malformed autonomous hunt configuration; refusing to guess`);
  }
  if (!isRecord(value) || value.schema !== "inspector-hunt/1" || value.version !== 1 || !isRecord(value.request) || value.explorerVersion !== EXPLORER_VERSION) {
    throw new WorkflowError("not-resumable", `run ${runId} has an incompatible autonomous hunt configuration; refusing to guess`);
  }
  const workflow = value.workflow === undefined ? "hunt" : value.workflow;
  if (workflow !== "hunt" && workflow !== "explore") {
    throw new WorkflowError("not-resumable", `run ${runId} has an invalid autonomous workflow; refusing to guess`);
  }
  const request = value.request;
  const adapters = new Set(["web", "fake", "cli", "windows", "android"]);
  if (
    typeof request.adapter !== "string" ||
    !adapters.has(request.adapter) ||
    !Number.isSafeInteger(request.seed) ||
    !Number.isSafeInteger(request.maxActions) ||
    !Number.isSafeInteger(request.maxMinutes) ||
    !Number.isSafeInteger(request.maxFindings) ||
    (request.seed as number) < 0 || (request.maxActions as number) < 0 || (request.maxMinutes as number) < 0 || (request.maxFindings as number) < 0 ||
    (request.targetUrl !== undefined && typeof request.targetUrl !== "string") ||
    (request.target !== undefined && typeof request.target !== "string")
  ) {
    throw new WorkflowError("not-resumable", `run ${runId} has an invalid autonomous hunt configuration; refusing to guess`);
  }
  if (typeof request.targetUrl === "string") {
    try {
      validateTargetUrlShape(request.targetUrl);
    } catch {
      throw new WorkflowError("not-resumable", `run ${runId} has an invalid persisted target URL; refusing to resume`);
    }
  }
  const explorerKind = value.explorerKind;
  const expectedKind = request.adapter === "web" ? "web" : request.adapter === "fake" ? "fake" : "native";
  if (explorerKind !== expectedKind) {
    throw new WorkflowError("incompatible-run", `run ${runId} records explorer '${String(explorerKind)}' for adapter '${request.adapter}'`);
  }
  const campaign =
    value.campaign !== undefined && isRecord(value.campaign)
      ? normalizeCampaignProvenance(value.campaign)
      : undefined;
  if (value.campaign !== undefined && campaign === undefined) {
    throw new WorkflowError("not-resumable", `run ${runId} has an invalid campaign provenance record; refusing to guess`);
  }
  return {
    schema: "inspector-hunt/1",
    version: 1,
    workflow,
    request: request as DurableHuntMeta["request"],
    explorerKind: explorerKind as DurableHuntMeta["explorerKind"],
    explorerVersion: value.explorerVersion,
    ...(campaign ? { campaign } : {}),
  };
}

function normalizeCampaignProvenance(raw: Record<string, unknown>): CampaignProvenance | undefined {
  const campaignId = raw.campaignId;
  const itemId = raw.itemId;
  const workerId = raw.workerId;
  if (
    typeof campaignId !== "string" || !isId(campaignId) ||
    typeof itemId !== "string" || !isId(itemId) ||
    typeof workerId !== "string" || workerId.length === 0
  ) {
    return undefined;
  }
  return { campaignId, itemId, workerId };
}

/** Merge resume-time overrides; refuse incompatible ones deterministically. */
export function mergeResumeRequest(
  flags: Record<string, string | true | undefined>,
  requested: HuntRequest,
  meta: DurableHuntMeta,
): HuntRequest {
  const original = meta.request as HuntRequest;
  const checks: Array<[string, keyof HuntRequest]> = [
    ["--adapter", "adapter"],
    ["--url", "targetUrl"],
    ["--target", "target"],
    ["--seed", "seed"],
    ["--max-actions", "maxActions"],
    ["--max-minutes", "maxMinutes"],
    ["--max-findings", "maxFindings"],
  ];
  for (const [flag, key] of checks) {
    if (flags[flag] === undefined) continue;
    const requestedValue = requested[key];
    const originalValue = original[key];
    if (requestedValue !== originalValue) {
      throw new WorkflowError(
        "incompatible-override",
        `${flag}=${String(requestedValue)} does not match the original run value ${String(originalValue)}; resume refuses incompatible overrides`,
      );
    }
  }
  return { ...original, resumeRunId: requested.resumeRunId };
}

/**
 * Mirror the adapters' policy: http(s) on localhost/127.0.0.1 only.
 * Kept shape-compatible with the historical CLI helper so messages match.
 */
export function validateTargetUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new WorkflowError("invalid-value", `--url is not a valid URL: '${raw}'`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new WorkflowError("invalid-value", `--url must be http or https, got '${u.protocol}'`);
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new WorkflowError(
      "invalid-value",
      `--url must be a localhost origin for RC1 hunts, got hostname '${u.hostname}'`,
    );
  }
  return u.toString();
}

function validateTargetUrlShape(raw: string): void {
  validateTargetUrl(raw);
}

export type { DurableHuntMeta };
export { buildDurableHuntMeta, storedAdapterSpawn };
