import { isId } from "@inspector/protocol";
import type { Budget, WorkItem } from "./types.js";
import type { AdapterFamily, WorkItemFailureClass } from "./executor.js";

/** Versioned campaign work-item assignment schema (M12 F2). */
export const CAMPAIGN_WORKITEM_SCHEMA = "inspector-campaign-workitem/1";

export const WORKFLOW_KINDS = ["hunt", "explore", "verify", "regress", "repair"] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

export const ADAPTER_FAMILIES = ["fake", "web", "cli", "windows", "android", "electron"] as const;

/** Capability tags workers can declare and items can require (M12 F4). */
export const KNOWN_CAPABILITIES = [
  "browser",
  "pty",
  "uia",
  "adb",
  "electron",
  "display",
] as const;

export interface ItemBudgets extends Budget {
  maxResets?: number;
  maxWallMs?: number;
}

export interface ManifestIssue {
  /** Dotted path inside the manifest document, e.g. items[3].seed. */
  path: string;
  /** Stable machine-readable error code. */
  code: string;
  message: string;
}

/**
 * Deterministic configuration error: raised before any work starts when a
 * manifest or work item is invalid or unsupported. Never partially applied.
 */
export class CampaignConfigError extends Error {
  readonly issues: ManifestIssue[];

  constructor(issues: ManifestIssue[]) {
    super(
      `invalid campaign configuration (${issues.length} issue(s)): ` +
        issues.map((i) => `${i.path} [${i.code}]: ${i.message}`).join("; "),
    );
    this.name = "CampaignConfigError";
    this.issues = issues;
  }
}

function issue(path: string, code: string, message: string): ManifestIssue {
  return { path, code, message };
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function adapterFamilyOf(item: Pick<WorkItem, "adapterFamily" | "target">): AdapterFamily {
  const raw = item.adapterFamily ?? item.target;
  if ((ADAPTER_FAMILIES as readonly string[]).includes(raw)) return raw as AdapterFamily;
  return "fake";
}

function validateBudget(path: string, raw: unknown, issues: ManifestIssue[]): ItemBudgets | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    issues.push(issue(path, "budget-invalid", "budgets must be a mapping of non-negative limits"));
    return undefined;
  }
  const out: ItemBudgets = {};
  const intFields: Array<[string, keyof ItemBudgets]> = [
    ["maxActions", "maxActions"],
    ["maxTokens", "maxTokens"],
    ["maxModelRequests", "maxModelRequests"],
    ["maxResets", "maxResets"],
    ["maxWallMs", "maxWallMs"],
  ];
  for (const [key, field] of intFields) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!isInt(v) || v <= 0) issues.push(issue(`${path}.${key}`, "budget-invalid", `${key} must be a positive integer`));
    else out[field] = v;
  }
  // Items express wall budgets in minutes for operator ergonomics.
  const minutes = raw.maxMinutes;
  if (minutes !== undefined) {
    if (!isInt(minutes) || minutes <= 0) issues.push(issue(`${path}.maxMinutes`, "budget-invalid", "maxMinutes must be a positive integer"));
    else out.maxWallMs = minutes * 60_000;
  }
  const cost = raw.maxCostUsd;
  if (cost !== undefined) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      issues.push(issue(`${path}.maxCostUsd`, "budget-invalid", "maxCostUsd must be a non-negative finite number"));
    } else {
      out.maxCostUsd = cost;
    }
  }
  const known = new Set([...intFields.map(([k]) => k), "maxMinutes", "maxCostUsd"]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      issues.push(issue(`${path}.${key}`, "budget-unknown-field", `unknown budget field '${key}'`));
    }
  }
  return out;
}

/**
 * Validate one raw manifest item (or legacy CLI quick-path item) into the
 * normalized durable {@link WorkItem}. All issues are collected; nothing
 * throws except through the caller aggregating into CampaignConfigError.
 */
export function validateWorkItem(raw: unknown, path: string, index: number, issues: ManifestIssue[]): WorkItem | undefined {
  if (!isRecord(raw)) {
    issues.push(issue(path, "item-invalid", "each item must be a mapping"));
    return undefined;
  }
  let valid = true;
  const fail = (code: string, message: string): void => {
    issues.push(issue(path, code, message));
    valid = false;
  };

  const id = raw.id;
  if (typeof id !== "string" || !isId(id)) {
    fail("id-invalid", `item id must match the Inspector id grammar, got ${JSON.stringify(id ?? null)}`);
  }

  // Workflow: explicit `workflow` (M12) or legacy `mode`.
  const workflowRaw = raw.workflow ?? raw.mode ?? "hunt";
  const legacyWorkflows = [...WORKFLOW_KINDS, "regression"] as const;
  if (typeof workflowRaw !== "string" || !(legacyWorkflows as readonly string[]).includes(workflowRaw)) {
    fail("workflow-unsupported", `workflow must be one of ${WORKFLOW_KINDS.join("|")}, got '${String(workflowRaw)}'`);
  }
  const workflow = (workflowRaw === "regression" ? "regress" : workflowRaw) as WorkflowKind;

  // Adapter family: explicit or derived from legacy target.
  const familyRaw = raw.adapterFamily ?? raw.target ?? "fake";
  if (typeof familyRaw !== "string" || !(ADAPTER_FAMILIES as readonly string[]).includes(familyRaw)) {
    fail("family-unsupported", `adapterFamily must be one of ${ADAPTER_FAMILIES.join("|")}, got '${String(familyRaw)}'`);
  }
  const adapterFamily = familyRaw as AdapterFamily;
  const legacyTarget = typeof raw.target === "string" ? raw.target : adapterFamily;

  const seedRaw = raw.seed ?? 7 + index * 11;
  if (!isInt(seedRaw) || seedRaw < 0) fail("seed-invalid", "seed must be a non-negative integer");
  const stepsRaw = raw.steps ?? 4;
  if (!isInt(stepsRaw) || stepsRaw < 1 || stepsRaw > 10_000) {
    fail("steps-invalid", "steps must be an integer between 1 and 10000");
  }
  const priorityRaw = raw.priority ?? index + 1;
  if (!isInt(priorityRaw) || priorityRaw < 0) fail("priority-invalid", "priority must be a non-negative integer");

  const targetUriRaw = raw.targetUri;
  if (targetUriRaw !== undefined && targetUriRaw !== null && (typeof targetUriRaw !== "string" || targetUriRaw.length === 0)) {
    fail("target-uri-invalid", "targetUri must be a non-empty string when present");
  }
  const revisionRaw = raw.revision;
  if (revisionRaw !== undefined && revisionRaw !== null && typeof revisionRaw !== "string") {
    fail("revision-invalid", "revision must be a string or null");
  }
  const configRaw = raw.targetConfig;
  if (configRaw !== undefined && !isRecord(configRaw)) {
    fail("target-config-invalid", "targetConfig must be a mapping");
  }

  const requiresRaw = raw.requiresCapabilities ?? [];
  if (!Array.isArray(requiresRaw)) {
    fail("capabilities-invalid", "requiresCapabilities must be a list of capability tags");
  } else {
    for (const cap of requiresRaw) {
      if (typeof cap !== "string" || !(KNOWN_CAPABILITIES as readonly string[]).includes(cap)) {
        issues.push(issue(`${path}.requiresCapabilities`, "capability-unknown", `unknown capability tag '${String(cap)}'; known: ${KNOWN_CAPABILITIES.join(", ")}`));
        valid = false;
      }
    }
  }

  const exclusiveRaw = raw.exclusive ?? false;
  if (typeof exclusiveRaw !== "boolean") fail("exclusive-invalid", "exclusive must be a boolean");

  // Graduated autonomy: repair NEVER runs without explicit per-item opt-in.
  const repairAuthorized = raw.repairAuthorized === true;
  if (workflow === "repair" && !repairAuthorized) {
    fail("repair-not-authorized", "repair items require explicit repairAuthorized: true (discovery never implies repair)");
  }
  if (raw.repairAuthorized !== undefined && typeof raw.repairAuthorized !== "boolean") {
    fail("repair-auth-invalid", "repairAuthorized must be a boolean");
  }

  const budgets = validateBudget(`${path}.budgets`, raw.budgets, issues);

  if (!valid) return undefined;
  return {
    id: id as string,
    priority: priorityRaw as number,
    mode: workflow === "regress" && raw.workflow === undefined && raw.mode === "regression" ? "regression" : workflow,
    target: legacyTarget,
    seed: seedRaw as number,
    steps: stepsRaw as number,
    ...(raw.adapterFamily !== undefined ? { adapterFamily } : {}),
    ...(typeof targetUriRaw === "string" ? { targetUri: targetUriRaw } : {}),
    ...(isRecord(configRaw) ? { targetConfig: configRaw } : {}),
    ...(revisionRaw !== undefined ? { revision: revisionRaw as string | null } : {}),
    ...(budgets ? { budgets } : {}),
    ...(Array.isArray(requiresRaw) && requiresRaw.length > 0 ? { requiresCapabilities: requiresRaw as string[] } : {}),
    ...(exclusiveRaw ? { exclusive: true } : {}),
    ...(repairAuthorized ? { repairAuthorized: true } : {}),
  };
}

/** Normalized manifest document ready to become a campaign configuration. */
export interface CampaignManifestConfig {
  schema: typeof CAMPAIGN_WORKITEM_SCHEMA | "inspector-campaign-manifest/1";
  id?: string;
  workerCount: number;
  leaseBackend: "json" | "sqlite";
  leaseTtlMs: number;
  maxWallMs: number;
  globalBudget: Budget | null;
  workerBudget: Budget | null;
  keepItemWorkspaces: boolean;
  items: WorkItem[];
}

const DEFAULT_MANIFEST = {
  workerCount: 2,
  leaseBackend: "sqlite" as const,
  leaseTtlMs: 60_000,
  maxWallMs: 10 * 60_000,
};

/**
 * Validate a full manifest document object. Collects every issue and raises
 * {@link CampaignConfigError} when anything is invalid — validation happens
 * before any directory, state, or work creation.
 */
export function validateCampaignManifest(doc: unknown): CampaignManifestConfig {
  const issues: ManifestIssue[] = [];
  if (!isRecord(doc)) throw new CampaignConfigError([issue("$", "manifest-invalid", "manifest must be a mapping")]);
  if (doc.schema !== "inspector-campaign-manifest/1") {
    throw new CampaignConfigError([
      issue("schema", "schema-unsupported", `expected 'inspector-campaign-manifest/1', got '${String(doc.schema)}'`),
    ]);
  }

  const workerCountRaw = doc.workers ?? DEFAULT_MANIFEST.workerCount;
  if (!isInt(workerCountRaw) || workerCountRaw < 1 || workerCountRaw > 32) {
    issues.push(issue("workers", "workers-invalid", "workers must be an integer between 1 and 32"));
  }
  const backendRaw = doc.leases && isRecord(doc.leases) ? (doc.leases.backend ?? DEFAULT_MANIFEST.leaseBackend) : DEFAULT_MANIFEST.leaseBackend;
  if (backendRaw !== "json" && backendRaw !== "sqlite") {
    issues.push(issue("leases.backend", "lease-backend-invalid", "lease backend must be 'json' or 'sqlite'"));
  }
  const ttlRaw = doc.leases && isRecord(doc.leases) ? (doc.leases.ttlMs ?? DEFAULT_MANIFEST.leaseTtlMs) : DEFAULT_MANIFEST.leaseTtlMs;
  if (!isInt(ttlRaw) || ttlRaw < 50) {
    issues.push(issue("leases.ttlMs", "lease-ttl-invalid", "leases.ttlMs must be an integer >= 50"));
  }
  const wallRaw = doc.maxMinutes ?? DEFAULT_MANIFEST.maxWallMs / 60_000;
  if (!isInt(wallRaw) || wallRaw < 1) {
    issues.push(issue("maxMinutes", "wall-invalid", "maxMinutes must be a positive integer"));
  }
  const globalBudget = validateBudget("budgets.global", doc.budgets && isRecord(doc.budgets) ? doc.budgets.global : undefined, issues);
  const workerBudget = validateBudget("budgets.perWorker", doc.budgets && isRecord(doc.budgets) ? doc.budgets.perWorker : undefined, issues);
  const keepRaw = doc.keepWorkspaces ?? false;
  if (typeof keepRaw !== "boolean") issues.push(issue("keepWorkspaces", "keep-invalid", "keepWorkspaces must be a boolean"));

  const itemsRaw = doc.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    issues.push(issue("items", "items-empty", "items must be a non-empty list of assignments"));
  }
  const items: WorkItem[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(itemsRaw)) {
    itemsRaw.forEach((raw, index) => {
      const item = validateWorkItem(raw, `items[${index}]`, index, issues);
      if (item) {
        if (seenIds.has(item.id)) {
          issues.push(issue(`items[${index}].id`, "id-duplicate", `duplicate item id '${item.id}'`));
        } else {
          seenIds.add(item.id);
          items.push(item);
        }
      }
    });
  }

  const idRaw = doc.id;
  if (idRaw !== undefined && (typeof idRaw !== "string" || !isId(idRaw))) {
    issues.push(issue("id", "id-invalid", "campaign id must match the Inspector id grammar"));
  }

  if (issues.length > 0) throw new CampaignConfigError(issues);
  return {
    schema: "inspector-campaign-manifest/1",
    ...(typeof idRaw === "string" ? { id: idRaw } : {}),
    workerCount: (workerCountRaw as number),
    leaseBackend: backendRaw as "json" | "sqlite",
    leaseTtlMs: ttlRaw as number,
    maxWallMs: (wallRaw as number) * 60_000,
    globalBudget: globalBudget ?? null,
    workerBudget: workerBudget ?? null,
    keepItemWorkspaces: keepRaw === true,
    items,
  };
}

export { issue as manifestIssue };
export type { WorkItemFailureClass };
