import {
  existsSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { newId, type Action } from "@inspector/protocol";
import {
  FindingEngine,
  OracleEngine,
  type EvidenceBundle,
  type Finding,
  type OracleSignalKind,
  type ReplayDriver,
} from "@inspector/finding";
import { OracleSuite } from "@inspector/oracle";
import {
  RepairEngine,
  type PatchAgent,
  type RepairRecord,
  type RepairWorkspace,
} from "@inspector/repair";
import type { RepairWorkflowRecord } from "@inspector/store-sqlite";
import { redactFreeformText } from "@inspector/adapter-sdk";
import { CliError, intFlag, requirePositional, type ParsedInvocation } from "./args.js";
import { loadReplaySubject } from "./replay-workflow.js";
import { openWorkspace, remapWorkspaceConflict } from "./workspace.js";
import { warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";
import { writeJsonAtomic } from "./atomic.js";

const REPAIR_SCHEMA = "inspector-cli/repair/1";
const ORACLE_SIGNAL_KINDS = new Set<OracleSignalKind>([
  "TARGET_FAILURE",
  "PAGE_ERROR",
  "DEFECT_SUBMIT_INVALID",
  "IMPOSSIBLE_STATE",
  "ADAPTER_CRASH",
]);

export interface RepairProviderContext {
  finding: Finding;
  bundle: EvidenceBundle;
  repoRoot: string;
  revision: string;
}

/**
 * Explicit provider boundary for `inspector repair`.
 *
 * A provider supplies the existing RepairEngine contracts; it is never
 * synthesized by the CLI. Modules may export this object directly, a default
 * object, or `createRepairProvider(context)` returning the object.
 */
export interface CliRepairProvider {
  patchAgent: PatchAgent;
  driverFor: (workspace: RepairWorkspace) => Promise<ReplayDriver>;
  oracleSuite: OracleSuite;
  maskingProbe: Action[];
  expectOracle?: OracleSignalKind;
  hints?: {
    errorText?: string;
    selectors?: string[];
    preferredPaths?: string[];
  };
}

interface RepairRequest {
  findingId: string;
  repoRoot: string;
  revision: string;
  providerModule: string;
  maxAttempts: number;
  errorText?: string;
  selectors?: string[];
}

export function parseRepairRequest(parsed: ParsedInvocation): RepairRequest {
  const findingId = requirePositional(parsed.positionals, 0, "inspector repair <findingId>");
  if (parsed.positionals.length > 1) {
    throw new CliError("unexpected-argument", "repair accepts one finding id");
  }
  const repoRoot = requiredValue(parsed.flags, "--repo-root");
  const revision = requiredValue(parsed.flags, "--revision");
  const provider = parsed.flags["--provider"] ?? parsed.flags["--patch-agent"];
  if (parsed.flags["--provider"] !== undefined && parsed.flags["--patch-agent"] !== undefined) {
    throw new CliError("duplicate-flag", "use only one of --provider and --patch-agent");
  }
  if (provider === undefined || provider === true || provider.trim().length === 0) {
    throw new CliError(
      "provider-required",
      "repair requires --provider <module>; the module must implement the existing PatchAgent, replay-driver, oracle-suite, and masking-probe contracts",
    );
  }
  const maxAttempts = intFlag(parsed.flags, "--max-attempts", 2);
  if (maxAttempts < 1) {
    throw new CliError("invalid-value", "--max-attempts must be at least 1");
  }
  const errorText = optionalString(parsed.flags["--error-text"]);
  const selectorsRaw = optionalString(parsed.flags["--selectors"]);
  const selectors = selectorsRaw
    ? selectorsRaw.split(",").map((value) => value.trim()).filter((value) => value.length > 0)
    : undefined;
  return {
    findingId,
    repoRoot: resolve(repoRoot),
    revision,
    providerModule: resolve(provider),
    maxAttempts,
    ...(errorText !== undefined ? { errorText } : {}),
    ...(selectors !== undefined ? { selectors } : {}),
  };
}

export async function repairCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const req = parseRepairRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  if (!existsSync(req.repoRoot)) {
    throw new CliError("invalid-value", `--repo-root does not exist: ${req.repoRoot}`);
  }

  let workspace;
  try {
    workspace = openWorkspace(dir);
  } catch (err) {
    throw remapWorkspaceConflict(err);
  }
  const { store } = workspace;
  try {
    let subject;
    try {
      subject = loadReplaySubject(store, workspace.base, req.findingId);
    } catch (err) {
      if (err instanceof CliError) throw err;
      return emitRepairRefusal(
        ctx,
        warning,
        req,
        "invalid-provenance",
        errorMessage(err),
      );
    }
    if (subject.finding.status !== "CONFIRMED") {
      return emitRepairRefusal(
        ctx,
        warning,
        req,
        "policy-blocked",
        `finding status ${subject.finding.status} is not eligible; only CONFIRMED findings may be patched`,
        4,
      );
    }

    const resolvedRevision = resolveRevision(req.repoRoot, req.revision);
    if (
      subject.finding.revision !== null &&
      subject.finding.revision !== req.revision &&
      subject.finding.revision !== resolvedRevision
    ) {
      return emitRepairRefusal(
        ctx,
        warning,
        req,
        "invalid-provenance",
        `finding revision '${subject.finding.revision}' does not match requested base '${resolvedRevision}'`,
        4,
        { resolvedRevision },
      );
    }

    const provider = await loadProvider(req.providerModule, {
      finding: subject.finding,
      bundle: subject.bundle,
      repoRoot: req.repoRoot,
      revision: resolvedRevision,
    });
    const expectOracle = provider.expectOracle ?? signalKind(subject.finding.signature);
    if (!expectOracle) {
      throw new CliError(
        "invalid-provider",
        `finding ${subject.finding.id} has no supported oracle signature; provider must export expectOracle`,
      );
    }

    const repairId = newId();
    const startedAt = new Date().toISOString();
    const evidenceDir = join(workspace.base, "repairs", repairId);
    mkdirSync(evidenceDir, { recursive: true });
    let durable: RepairWorkflowRecord = {
      id: repairId,
      findingId: subject.finding.id,
      repoRoot: req.repoRoot,
      revision: resolvedRevision,
      status: "running",
      outcome: "RUNNING",
      attempts: 0,
      startedAt,
      completedAt: null,
      resultJson: null,
      artifactPath: null,
    };
    store.putRepairWorkflowRecord(durable);

    let record: RepairRecord;
    try {
      const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
      const engine = new RepairEngine(findingEngine, {
        repoRoot: req.repoRoot,
        revision: resolvedRevision,
        evidenceDir,
        maxAttempts: req.maxAttempts,
        driverFor: provider.driverFor,
        oracleSuite: provider.oracleSuite,
        maskingProbe: provider.maskingProbe,
        onAttempt: (attempt, attemptCount) => {
          durable = {
            ...durable,
            attempts: attemptCount,
            resultJson: JSON.stringify({
              phase: "attempt",
              latestAttempt: attempt,
              attempts: attemptCount,
            }),
          };
          store.putRepairWorkflowRecord(durable);
        },
      });
      record = await engine.repair(
        subject.finding,
        subject.bundle.minimizedSteps,
        provider.patchAgent,
        {
          expectOracle,
          ...(provider.hints?.errorText ?? req.errorText
            ? { errorText: req.errorText ?? provider.hints?.errorText }
            : {}),
          ...(req.selectors ?? provider.hints?.selectors
            ? { selectors: req.selectors ?? provider.hints?.selectors }
            : {}),
        },
      );
    } catch (err) {
      const detail = redact(errorMessage(err));
      durable = {
        ...durable,
        status: "failed",
        outcome: "ERROR",
        completedAt: new Date().toISOString(),
        resultJson: JSON.stringify({ error: detail }),
      };
      store.putRepairWorkflowRecord(durable);
      throw err;
    }

    const auditPath = join(evidenceDir, "audit.json");
    const audit = {
      schema: REPAIR_SCHEMA,
      command: "repair",
      repairId,
      findingId: subject.finding.id,
      repoRoot: req.repoRoot,
      requestedRevision: req.revision,
      resolvedRevision,
      provider: provider.patchAgent.id,
      outcome: record.outcome,
      attempts: record.attempts.length,
      automaticallyApplied: false,
      primaryCheckoutModified: false,
      record,
      warning,
    };
    writeJsonAtomic(auditPath, audit);
    durable = {
      ...durable,
      status: "completed",
      outcome: record.outcome,
      completedAt: new Date().toISOString(),
      resultJson: JSON.stringify(audit),
      artifactPath: auditPath,
    };
    store.putRepairWorkflowRecord(durable);
    const output = {
      schema: REPAIR_SCHEMA,
      ok: record.outcome === "RESOLVED",
      command: "repair",
      result: {
        repairId,
        findingId: subject.finding.id,
        outcome: record.outcome,
        provider: provider.patchAgent.id,
        requestedRevision: req.revision,
        resolvedRevision,
        repoRoot: req.repoRoot,
        auditPath,
        automaticallyApplied: false,
        primaryCheckoutModified: false,
        attempts: record.attempts.length,
      },
      warnings: warning ? [warning] : [],
    };
    if (ctx.json) ctx.out(JSON.stringify(output, null, 2));
    else renderRepair(output.result, ctx);
    return { code: repairExitCode(record.outcome), data: output };
  } finally {
    store.close();
  }
}

async function loadProvider(
  modulePath: string,
  context: RepairProviderContext,
): Promise<CliRepairProvider> {
  let loaded: Record<string, unknown>;
  try {
    if (modulePath.endsWith(".cjs")) {
      loaded = createRequire(import.meta.url)(modulePath) as Record<string, unknown>;
    } else {
      loaded = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as Record<string, unknown>;
    }
  } catch (err) {
    throw new CliError("provider-load-failed", `could not load repair provider ${modulePath}: ${redact(errorMessage(err))}`);
  }
  let candidate: unknown = loaded.createRepairProvider ?? loaded.default ?? loaded.provider;
  if (typeof candidate === "function") {
    try {
      candidate = await (candidate as (ctx: RepairProviderContext) => unknown)(context);
    } catch (err) {
      throw new CliError("provider-failed", `repair provider factory failed: ${redact(errorMessage(err))}`);
    }
  }
  if (!isRecord(candidate)) {
    throw new CliError("invalid-provider", "repair provider must export an object or createRepairProvider(context)");
  }
  const patchAgent = candidate.patchAgent;
  const driverFor = candidate.driverFor ?? candidate.createReplayDriver;
  const oracleSuite = candidate.oracleSuite;
  const maskingProbe = candidate.maskingProbe;
  if (!isPatchAgent(patchAgent)) {
    throw new CliError("invalid-provider", "repair provider patchAgent does not implement PatchAgent");
  }
  if (typeof driverFor !== "function") {
    throw new CliError("invalid-provider", "repair provider must export driverFor(workspace)");
  }
  if (!isOracleSuite(oracleSuite)) {
    throw new CliError("invalid-provider", "repair provider must export an OracleSuite instance");
  }
  if (!Array.isArray(maskingProbe) || maskingProbe.length === 0) {
    throw new CliError("invalid-provider", "repair provider must export a non-empty maskingProbe action path");
  }
  const expectOracle = candidate.expectOracle;
  if (expectOracle !== undefined && !isSignalKind(expectOracle)) {
    throw new CliError("invalid-provider", `unsupported expectOracle '${String(expectOracle)}'`);
  }
  return {
    patchAgent,
    driverFor: driverFor as (workspace: RepairWorkspace) => Promise<ReplayDriver>,
    oracleSuite,
    maskingProbe: maskingProbe as Action[],
    ...(expectOracle !== undefined ? { expectOracle } : {}),
    ...(isRecord(candidate.hints) ? { hints: candidate.hints as CliRepairProvider["hints"] } : {}),
  };
}

function emitRepairRefusal(
  ctx: CommandContext,
  warning: string | null,
  req: RepairRequest,
  classification: "invalid-provenance" | "policy-blocked",
  detail: string,
  code = 4,
  extra: Record<string, unknown> = {},
): { code: number; data: unknown } {
  const output = {
    schema: REPAIR_SCHEMA,
    ok: false,
    command: "repair",
    result: {
      findingId: req.findingId,
      classification,
      detail: redact(detail),
      repoRoot: req.repoRoot,
      requestedRevision: req.revision,
      automaticallyApplied: false,
      primaryCheckoutModified: false,
      ...extra,
    },
    warnings: warning ? [warning] : [],
  };
  if (ctx.json) ctx.out(JSON.stringify(output, null, 2));
  else ctx.out(`repair ${req.findingId}: ${classification}\n  detail: ${redact(detail)}`);
  return { code, data: output };
}

function resolveRevision(repoRoot: string, revision: string): string {
  try {
    const resolved = execFileSync(
      "git",
      ["-C", repoRoot, "rev-parse", "--verify", `${revision}^{commit}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (!/^[0-9a-f]{40}$/i.test(resolved)) throw new Error("git returned a non-commit revision");
    return resolved;
  } catch (err) {
    throw new CliError("invalid-provenance", `cannot resolve exact revision '${revision}' in ${repoRoot}: ${redact(errorMessage(err))}`);
  }
}

function renderRepair(result: Record<string, unknown>, ctx: CommandContext): void {
  ctx.out(`repair ${String(result.findingId)}: ${String(result.outcome)}`);
  ctx.out(`  provider: ${String(result.provider)}  attempts: ${String(result.attempts)}`);
  ctx.out(`  base: ${String(result.resolvedRevision)}`);
  ctx.out(`  primary checkout modified: ${String(result.primaryCheckoutModified)}`);
  ctx.out(`  audit: ${String(result.auditPath)}`);
}

function repairExitCode(outcome: RepairRecord["outcome"]): number {
  if (outcome === "RESOLVED") return 0;
  if (outcome === "POLICY_BLOCKED" || outcome === "PROBE_INVALID") return 4;
  if (outcome === "ERROR") return 3;
  return 2;
}

function requiredValue(flags: Record<string, string | true>, name: string): string {
  const value = flags[name];
  if (value === undefined || value === true || value.trim().length === 0) {
    throw new CliError("missing-value", `${name} requires a value`);
  }
  return value;
}

function optionalString(value: string | true | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function signalKind(value: string | null | undefined): OracleSignalKind | undefined {
  return isSignalKind(value) ? value : undefined;
}

function isSignalKind(value: unknown): value is OracleSignalKind {
  return typeof value === "string" && ORACLE_SIGNAL_KINDS.has(value as OracleSignalKind);
}

function isPatchAgent(value: unknown): value is PatchAgent {
  return isRecord(value) && typeof value.id === "string" && typeof value.proposePatch === "function";
}

function isOracleSuite(value: unknown): value is OracleSuite {
  return (
    isRecord(value) &&
    typeof value.evaluateStrict === "function" &&
    Array.isArray(value.descriptors)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redact(value: string): string {
  return redactFreeformText(value);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
