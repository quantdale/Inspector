import { join } from "node:path";
import type {
  Action,
  ReplayDriver,
  ReplayResult,
  RegressionScenario,
} from "@inspector/finding";
import type { OracleSuite } from "@inspector/oracle";
import type { RepairWorkspace } from "./worktree.js";

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
    },
  ) {}

  async materialize(
    workspace: RepairWorkspace,
    findingId: string,
    minimizedActions: Action[],
    expectOracle: string,
  ): Promise<RegressionCheck> {
    const scenario: RegressionScenario = {
      schema: "inspector-regression/1",
      findingId,
      adapter: "adapter-web",
      steps: minimizedActions,
      expectOracle: expectOracle as RegressionScenario["expectOracle"],
    };
    const artifactPath = join(workspace.path, "inspector-regression.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(artifactPath, JSON.stringify(scenario, null, 2), "utf8");

    const driver = await this.opts.driverFor(workspace);
    const result = await driver.replay(minimizedActions);
    const failedPrePatch = this.opts.oracleSuite.evaluate(result).reproduced;

    return { scenario, artifactPath, failedPrePatch, prePatch: result };
  }

  /**
   * Post-patch gate: the same scenario must now PASS (no oracle fires).
   * Returns true when the regression passes.
   */
  async passes(workspace: RepairWorkspace, steps: Action[]): Promise<boolean> {
    const driver = await this.opts.driverFor(workspace);
    const result = await driver.replay(steps);
    return !this.opts.oracleSuite.evaluate(result).reproduced;
  }
}
