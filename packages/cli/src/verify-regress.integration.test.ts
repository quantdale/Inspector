import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "./args.js";
import { verifyCommand } from "./verify.js";
import { regressCommand } from "./regress.js";
import { openWorkspace, type Workspace } from "./workspace.js";
import { FindingEngine, FakeStateMachineDriver, OracleEngine } from "@inspector/finding";
import type { Action } from "@inspector/protocol";

describe("M11 verify/regress workflows", () => {
  let root: string | undefined;
  let workspace: Workspace | undefined;

  afterEach(() => {
    workspace?.store.close();
    workspace = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("replays a durable fake finding, persists verification, and reports a reproduced regression", async () => {
    root = mkdtempSync(join(tmpdir(), "inspector-m11-cli-"));
    workspace = openWorkspace(root);
    const runId = "run_m11_verify";
    workspace.store.createRun({ id: runId, adapter: "adapter-fake" });
    workspace.store.createEnvironment({ id: "env_m11_verify", runId, adapter: "adapter-fake" });
    workspace.store.setRunStatus(runId, "closed");

    const actions = [
      action("openForm", runId),
      action("fillField", runId, { name: "default", value: "BAD" }),
      action("submit", runId),
    ];
    const engine = new FindingEngine(OracleEngine.defaults(), workspace.store);
    let finding = engine.ingest(
      { kind: "DEFECT_SUBMIT_INVALID", detail: "seeded failure" },
      { runId, adapter: "adapter-fake", classKey: "DEFECT_SUBMIT_INVALID:seeded" },
    );
    const reproduced = await engine.reproduce(finding, actions, new FakeStateMachineDriver(), {
      attempts: 1,
      minSuccesses: 1,
    });
    finding = reproduced.finding;
    const minimized = await engine.minimize(finding, actions, new FakeStateMachineDriver());
    if (finding.status === "MINIMIZED") finding = engine.transition(finding, "CONFIRMED");
    const bundle = engine.buildBundle(finding, actions, minimized, { signals: reproduced.lastSignals });
    const bundleDir = join(workspace.base, "bundles", runId);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, `${finding.id}.json`), JSON.stringify(bundle), "utf8");

    const output: string[] = [];
    const ctx = {
      baseCwd: root,
      json: true,
      out: (line: string) => output.push(line),
      progress: () => undefined,
    };
    const verification = await verifyCommand(
      parseArgs([finding.id, "--workspace", root, "--json"], ["--attempts", "--min-successes", "--timeout-ms", "--revision"], []),
      ctx,
    );
    expect(verification.code).toBe(2);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({
      schema: "inspector-cli/verify/1",
      result: { classification: "reproduced", successes: 2 },
    });
    expect(workspace.store.getLatestVerificationRecord(finding.id)?.classification).toBe("reproduced");

    const regressionOutput: string[] = [];
    const regression = await regressCommand(
      parseArgs(["--finding", finding.id, "--workspace", root, "--json"], ["--run", "--finding", "--adapter", "--revision", "--attempts", "--min-successes", "--limit"], []),
      { ...ctx, out: (line: string) => regressionOutput.push(line) },
    );
    expect(regression.code).toBe(2);
    expect(JSON.parse(regressionOutput.at(-1)!)).toMatchObject({
      schema: "inspector-cli/regress/1",
      counts: { reproducedRegression: 1 },
    });
  });

  it("refuses verification when the minimized evidence bundle is missing", async () => {
    root = mkdtempSync(join(tmpdir(), "inspector-m11-invalid-"));
    workspace = openWorkspace(root);
    const runId = "run_m11_invalid";
    workspace.store.createRun({ id: runId, adapter: "adapter-fake" });
    workspace.store.createEnvironment({ id: "env_m11_invalid", runId, adapter: "adapter-fake" });
    const engine = new FindingEngine(OracleEngine.defaults(), workspace.store);
    const finding = engine.ingest(
      { kind: "TARGET_FAILURE", detail: "missing evidence" },
      { runId, adapter: "adapter-fake" },
    );
    const output: string[] = [];
    const result = await verifyCommand(
      parseArgs([finding.id, "--workspace", root, "--json"], ["--attempts", "--min-successes", "--timeout-ms", "--revision"], []),
      { baseCwd: root, json: true, out: (line: string) => output.push(line), progress: () => undefined },
    );
    expect(result.code).toBe(4);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({
      result: { classification: "invalid-provenance" },
    });
  });
});

function action(kind: string, runId: string, input?: Record<string, unknown>): Action {
  const suffix = actionSequence++;
  return {
    id: `act_${kind}_${suffix}`,
    runId,
    environmentId: `env_${runId}`,
    kind,
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input,
  };
}

let actionSequence = 0;
