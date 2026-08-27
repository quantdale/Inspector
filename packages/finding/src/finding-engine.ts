import { newId } from "@inspector/protocol";
import type { Store, FindingRecord, FindingStatus, OracleEvaluationRecord } from "@inspector/store-sqlite";
import { OracleEngine, defaultSignatureExtractor } from "./engine.js";
import type { OracleEvaluationDetail } from "./engine.js";
import type {
  Action,
  Finding,
  OracleSignal,
  OracleSignalKind,
  ReplayDriver,
  ReplayResult,
  ReproductionPolicy,
  ReproductionStats,
  SignatureExtractor,
  TransitionMeta,
  EvidenceBundle,
  RegressionScenario,
} from "./types.js";

const VALID_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OBSERVED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["REPRODUCING", "REJECTED", "FLAKY", "CONFIRMED", "NEEDS_HUMAN_ORACLE"],
  REPRODUCING: ["MINIMIZED", "CONFIRMED", "FLAKY", "REJECTED", "CANDIDATE"],
  MINIMIZED: ["CONFIRMED", "FLAKY", "REJECTED"],
  CONFIRMED: ["MINIMIZED", "PATCHING", "VERIFYING", "RESOLVED", "REGRESSED"],
  PATCHING: ["VERIFYING", "CONFIRMED", "REGRESSED"],
  VERIFYING: ["RESOLVED", "REGRESSED", "CONFIRMED"],
  RESOLVED: ["REGRESSED"],
  REGRESSED: ["CONFIRMED", "PATCHING"],
  REJECTED: [],
  FLAKY: ["CANDIDATE", "CONFIRMED", "REJECTED"],
  NEEDS_HUMAN_ORACLE: ["CONFIRMED", "REJECTED"],
};

/**
 * Raised when a reproduction policy is degenerate (zero/negative attempts,
 * minSuccesses outside [1, attempts], or non-integer values). Such a policy
 * would otherwise yield bogus CONFIRMED results with NaN confidence.
 */
export class InvalidReproductionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReproductionPolicyError";
  }
}

export interface FindingEngineOptions {
  /**
   * Pluggable defect-signature extractor used to verify that minimization
   * candidates still reproduce the ORIGINAL defect. Defaults to the sorted
   * distinct signal kinds of a replay result.
   */
  signatureExtractor?: SignatureExtractor;
}

/** Version stamped on persisted oracle evaluation records. */
const ORACLE_EVALUATION_VERSION = "oracle-eval/1";

/**
 * Oracle-class taxonomy (docs/ORACLE-SYSTEM.md). The codebase carries only
 * oracle kind/strength today, so `oracle_class` is populated from kind where
 * the mapping is unambiguous and left null otherwise.
 */
const ORACLE_CLASSES: ReadonlySet<string> = new Set([
  "invariant",
  "metamorphic",
  "structural",
  "persistence",
  "semantic-suspicion",
]);

function validatePolicy(policy: ReproductionPolicy): void {
  const { attempts, minSuccesses } = policy;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new InvalidReproductionPolicyError(
      `invalid reproduction policy: attempts must be an integer >= 1 (got ${attempts})`,
    );
  }
  if (!Number.isInteger(minSuccesses) || minSuccesses < 1 || minSuccesses > attempts) {
    throw new InvalidReproductionPolicyError(
      `invalid reproduction policy: minSuccesses must be an integer in [1, attempts] (got ${minSuccesses}, attempts ${attempts})`,
    );
  }
}

/** Deeply freezes plain objects/arrays so exported evidence cannot drift. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    Object.freeze(value);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Compact, stable replay-subject key: the ordered action ids. Used as
 * provenance when no finding exists yet (pre-finding baseline evaluations).
 */
function subjectKeyOf(actions: Action[]): string {
  return actions.map((a) => a.id).join(">");
}

/**
 * Compact observed-evidence summary: oracle signal kinds and crash-class
 * outcome codes only — never free-form detail — following the repo's
 * redaction-before-persistence conventions.
 */
function summarizeObserved(result: ReplayResult): string {
  const parts: string[] = result.signals.map((s) => s.kind);
  for (const o of result.outcomes) {
    if (o.status === "target-failure" && o.error?.code) parts.push(String(o.error.code));
  }
  return parts.length > 0 ? [...new Set(parts)].sort().join(",") : "(none)";
}

// PART2

export class FindingEngine {
  private readonly signatureExtractor: SignatureExtractor;

  constructor(
    private readonly oracle: OracleEngine = OracleEngine.defaults(),
    private readonly store?: Store,
    opts: FindingEngineOptions = {},
  ) {
    this.signatureExtractor = opts.signatureExtractor ?? defaultSignatureExtractor;
  }

  ingest(
    signal: OracleSignal,
    opts: { runId?: string; title?: string; revision?: string; adapter?: string; classKey?: string } = {},
  ): Finding {
    const now = new Date().toISOString();
    const finding: Finding = {
      id: newId("find"),
      runId: opts.runId ?? null,
      status: "CANDIDATE",
      title: opts.title ?? `Candidate defect: ${signal.kind}`,
      confidence: 0,
      severity: "unknown",
      revision: opts.revision ?? null,
      // Record only the oracles relevant to this signal so evidence names
      // the detectors that can actually fire, not the whole registry.
      oracleIds: this.oracle.relevantOracleIds(signal),
      reproduction: null,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
      signature: signal.kind,
      minimization: null,
      lastTransition: null,
      adapter: opts.adapter ?? null,
      classKey: opts.classKey ?? null,
    };
    this.persist(finding);
    return finding;
  }

  /** Rehydrate a finding admitted before a controller interruption. The
   * durable row remains the lifecycle authority; this method only reconstructs
   * the typed object needed to continue an allowed reproduction transition. */
  rehydrate(record: FindingRecord): Finding {
    const severity = record.severity;
    const allowedSeverity = new Set(["low", "medium", "high", "critical", "unknown"]);
    return {
      id: record.id,
      runId: record.runId,
      status: record.status,
      title: record.title,
      confidence: record.confidence,
      severity: allowedSeverity.has(severity ?? "")
        ? (severity as Finding["severity"])
        : "unknown",
      revision: record.revision,
      oracleIds: parseStringArray(record.oracleIds),
      reproduction: parseJson(record.reproductionJson),
      artifactRefs: parseStringArray(record.artifactRefs),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      signature: record.signature,
      minimization: parseJson(record.minimizationJson),
      lastTransition: parseJson(record.lastTransitionJson),
      adapter: record.adapter,
      classKey: record.classKey ?? null,
    };
  }

  transition(
    finding: Finding,
    next: FindingStatus,
    meta: { reason?: string; actor?: string } = {},
  ): Finding {
    const allowed = VALID_TRANSITIONS[finding.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`invalid finding transition ${finding.status} -> ${next}`);
    }
    const from = finding.status;
    finding.status = next;
    finding.updatedAt = new Date().toISOString();
    const recorded: TransitionMeta = { from, to: next, at: finding.updatedAt };
    if (meta.reason !== undefined) recorded.reason = meta.reason;
    if (meta.actor !== undefined) recorded.actor = meta.actor;
    finding.lastTransition = recorded;
    this.persist(finding);
    return finding;
  }

  // PART3

  async reproduce(
    finding: Finding,
    actions: Action[],
    driver: ReplayDriver,
    policy: ReproductionPolicy,
  ): Promise<{ finding: Finding; stats: ReproductionStats; lastSignals: OracleSignal[] }> {
    // Validate before touching durable state: a degenerate policy must never
    // move a finding out of CANDIDATE (it would fabricate NaN-confidence
    // confirmations).
    validatePolicy(policy);
    this.transition(finding, "REPRODUCING");
    let successes = 0;
    let errors = 0;
    let lastError: string | null = null;
    let lastSignals: OracleSignal[] = [];
    const matchedOracleIds = new Set<string>();
    let stats: ReproductionStats = { attempts: policy.attempts, successes: 0, errors: 0, lastError: null };
    try {
      for (let i = 0; i < policy.attempts; i++) {
        let result: ReplayResult;
        try {
          result = await FindingEngine.replayBounded(driver, actions, policy.perAttemptTimeoutMs);
        } catch (e) {
          // Contained driver failure: the attempt counts as a failure and
          // the error is recorded instead of stranding the finding.
          errors += 1;
          lastError = e instanceof Error ? e.message : String(e);
          continue;
        }
        lastSignals = result.signals;
        const evaluation = this.oracle.evaluate(result);
        this.persistOracleEvaluations(evaluation.evaluations, {
          phase: "reproduce",
          findingId: finding.id,
          runId: finding.runId,
          subjectKey: subjectKeyOf(actions),
          expected: "no defect signal on replay",
          observed: summarizeObserved(result),
        });
        if (evaluation.reproduced) {
          successes += 1;
          for (const id of evaluation.matchedOracleIds) matchedOracleIds.add(id);
        }
      }
      stats = {
        attempts: policy.attempts,
        successes,
        errors,
        lastError,
        // Name the deciding oracles so confirmed findings are auditable.
        ...(matchedOracleIds.size > 0 ? { matchedOracleIds: [...matchedOracleIds].sort() } : {}),
      };
      finding.reproduction = stats;
      const ratio = successes / policy.attempts;
      finding.confidence = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
      if (successes >= policy.minSuccesses) {
        finding.severity = successes === policy.attempts ? "high" : "medium";
        this.transition(finding, "CONFIRMED");
      } else if (successes === 0) {
        if (errors > 0) {
          // H5-D9: all attempts errored/timed out/cancelled, so there is NO
          // positive non-reproduction evidence. The finding must stay in a
          // non-terminal/indeterminate state, never become REJECTED (which
          // would conflate "could not execute" with "cleanly did not
          // reproduce").
          this.transition(finding, "CANDIDATE", {
            reason: "all replay attempts errored/timed out; cannot conclude non-reproduction",
            actor: "finding-engine",
          });
        } else {
          this.transition(finding, "REJECTED");
        }
      } else {
        this.transition(finding, "FLAKY");
      }
    } catch (e) {
      // Internal error (not a contained driver failure): recover the finding
      // back to CANDIDATE so it cannot be stranded durably in REPRODUCING.
      if (finding.status === "REPRODUCING") {
        this.transition(finding, "CANDIDATE", {
          reason: "internal error during reproduction",
          actor: "finding-engine",
        });
      }
      throw e;
    }
    this.persist(finding);
    return { finding, stats, lastSignals };
  }

  async minimize(
    finding: Finding,
    actions: Action[],
    driver: ReplayDriver,
    opts: { maxReplays?: number } = {},
  ): Promise<Action[]> {
    // Each probe replays against a fresh environment, so minimization is
    // bounded: when the replay budget is exhausted the best sequence found
    // so far is returned. A reduction is accepted ONLY when the candidate
    // still reproduces the ORIGINAL defect signature, so a noisy or
    // multi-defect path can never be minimized onto a different defect.
    let replaysLeft = opts.maxReplays ?? 20;
    let probes = 0;
    let removals = 0;
    let current = actions.slice();
    // With the default extractor the ingest-time signature is authoritative;
    // pluggable extractors define their own vocabulary, established from the
    // full-sequence baseline below.
    const usingDefaultExtractor = this.signatureExtractor === defaultSignatureExtractor;
    let originalSignature = usingDefaultExtractor ? finding.signature ?? null : null;

    // Baseline verification: the full sequence must reproduce the original
    // signature before any reduction is attempted.
    let verified = false;
    if (replaysLeft > 0) {
      replaysLeft -= 1;
      probes += 1;
      const baseResult = await driver.replay(current);
      const baseSig = this.signatureExtractor(baseResult);
      if (originalSignature === null) originalSignature = baseSig;
      const baseEvaluation = this.oracle.evaluate(baseResult);
      this.persistOracleEvaluations(baseEvaluation.evaluations, {
        phase: "minimize",
        findingId: finding.id,
        runId: finding.runId,
        subjectKey: subjectKeyOf(current),
        expected: `baseline replay reproduces signature ${originalSignature ?? "(unknown)"}`,
        observed: summarizeObserved(baseResult),
      });
      verified =
        baseSig !== null &&
        baseSig === originalSignature &&
        baseEvaluation.reproduced;
    }
    if (!verified) {
      finding.minimization = { probes, removals: 0, verifiedReproduction: false };
      this.persist(finding);
      return current;
    }

    let changed = true;
    while (changed && replaysLeft > 0) {
      changed = false;
      const granularity = Math.max(1, Math.floor(current.length / 2));
      for (let i = 0; i < current.length; i += granularity) {
        if (replaysLeft <= 0) break;
        const candidate = current.filter((_, idx) => idx < i || idx >= i + granularity);
        if (candidate.length === 0) continue;
        const result = await driver.replay(candidate);
        replaysLeft -= 1;
        probes += 1;
        const candidateSig = this.signatureExtractor(result);
        const candidateEvaluation = this.oracle.evaluate(result);
        this.persistOracleEvaluations(candidateEvaluation.evaluations, {
          phase: "minimize",
          findingId: finding.id,
          runId: finding.runId,
          subjectKey: subjectKeyOf(candidate),
          expected: `reduced replay reproduces signature ${originalSignature ?? "(unknown)"}`,
          observed: summarizeObserved(result),
        });
        if (
          candidateSig !== null &&
          candidateSig === originalSignature &&
          candidateEvaluation.reproduced
        ) {
          removals += current.length - candidate.length;
          current = candidate;
          changed = true;
          break;
        }
      }
    }
    finding.minimization = { probes, removals, verifiedReproduction: true };
    if (finding.status === "REPRODUCING" || finding.status === "CONFIRMED") {
      this.transition(finding, "MINIMIZED");
    }
    this.persist(finding);
    return current;
  }

  // PART4

  buildBundle(
    finding: Finding,
    original: Action[],
    minimized: Action[],
    opts: {
      revision?: string;
      environment?: Record<string, unknown>;
      replayCommand?: string;
      signals?: OracleSignal[];
      artifactRefs?: string[];
    } = {},
  ): EvidenceBundle {
    const artifactRefs = [
      ...new Set([...(opts.artifactRefs ?? []), ...finding.artifactRefs]),
    ];
    // The bundle is an immutable snapshot: later transitions on the live
    // finding must never mutate historical evidence.
    const bundle: EvidenceBundle = {
      schema: "inspector-evidence/1",
      finding: deepFreeze(structuredClone(finding)),
      revision: opts.revision ?? finding.revision,
      environment: deepFreeze(structuredClone(opts.environment ?? {})),
      originalSteps: deepFreeze(structuredClone(original)),
      minimizedSteps: deepFreeze(structuredClone(minimized)),
      oracleEvidence: deepFreeze(structuredClone(opts.signals ?? [])),
      // Evaluation history comes from the durable store so bundles answer
      // "which oracles ran, what did they see, why promoted". Snapshotted
      // (cloned + frozen) like every other bundle field.
      evaluations: deepFreeze(
        structuredClone(this.store?.listOracleEvaluationsForFinding(finding.id) ?? []),
      ),
      // Frozen snapshot; the EvidenceBundle field predates readonly typing.
      artifactRefs: Object.freeze(artifactRefs) as unknown as string[],
      replayCommand: opts.replayCommand ?? `inspector replay --finding ${finding.id}`,
    };
    return deepFreeze(bundle);
  }

  exportRegression(
    finding: Finding,
    minimized: Action[],
    expectOracle: OracleSignalKind,
    opts: { adapter?: string } = {},
  ): RegressionScenario {
    return {
      schema: "inspector-regression/1",
      findingId: finding.id,
      adapter: opts.adapter ?? finding.adapter ?? "adapter-fake",
      steps: minimized,
      expectOracle,
    };
  }

  // PART5

  /** Awaits one replay attempt, optionally bounded by a wall-clock timeout. */
  private static async replayBounded(
    driver: ReplayDriver,
    actions: Action[],
    timeoutMs?: number,
  ): Promise<ReplayResult> {
    if (timeoutMs === undefined || timeoutMs <= 0) return driver.replay(actions);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        driver.replay(actions),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`replay attempt timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Persist one oracle-evaluation record per descriptor for a single
   * evaluation event. Used by the repair pipeline (repair-verify phase) so
   * verification-phase oracle outcomes are auditable like reproduction ones.
   * Persistence failures are contained: provenance must never break repair.
   */
  recordRepairVerification(input: {
    finding: Finding;
    /** Descriptors of every oracle evaluated (matched or not). */
    descriptors: Array<{
      id: string;
      kind?: string;
      strength?: "hard" | "soft";
      confidence?: number;
      description?: string;
    }>;
    matchedIds: string[];
    expected: string;
    observed: string;
  }): void {
    const matched = new Set(input.matchedIds);
    this.persistOracleEvaluations(
      input.descriptors.map((d) => ({
        oracleId: d.id,
        reproduced: matched.has(d.id),
        kind: d.kind ?? null,
        strength: d.strength ?? null,
        confidence: typeof d.confidence === "number" ? d.confidence : null,
        description: d.description ?? null,
      })),
      {
        phase: "repair-verify",
        findingId: input.finding.id,
        runId: input.finding.runId,
        expected: input.expected,
        observed: input.observed,
      },
    );
  }

  /** Failure-contained evaluation-record persistence (log-and-continue). */
  private persistOracleEvaluations(
    evaluations: OracleEvaluationDetail[],
    opts: {
      phase: OracleEvaluationRecord["phase"];
      findingId: string | null;
      runId: string | null;
      subjectKey?: string | null;
      expected: string;
      observed: string;
    },
  ): void {
    if (!this.store || evaluations.length === 0) return;
    try {
      for (const e of evaluations) {
        const record: OracleEvaluationRecord = {
          id: newId(),
          runId: opts.runId,
          stepId: null,
          findingId: opts.findingId,
          subjectKey: opts.subjectKey ?? null,
          phase: opts.phase,
          oracleId: e.oracleId,
          oracleKind: e.kind,
          oracleStrength: e.strength,
          oracleClass: e.kind !== null && ORACLE_CLASSES.has(e.kind) ? e.kind : null,
          reproduced: e.reproduced,
          confidence: e.confidence,
          expected: opts.expected,
          observed: opts.observed,
          explanation:
            e.description ??
            `${e.oracleId} ${e.reproduced ? "matched" : "did not match"} on replay`,
          version: ORACLE_EVALUATION_VERSION,
          createdAt: new Date().toISOString(),
        };
        this.store.putOracleEvaluation(record);
      }
    } catch (err) {
      // Provenance enrichment only: never break the finding pipeline.
      console.warn(
        `[finding-engine] failed to persist oracle evaluation records: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private persist(finding: Finding): void {
    if (!this.store) return;
    const record: FindingRecord = {
      id: finding.id,
      runId: finding.runId,
      status: finding.status,
      title: finding.title,
      confidence: finding.confidence,
      severity: finding.severity,
      revision: finding.revision,
      oracleIds: JSON.stringify(finding.oracleIds),
      reproductionJson: finding.reproduction ? JSON.stringify(finding.reproduction) : null,
      artifactRefs: JSON.stringify(finding.artifactRefs),
      createdAt: finding.createdAt,
      updatedAt: finding.updatedAt,
      // Wave-1 fields must survive restarts, not live in memory only.
      signature: finding.signature ?? null,
      minimizationJson: finding.minimization ? JSON.stringify(finding.minimization) : null,
      lastTransitionJson: finding.lastTransition ? JSON.stringify(finding.lastTransition) : null,
      adapter: finding.adapter ?? null,
      classKey: finding.classKey ?? null,
    };
    this.store.putFinding(record);
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    // H5-D13: malformed durable JSON must not silently degrade to [] and hide evidence corruption.
    throw new Error(`malformed durable string-array JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`malformed durable string-array JSON: expected string[] but got ${typeof value}`);
  }
  return value;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    // H5-D13: malformed durable structured JSON must not silently degrade to null.
    throw new Error(`malformed durable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}
