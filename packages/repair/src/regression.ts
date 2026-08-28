import { join } from "node:path";
import type {
  Action,
  ReplayDriver,
  ReplayResult,
  RegressionScenario,
} from "@inspector/finding";
import type { OracleSuite } from "@inspector/oracle";
import type { RepairWorkspace } from "./worktree.js";
import {
  assessReplayEvidence,
  replayExceptionEvidence,
  type ReplayEvidence,
} from "./replay-evidence.js";

export interface RegressionProvenance {
  adapter?: string | null;
  backend?: string | null;
  target?: string | null;
}

export interface RegressionCheck {
  scenario: RegressionScenario;
  artifactPath: string;
  /** True when the regression FAILED (oracle fired) before any patch. */
  failedPrePatch: boolean;
  /**
   * The full pre-patch replay, retained so verification can tell a repaired
   * flow from a disabled one (masking-by-removal defense).
   */
  prePatch: ReplayResult;
  /** Typed execution evidence behind `failedPrePatch`. */
  prePatchEvidence: ReplayEvidence;
}

/**
 * Regression-first repair (M4 P2). Materializes a deterministic regression
 * scenario from the minimized reproducer and proves it FAILS against the
 * unpatched revision before any source modification is allowed.
 */
export class RegressionGenerator {
  constructor(
    private readonly opts: {
      /** Builds a replay driver for the current workspace contents. */
      driverFor: (workspace: RepairWorkspace) => Promise<ReplayDriver>;
      oracleSuite: OracleSuite;
      /**
       * Optional provenance sink for the strict evaluations performed by the
       * pre-/post-patch regression gates (wired to oracle evaluation records
       * by RepairEngine when a store-backed finding engine is available).
       */
      onEvaluation?: (
        gate: "regression-pre-patch" | "regression-post-patch",
        matchedIds: string[],
        observed: string,
      ) => void;
    },
  ) {}

  async materialize(
    workspace: RepairWorkspace,
    findingId: string,
    minimizedActions: Action[],
    expectOracle: string,
    provenance: RegressionProvenance = {},
  ): Promise<RegressionCheck> {
    const scenario: RegressionScenario = {
      schema: "inspector-regression/1",
      findingId,
      adapter: provenance.adapter ?? "unknown",
      steps: minimizedActions,
      expectOracle: expectOracle as RegressionScenario["expectOracle"],
    };
    if (provenance.backend) scenario.backend = provenance.backend;
    if (provenance.target) scenario.target = provenance.target;
    const artifactPath = join(workspace.path, "inspector-regression.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(artifactPath, JSON.stringify(scenario, null, 2), "utf8");

    const prePatchEvidence = await this.replay(
      workspace,
      minimizedActions,
      "reproduction",
      "regression-pre-patch",
    );
    const prePatch = prePatchEvidence.result ?? EMPTY_REPLAY_RESULT;

    return {
      scenario,
      artifactPath,
      failedPrePatch: prePatchEvidence.disposition === "reproduced",
      prePatch,
      prePatchEvidence,
    };
  }

  /**
   * Post-patch gate: the same scenario must now execute successfully and have
   * no hard oracle match. Operational failure is never a pass.
   */
  async passes(workspace: RepairWorkspace, steps: Action[]): Promise<ReplayEvidence> {
    return this.replay(workspace, steps, "clean", "regression-post-patch");
  }

  /** Run a replay and retain typed evidence even when the driver throws. */
  async replay(
    workspace: RepairWorkspace,
    steps: Action[],
    expectation: "reproduction" | "clean",
    gate: "regression-pre-patch" | "regression-post-patch",
  ): Promise<ReplayEvidence> {
    try {
      const driver = await this.opts.driverFor(workspace);
      const result = await driver.replay(steps);
      const verdict = this.opts.oracleSuite.evaluateStrict(result);
      this.opts.onEvaluation?.(
        gate,
        verdict.matched.map((m) => m.id),
        summarizeObserved(result),
      );
      return assessReplayEvidence(result, verdict, steps, expectation);
    } catch (err) {
      return replayExceptionEvidence(err, expectation, steps.length);
    }
  }
}

const EMPTY_REPLAY_RESULT: ReplayResult = {
  outcomes: [],
  signals: [],
  observations: [],
};

/** Compact observed-evidence summary: signal kinds and crash-class outcome
 * codes only — never free-form detail. */
function summarizeObserved(result: ReplayResult): string {
  const parts: string[] = result.signals.map((s) => s.kind);
  for (const o of result.outcomes) {
    parts.push(o.status);
    if (o.error?.code) parts.push(String(o.error.code));
  }
  return parts.length > 0 ? [...new Set(parts)].sort().join(",") : "(none)";
}
