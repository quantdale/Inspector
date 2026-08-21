import { newId } from "@inspector/protocol";
import type { Store, FindingRecord, FindingStatus } from "@inspector/store-sqlite";
import { OracleEngine, defaultSignatureExtractor } from "./engine.js";
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
    opts: { runId?: string; title?: string; revision?: string; adapter?: string } = {},
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
    };
    this.persist(finding);
    return finding;
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
        this.transition(finding, "REJECTED");
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
      verified =
        baseSig !== null &&
        baseSig === originalSignature &&
        this.oracle.evaluate(baseResult).reproduced;
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
        if (
          candidateSig !== null &&
          candidateSig === originalSignature &&
          this.oracle.evaluate(result).reproduced
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
    };
    this.store.putFinding(record);
  }
}
