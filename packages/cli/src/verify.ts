import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@inspector/protocol";
import { FindingEngine, OracleEngine, type ReplayResult } from "@inspector/finding";
import type { VerificationRecord } from "@inspector/store-sqlite";
import { redactFreeformText } from "@inspector/adapter-sdk";
import { CliError, intFlag, requirePositional, type ParsedInvocation } from "./args.js";
import {
  loadReplaySubject,
  replayDriverFor,
  WorkflowProvenanceError,
  type WorkflowClassification,
} from "./replay-workflow.js";
import { openWorkspace, remapWorkspaceConflict } from "./workspace.js";
import { warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";
import { writeJsonAtomic } from "./atomic.js";

const VERIFY_SCHEMA = "inspector-cli/verify/1";

export interface VerifyRequest {
  findingId: string;
  attempts: number;
  minSuccesses: number;
  timeoutMs?: number;
  revision?: string;
}

export function parseVerifyRequest(parsed: ParsedInvocation): VerifyRequest {
  const findingId = requirePositional(parsed.positionals, 0, "inspector verify <findingId>");
  if (parsed.positionals.length > 1) {
    throw new CliError("unexpected-argument", "verify accepts one finding id");
  }
  const attempts = intFlag(parsed.flags, "--attempts", 2);
  const minSuccesses = intFlag(parsed.flags, "--min-successes", 1);
  if (attempts < 1 || minSuccesses < 1 || minSuccesses > attempts) {
    throw new CliError(
      "invalid-value",
      `--attempts/--min-successes require 1 <= min-successes <= attempts (got ${minSuccesses}/${attempts})`,
    );
  }
  const timeout = parsed.flags["--timeout-ms"];
  const revision = parsed.flags["--revision"];
  return {
    findingId,
    attempts,
    minSuccesses,
    ...(timeout !== undefined ? { timeoutMs: intFlag(parsed.flags, "--timeout-ms", 0) } : {}),
    ...(typeof revision === "string" ? { revision } : {}),
  };
}

interface VerifyAttempt {
  attempt: number;
  outcome: "reproduced" | "clean" | "environment-failure";
  matchedOracleIds: string[];
  signals: string[];
  error?: string;
}

export async function verifyCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const req = parseVerifyRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let store;
  try {
    ({ store } = openWorkspace(dir));
  } catch (err) {
    throw remapWorkspaceConflict(err);
  }
  const verificationId = newId();
  const startedAt = new Date().toISOString();
  let adapter = "unknown";
  let runId: string | null = null;
  let record: VerificationRecord = {
    id: verificationId,
    findingId: req.findingId,
    runId,
    adapter,
    revision: req.revision ?? null,
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
  try {
    const durable = store.getFinding(req.findingId);
    if (durable) {
      adapter = durable.adapter ?? store.getRun(durable.runId ?? "")?.adapter ?? "unknown";
      runId = durable.runId;
      record = { ...record, adapter, runId };
    }
    store.putVerificationRecord(record);

    let subject;
    try {
      subject = loadReplaySubject(store, join(dir, ".inspector"), req.findingId);
    } catch (err) {
      if (err instanceof CliError) throw err;
      const classification: WorkflowClassification =
        err instanceof WorkflowProvenanceError ? err.classification : "environment-failure";
      const detail = errorMessage(err);
      return finishVerification(store, record, classification, {
        ok: false,
        warning,
        findingId: req.findingId,
        adapter,
        runId,
        revision: req.revision ?? null,
        classification,
        attempts: 0,
        successes: 0,
        errors: 0,
        detail,
      }, dir, ctx);
    }
    adapter = subject.run.adapter ?? adapter;
    runId = subject.run.id;
    record = { ...record, adapter, runId };

    if (!["CONFIRMED", "RESOLVED", "REGRESSED"].includes(subject.finding.status)) {
      const detail = `finding status ${subject.finding.status} is not verification-capable`;
      return finishVerification(store, record, "skipped", {
        ok: false,
        warning,
        findingId: req.findingId,
        adapter,
        runId,
        revision: req.revision ?? subject.finding.revision,
        classification: "skipped",
        attempts: 0,
        successes: 0,
        errors: 0,
        detail,
      }, dir, ctx, 4);
    }
    if (
      req.revision !== undefined &&
      subject.finding.revision !== null &&
      req.revision !== subject.finding.revision
    ) {
      const detail = `requested revision '${req.revision}' does not match finding revision '${subject.finding.revision}'`;
      return finishVerification(store, record, "invalid-provenance", {
        ok: false,
        warning,
        findingId: req.findingId,
        adapter,
        runId,
        revision: req.revision,
        classification: "invalid-provenance",
        attempts: 0,
        successes: 0,
        errors: 0,
        detail,
      }, dir, ctx, 4);
    }

    const revision = req.revision ?? subject.finding.revision ?? "current";
    const attempts: VerifyAttempt[] = [];
    let successes = 0;
    let errors = 0;
    const oracle = OracleEngine.defaults();
    for (let index = 1; index <= req.attempts; index += 1) {
      let attempt: VerifyAttempt;
      try {
        const driver = await replayDriverFor(subject, join(dir, ".inspector"));
        const result = await replayBounded(driver, subject.bundle.minimizedSteps, req.timeoutMs);
        const evaluation = oracle.evaluate(result);
        const reproduced = evaluation.reproduced;
        if (reproduced) successes += 1;
        attempt = {
          attempt: index,
          outcome: reproduced ? "reproduced" : "clean",
          matchedOracleIds: evaluation.matchedOracleIds,
          signals: result.signals.map((s) => s.kind),
        };
      } catch (err) {
        errors += 1;
        attempt = {
          attempt: index,
          outcome: "environment-failure",
          matchedOracleIds: [],
          signals: [],
          error: redact(errorMessage(err)),
        };
      }
      attempts.push(attempt);
      record = {
        ...record,
        adapter,
        runId,
        revision,
        attempts: index,
        successes,
        errors,
        resultJson: JSON.stringify({ attempts }),
      };
      store.putVerificationRecord(record);
    }

    const classification: WorkflowClassification =
      successes >= req.minSuccesses
        ? "reproduced"
        : errors > 0 && successes === 0
          ? "environment-failure"
          : successes > 0
            ? "flaky"
            : "fixed";
    if (classification === "fixed") {
      const findingEngine = new FindingEngine(oracle, store);
      const current = findingEngine.rehydrate(subject.record);
      if (current.status === "CONFIRMED") {
        findingEngine.transition(current, "RESOLVED", {
          reason: "clean exact replay from inspector verify",
          actor: "inspector verify",
        });
      } else if (current.status === "REGRESSED") {
        findingEngine.transition(current, "CONFIRMED", {
          reason: "clean exact replay from inspector verify",
          actor: "inspector verify",
        });
      }
    } else if (classification === "reproduced" && subject.finding.status === "RESOLVED") {
      const findingEngine = new FindingEngine(oracle, store);
      findingEngine.transition(findingEngine.rehydrate(subject.record), "REGRESSED", {
        reason: "exact replay reproduced a previously resolved finding",
        actor: "inspector verify",
      });
    }
    return finishVerification(store, record, classification, {
      ok: classification === "fixed",
      warning,
      findingId: req.findingId,
      adapter,
      runId,
      revision,
      classification,
      attempts: attempts.length,
      successes,
      errors,
      attemptsDetail: attempts,
      bundlePath: subject.bundlePath,
    }, dir, ctx);
  } catch (err) {
    if (record.status === "running") {
      record = {
        ...record,
        status: "failed",
        classification: "environment-failure",
        completedAt: new Date().toISOString(),
        resultJson: JSON.stringify({ error: redact(errorMessage(err)) }),
      };
      store.putVerificationRecord(record);
    }
    throw err;
  } finally {
    store.close();
  }
}

async function finishVerification(
  store: import("@inspector/store-sqlite").Store,
  record: VerificationRecord,
  classification: WorkflowClassification,
  result: Record<string, unknown>,
  dir: string,
  ctx: CommandContext,
  forcedCode?: number,
): Promise<{ code: number; data?: unknown }> {
  const completedAt = new Date().toISOString();
  const artifactDir = join(dir, ".inspector", "verifications", record.findingId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${record.id}.json`);
  const artifact = { schema: VERIFY_SCHEMA, ...result, completedAt };
  writeJsonAtomic(artifactPath, artifact);
  const final: VerificationRecord = {
    ...record,
    status: "completed",
    classification,
    attempts: typeof result.attempts === "number" ? result.attempts : record.attempts,
    successes: typeof result.successes === "number" ? result.successes : record.successes,
    errors: typeof result.errors === "number" ? result.errors : record.errors,
    completedAt,
    resultJson: JSON.stringify(artifact),
    artifactPath,
  };
  store.putVerificationRecord(final);
  const code = forcedCode ?? verificationExitCode(classification);
  const output = {
    schema: VERIFY_SCHEMA,
    ok: code === 0,
    command: "verify",
    result: { ...result, verificationId: record.id, artifactPath },
    warnings: result.warning ? [result.warning] : [],
  };
  if (ctx.json) ctx.out(JSON.stringify(output, null, 2));
  else renderVerification(output.result as Record<string, unknown>, ctx);
  return { code, data: output };
}

function renderVerification(result: Record<string, unknown>, ctx: CommandContext): void {
  ctx.out(`verify ${String(result.findingId)}: ${String(result.classification)}`);
  ctx.out(`  adapter: ${String(result.adapter)}  attempts: ${String(result.attempts)}  successes: ${String(result.successes)}`);
  if (result.detail) ctx.out(`  detail: ${String(result.detail)}`);
  if (result.bundlePath) ctx.out(`  evidence: ${String(result.bundlePath)}`);
  if (result.artifactPath) ctx.out(`  verification record: ${String(result.artifactPath)}`);
}

function verificationExitCode(classification: WorkflowClassification): number {
  if (classification === "reproduced") return 2;
  if (classification === "environment-failure" || classification === "flaky" || classification === "incompatible-target") return 3;
  if (classification === "invalid-provenance" || classification === "skipped") return 4;
  return 0;
}

async function replayBounded(
  driver: import("@inspector/finding").ReplayDriver,
  actions: import("@inspector/protocol").Action[],
  timeoutMs?: number,
): Promise<ReplayResult> {
  if (timeoutMs === undefined || timeoutMs <= 0) return driver.replay(actions);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      driver.replay(actions),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`replay attempt timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function redact(value: string): string {
  return redactFreeformText(value);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
