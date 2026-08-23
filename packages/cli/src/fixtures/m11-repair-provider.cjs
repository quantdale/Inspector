/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const patchAgent = {
  id: "m11-fixture-provider",
  async proposePatch(context) {
    const source = context.sourceFiles.find((file) => file.path === "app.txt");
    if (!source || !source.content.includes("BAD")) return null;
    return {
      files: [{ path: "app.txt", content: source.content.replace("BAD", "GOOD") }],
      rationale: "replace the deterministic fixture defect",
    };
  },
};

const maskingProbe = [{
  id: "masking-health",
  runId: "run_m11_repair",
  environmentId: "env_m11_repair",
  kind: "healthcheck",
  risk: "observe",
  deadlineMs: 5000,
  idempotency: "safe-retry",
}];

function driverFor(workspace) {
  const path = join(workspace.path, "app.txt");
  return Promise.resolve({
    async replay(actions) {
      const broken = readFileSync(path, "utf8").includes("BAD");
      const outcomes = actions.map((action) => {
        // The acceptance proof reuses a real fake-hunt reproducer whose final
        // action is `submit`; the focused repair fixture still uses `trigger`.
      const fails = broken && action.kind !== "healthcheck";
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: fails ? "target-failure" : "success",
          observedAt: new Date().toISOString(),
          ...(fails ? { error: { code: "TARGET_FAILURE", message: "fixture defect" } } : {}),
        };
      });
      return {
        outcomes,
        // Keep the acceptance fixture useful even when minimization proves an
        // empty path: the unpatched source is the defect oracle, while the
        // healthcheck remains the benign masking probe.
        signals: broken && (actions.length === 0 || actions.some((action) => action.kind !== "healthcheck"))
          ? [{ kind: "TARGET_FAILURE", detail: "fixture defect" }]
          : [],
        observations: [],
      };
    },
  });
}

const oracle = {
  id: "fixture-target-failure",
  kind: "invariant",
  strength: "hard",
  confidence: 1,
  description: "the fixture trigger emits a target failure",
};

const oracleSuite = {
  descriptors: [oracle],
  evaluateStrict(result) {
    const matched = result.signals.some((signal) => signal.kind === "TARGET_FAILURE") ? [oracle] : [];
    return {
      reproduced: matched.length > 0,
      confidence: matched.length > 0 ? 1 : 0,
      matched,
    };
  },
};

module.exports = {
  provider: {
    patchAgent,
    driverFor,
    oracleSuite,
    maskingProbe,
    expectOracle: "TARGET_FAILURE",
  },
};
