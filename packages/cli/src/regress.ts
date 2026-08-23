import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@inspector/protocol";
import { OracleEngine } from "@inspector/finding";
import type { RegressionRecord } from "@inspector/store-sqlite";
import { redactFreeformText } from "@inspector/adapter-sdk";
import { CliError, intFlag, type ParsedInvocation } from "./args.js";
import {
  loadReplaySubject,
  replayDriverFor,
  regressionScenarioKey,
  WorkflowProvenanceError,
} from "./replay-workflow.js";
import { openWorkspace, remapWorkspaceConflict } from "./workspace.js";
import { warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";
import { writeJsonAtomic } from "./atomic.js";

const REGRESS_SCHEMA = "inspector-cli/regress/1";

interface RegressRequest {
  runId?: string;
  findingId?: string;
  adapter?: string;
  revision?: string;
  attempts: number;
  minSuccesses: number;
  limit: number;
}

export function parseRegressRequest(parsed: ParsedInvocation): RegressRequest {
  if (parsed.positionals.length > 0) {
    throw new CliError("unexpected-argument", "regress does not take positional arguments; use filters");
  }
  const adapter = parsed.flags["--adapter"];
  if (adapter !== undefined && typeof adapter !== "string") {
    throw new CliError("invalid-value", "--adapter requires an adapter family");
  }
  const attempts = intFlag(parsed.flags, "--attempts", 1);
  const minSuccesses = intFlag(parsed.flags, "--min-successes", 1);
  if (attempts < 1 || minSuccesses < 1 || minSuccesses > attempts) {
    throw new CliError(
      "invalid-value",
      `--attempts/--min-successes require 1 <= min-successes <= attempts (got ${minSuccesses}/${attempts})`,
    );
  }
  const revision = parsed.flags["--revision"];
  return {
    ...(typeof parsed.flags["--run"] === "string" ? { runId: parsed.flags["--run"] } : {}),
    ...(typeof parsed.flags["--finding"] === "string" ? { findingId: parsed.flags["--finding"] } : {}),
    ...(typeof adapter === "string" ? { adapter } : {}),
    ...(typeof revision === "string" ? { revision } : {}),
    attempts,
    minSuccesses,
    limit: intFlag(parsed.flags, "--limit", 1000),
  };
}

type ScenarioClassification =
  | "pass"
  | "reproduced-regression"
  | "resolved"
  | "fixed"
  | "flaky"
  | "environment-failure"
  | "incompatible-target"
  | "skipped";

interface ScenarioResult {
  scenarioId: string;
  scenarioKey: string;
  findingId: string;
  runId: string | null;
  adapter: string;
  revision: string | null;
  classification: ScenarioClassification;
  attempts: number;
  successes: number;
  errors: number;
  reason?: string;
  artifactPath?: string;
}

interface RegressSummary {
  schema: typeof REGRESS_SCHEMA;
  ok: boolean;
  command: "regress";
  targetRevision: string | null;
  filters: Omit<RegressRequest, "attempts" | "minSuccesses" | "limit">;
  totalScenarios: number;
  counts: {
    pass: number;
    reproducedRegression: number;
    resolvedFixed: number;
    flaky: number;
    environmentFailure: number;
    incompatibleTarget: number;
    skipped: number;
  };
  scenarios: ScenarioResult[];
  warnings: string[];
}

export async function regressCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const req = parseRegressRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let store;
  try {
    ({ store } = openWorkspace(dir));
  } catch (err) {
    throw remapWorkspaceConflict(err);
  }
  try {
    const records = store
      .listFindings(req.limit)
      .filter((finding) => ["CONFIRMED", "RESOLVED", "REGRESSED"].includes(finding.status))
      .filter((finding) => req.runId === undefined || finding.runId === req.runId)
      .filter((finding) => req.findingId === undefined || finding.id === req.findingId)
      .filter((finding) => req.adapter === undefined || finding.adapter === req.adapter);
    const scenarios: ScenarioResult[] = [];
    for (const record of records) {
      const adapter = record.adapter ?? store.getRun(record.runId ?? "")?.adapter ?? "unknown";
      const revision = req.revision ?? record.revision ?? "current";
      const key = regressionScenarioKey(record.id, adapter, revision);
      const existing = store.getRegressionRecordByScenarioKey(key);
      if (existing?.status === "completed") {
        scenarios.push({
          scenarioId: existing.id,
          scenarioKey: key,
          findingId: existing.findingId,
          runId: existing.runId,
          adapter: existing.adapter,
          revision: existing.revision,
          classification: "skipped",
          attempts: existing.attempts,
          successes: existing.successes,
          errors: existing.errors,
          reason: `already completed as ${existing.classification}; use a different --revision to execute a new scenario`,
          ...(existing.artifactPath ? { artifactPath: existing.artifactPath } : {}),
        });
        continue;
      }
      scenarios.push(await executeScenario({
        record,
        adapter,
        revision,
        key,
        req,
        dir,
        store,
      }));
    }
    const summary = makeSummary(scenarios, warning, req);
    const code = regressExitCode(summary);
    if (ctx.json) ctx.out(JSON.stringify(summary, null, 2));
    else renderSummary(summary, ctx);
    return { code, data: summary };
  } finally {
    store.close();
  }
}

async function executeScenario(input: {
  record: import("@inspector/store-sqlite").FindingRecord;
  adapter: string;
  revision: string;
  key: string;
  req: RegressRequest;
  dir: string;
  store: import("@inspector/store-sqlite").Store;
}): Promise<ScenarioResult> {
  const { record, adapter, revision, key, req, dir, store } = input;
  const existing = store.getRegressionRecordByScenarioKey(key);
  const id = existing?.id ?? newId();
  const startedAt = existing?.startedAt ?? new Date().toISOString();
  let durable: RegressionRecord = existing
    ? {
        ...existing,
        status: "running",
        classification: "skipped",
        completedAt: null,
        artifactPath: null,
      }
    : {
        id,
        scenarioKey: key,
        findingId: record.id,
        runId: record.runId,
        adapter,
        revision,
        status: "running",
        classification: "skipped",
        attempts: 0,
        successes: 0,
        errors: 0,
        startedAt,
        completedAt: null,
        resultJson: null,
        artifactPath: null,
      };
  store.putRegressionRecord(durable);

  let subject;
  try {
    subject = loadReplaySubject(store, join(dir, ".inspector"), record.id);
  } catch (err) {
    const classification: ScenarioClassification =
      err instanceof WorkflowProvenanceError ? "incompatible-target" : "environment-failure";
    return finishScenario(store, durable, classification, {
      scenarioId: id,
      scenarioKey: key,
      findingId: record.id,
      runId: record.runId,
      adapter,
      revision,
      classification,
      attempts: 0,
      successes: 0,
      errors: classification === "environment-failure" ? 1 : 0,
      reason: errorMessage(err),
    }, dir);
  }
  if (req.revision !== undefined && record.revision !== null && req.revision !== record.revision) {
    return finishScenario(store, durable, "incompatible-target", {
      scenarioId: id,
      scenarioKey: key,
      findingId: record.id,
      runId: record.runId,
      adapter,
      revision,
      classification: "incompatible-target",
      attempts: 0,
      successes: 0,
      errors: 0,
      reason: `requested revision '${req.revision}' does not match finding revision '${record.revision}'`,
    }, dir);
  }

  const attempts: Array<{ attempt: number; outcome: string; matchedOracleIds: string[]; error?: string }> =
    resumeAttempts(durable.resultJson);
  let successes = durable.successes;
  let errors = durable.errors;
  const oracle = OracleEngine.defaults();
  for (let index = durable.attempts + 1; index <= req.attempts; index += 1) {
    try {
      const driver = await replayDriverFor(subject, join(dir, ".inspector"));
      const result = await driver.replay(subject.bundle.minimizedSteps);
      const evaluation = oracle.evaluate(result);
      if (evaluation.reproduced) successes += 1;
      attempts.push({
        attempt: index,
        outcome: evaluation.reproduced ? "reproduced" : "clean",
        matchedOracleIds: evaluation.matchedOracleIds,
      });
    } catch (err) {
      errors += 1;
      attempts.push({
        attempt: index,
        outcome: "environment-failure",
        matchedOracleIds: [],
        error: redact(errorMessage(err)),
      });
    }
    durable = {
      ...durable,
      attempts: index,
      successes,
      errors,
      resultJson: JSON.stringify({ attempts }),
    };
    store.putRegressionRecord(durable);
  }
  const classification: ScenarioClassification =
    successes >= req.minSuccesses
      ? "reproduced-regression"
      : errors > 0 && successes === 0
        ? "environment-failure"
        : successes > 0
          ? "flaky"
          : record.status === "RESOLVED"
            ? "resolved"
            : record.status === "REGRESSED"
              ? "fixed"
              : "pass";
  return finishScenario(store, durable, classification, {
    scenarioId: id,
    scenarioKey: key,
    findingId: record.id,
    runId: record.runId,
    adapter,
    revision,
    classification,
    attempts: attempts.length,
    successes,
    errors,
  }, dir, attempts);
}

function finishScenario(
  store: import("@inspector/store-sqlite").Store,
  record: RegressionRecord,
  classification: ScenarioClassification,
  result: ScenarioResult,
  dir: string,
  attemptsDetail: unknown[] = [],
): ScenarioResult {
  const artifactDir = join(dir, ".inspector", "regressions");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${record.scenarioKey}.json`);
  const completedAt = new Date().toISOString();
  const artifact = {
    schema: REGRESS_SCHEMA,
    ...result,
    attemptsDetail,
    completedAt,
  };
  writeJsonAtomic(artifactPath, artifact);
  store.putRegressionRecord({
    ...record,
    status: "completed",
    classification,
    attempts: result.attempts,
    successes: result.successes,
    errors: result.errors,
    completedAt,
    resultJson: JSON.stringify(artifact),
    artifactPath,
  });
  return { ...result, artifactPath };
}

function makeSummary(scenarios: ScenarioResult[], warning: string | null, req: RegressRequest): RegressSummary {
  const count = (c: ScenarioClassification) => scenarios.filter((s) => s.classification === c).length;
  const summary: RegressSummary = {
    schema: REGRESS_SCHEMA,
    ok: !scenarios.some((s) => ["reproduced-regression", "flaky", "environment-failure", "incompatible-target"].includes(s.classification)),
    command: "regress",
    targetRevision: req.revision ?? null,
    filters: {
      ...(req.runId !== undefined ? { runId: req.runId } : {}),
      ...(req.findingId !== undefined ? { findingId: req.findingId } : {}),
      ...(req.adapter !== undefined ? { adapter: req.adapter } : {}),
      ...(req.revision !== undefined ? { revision: req.revision } : {}),
    },
    totalScenarios: scenarios.length,
    counts: {
      pass: count("pass"),
      reproducedRegression: count("reproduced-regression"),
      resolvedFixed: scenarios.filter((s) => ["resolved", "fixed"].includes(s.classification)).length,
      flaky: count("flaky"),
      environmentFailure: count("environment-failure"),
      incompatibleTarget: count("incompatible-target"),
      skipped: count("skipped"),
    },
    scenarios,
    warnings: warning ? [warning] : [],
  };
  return summary;
}

function regressExitCode(summary: RegressSummary): number {
  if (summary.counts.reproducedRegression > 0) return 2;
  if (summary.counts.flaky > 0 || summary.counts.environmentFailure > 0 || summary.counts.incompatibleTarget > 0) return 3;
  return 0;
}

function renderSummary(summary: RegressSummary, ctx: CommandContext): void {
  ctx.out(`regress: ${summary.totalScenarios} scenario(s)`);
  ctx.out(`  pass=${summary.counts.pass} reproduced=${summary.counts.reproducedRegression} resolved/fixed=${summary.counts.resolvedFixed} flaky=${summary.counts.flaky} environment=${summary.counts.environmentFailure} incompatible=${summary.counts.incompatibleTarget} skipped=${summary.counts.skipped}`);
  for (const scenario of summary.scenarios) {
    ctx.out(`  ${scenario.findingId}  ${scenario.classification}  attempts=${scenario.attempts}/${scenario.successes}`);
    if (scenario.reason) ctx.out(`    reason: ${scenario.reason}`);
  }
}

function redact(value: string): string {
  return redactFreeformText(value);
}

function resumeAttempts(raw: string | null): Array<{ attempt: number; outcome: string; matchedOracleIds: string[]; error?: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { attempts?: unknown };
    if (!Array.isArray(parsed.attempts)) return [];
    return parsed.attempts.filter(
      (attempt): attempt is { attempt: number; outcome: string; matchedOracleIds: string[]; error?: string } =>
        typeof attempt === "object" && attempt !== null &&
        typeof (attempt as { attempt?: unknown }).attempt === "number" &&
        typeof (attempt as { outcome?: unknown }).outcome === "string" &&
        Array.isArray((attempt as { matchedOracleIds?: unknown }).matchedOracleIds),
    );
  } catch {
    return [];
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
