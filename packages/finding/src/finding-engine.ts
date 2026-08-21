import { newId } from "@inspector/protocol";
import type { Store, FindingRecord, FindingStatus } from "@inspector/store-sqlite";
import { OracleEngine } from "./engine.js";
import type {
  Action,
  Finding,
  OracleSignal,
  OracleSignalKind,
  ReplayDriver,
  ReproductionPolicy,
  ReproductionStats,
  EvidenceBundle,
  RegressionScenario,
} from "./types.js";

const VALID_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OBSERVED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["REPRODUCING", "REJECTED", "FLAKY", "CONFIRMED", "NEEDS_HUMAN_ORACLE"],
  REPRODUCING: ["MINIMIZED", "CONFIRMED", "FLAKY", "REJECTED"],
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

// PART2

export class FindingEngine {
  constructor(
    private readonly oracle: OracleEngine = OracleEngine.defaults(),
    private readonly store?: Store,
  ) {}

  ingest(
    signal: OracleSignal,
    opts: { runId?: string; title?: string; revision?: string } = {},
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
      oracleIds: this.oracle.ids,
      reproduction: null,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.persist(finding);
    return finding;
  }

  transition(finding: Finding, next: FindingStatus): Finding {
    const allowed = VALID_TRANSITIONS[finding.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`invalid finding transition ${finding.status} -> ${next}`);
    }
    finding.status = next;
    finding.updatedAt = new Date().toISOString();
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
    this.transition(finding, "REPRODUCING");
    let successes = 0;
    let lastSignals: OracleSignal[] = [];
    for (let i = 0; i < policy.attempts; i++) {
      const result = await driver.replay(actions);
      lastSignals = result.signals;
      if (this.oracle.evaluate(result).reproduced) successes += 1;
    }
    const stats: ReproductionStats = { attempts: policy.attempts, successes };
    finding.reproduction = stats;
    finding.confidence = successes / policy.attempts;
    if (successes >= policy.minSuccesses) {
      finding.severity = successes === policy.attempts ? "high" : "medium";
      this.transition(finding, "CONFIRMED");
    } else if (successes === 0) {
      this.transition(finding, "REJECTED");
    } else {
      this.transition(finding, "FLAKY");
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
    // bounded: when the replay budget is exhausted the best sequence found so
    // far is returned (still a reproducer).
    let replaysLeft = opts.maxReplays ?? 20;
    let current = actions.slice();
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
        if (this.oracle.evaluate(result).reproduced) {
          current = candidate;
          changed = true;
          break;
        }
      }
    }
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
    opts: { revision?: string; environment?: Record<string, unknown>; replayCommand?: string } = {},
  ): EvidenceBundle {
    return {
      schema: "inspector-evidence/1",
      finding,
      revision: opts.revision ?? finding.revision,
      environment: opts.environment ?? {},
      originalSteps: original,
      minimizedSteps: minimized,
      oracleEvidence: [],
      artifactRefs: finding.artifactRefs,
      replayCommand: opts.replayCommand ?? `inspector replay --finding ${finding.id}`,
    };
  }

  exportRegression(
    finding: Finding,
    minimized: Action[],
    expectOracle: OracleSignalKind,
  ): RegressionScenario {
    return {
      schema: "inspector-regression/1",
      findingId: finding.id,
      adapter: "adapter-fake",
      steps: minimized,
      expectOracle,
    };
  }

  // PART5

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
    };
    this.store.putFinding(record);
  }
}




