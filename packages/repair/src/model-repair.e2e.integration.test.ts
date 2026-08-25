import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "@inspector/store-sqlite";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type { Action, ReplayDriver } from "@inspector/finding";
import { OracleSuite, InvariantOracle } from "@inspector/oracle";
import { RepairEngine, ModelPatchAgent } from "@inspector/repair";
import type { PatchContext } from "@inspector/repair";
import { ModelRuntime, ScriptedModelProvider, jsonOutcome } from "@inspector/model-runtime";
import { WebReplayDriver } from "@inspector/explore";
import { SEED_HTML } from "@inspector/adapter-web";

const runGit = promisify(execFile);

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

const BOOM_PATH = [
  act("a", "fill", { selector: "#username", value: "admin" }),
  act("b", "fill", { selector: "#password", value: "admin" }),
  act("c", "click", { selector: "#loginBtn" }),
  act("d", "click", { selector: "#boom" }),
];

const LOGIN_PROBE = [
  act("p1", "fill", { selector: "#username", value: "admin" }),
  act("p2", "fill", { selector: "#password", value: "admin" }),
  act("p3", "click", { selector: "#loginBtn" }),
];

async function makeFixtureRepo(): Promise<{ repoRoot: string; revision: string }> {
  const base = mkdtempSync(join(tmpdir(), "inspector-m13-"));
  const repoRoot = join(base, "repo");
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "app.html"), SEED_HTML);
  writeFileSync(
    join(repoRoot, "app.test.html"),
    "<html><body><h1>verification fixture: DO NOT MODIFY</h1></body></html>",
  );
  const g = async (...args: string[]) => runGit("git", ["-C", repoRoot, ...args]);
  await g("init");
  await g("add", ".");
  await g("-c", "user.name=fixture", "-c", "user.email=fixture@local", "commit", "-m", "seed buggy app");
  const { stdout } = await g("rev-parse", "HEAD");
  return { repoRoot, revision: stdout.trim() };
}

function verificationSuite(): OracleSuite {
  return new OracleSuite().register(
    new InvariantOracle("page-error", (r) => r.signals.some((s) => s.kind === "PAGE_ERROR")),
  );
}

function driverForWorkspace(): (ws: { path: string }) => Promise<ReplayDriver> {
  return async (ws) => {
    const html = readFileSync(join(ws.path, "app.html"), "utf8");
    return new WebReplayDriver({ seedHtml: html });
  };
}

const FIXED_APP_HTML = SEED_HTML.replace(
  /throw new Error\("IntentionalAppCrash[^"]*"\);/,
  "// crash removed by model-proposed repair",
);

/** Deterministic scripted provider producing whole-file proposals through
 * the SAME structured contract a real provider module would implement. */
function scriptedModelPatchProvider(respondWith: () => unknown): ScriptedModelProvider {
  return new ScriptedModelProvider({
    id: "fixture-repairer",
    roles: ["repairer"],
    respond: jsonOutcome(respondWith()),
  });
}

async function confirmedFinding(repoRoot: string, revision: string, ws: string) {
  const store = Store.open(join(ws, "runs.db"));
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
  const finding = findingEngine.ingest(
    { kind: "PAGE_ERROR", detail: "IntentionalAppCrash" },
    { runId: "run", title: "boom crash", revision },
  );
  const driver = new WebReplayDriver({ seedHtml: SEED_HTML });
  const rep = await findingEngine.reproduce(finding, BOOM_PATH, driver, {
    attempts: 1,
    minSuccesses: 1,
  });
  expect(rep.finding.status).toBe("CONFIRMED");
  return { store, findingEngine, finding: rep.finding };
}

async function primaryCheckoutClean(repoRoot: string): Promise<boolean> {
  const { stdout } = await runGit("git", ["-C", repoRoot, "status", "--porcelain"]);
  return stdout.trim() === "";
}

describe("M13 F22: model-backed PatchAgent through the real repair pipeline", () => {
  it("RESOLVES a confirmed finding end-to-end with the primary checkout untouched", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m13-ws-"));
    const evidenceDir = join(ws, "evidence");
    const { store, findingEngine, finding } = await confirmedFinding(repoRoot, revision, ws);

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir,
      maxAttempts: 2,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    let sawContext: PatchContext | null = null;

    const provider = scriptedModelPatchProvider(() => ({
      rationale: "replace intentional crash with correct submit handling",
      files: [{ path: "app.html", content: FIXED_APP_HTML }],
    }));
    const innerAgent = new ModelPatchAgent({
      runtime: new ModelRuntime().register(provider),
      attribution: { findingId: finding.id, repairId: "rep_e2e" },
    });
    const agent = {
      id: "model-patch-agent",
      proposePatch: async (ctx: PatchContext) => {
        sawContext = ctx;
        return innerAgent.proposePatch(ctx);
      },
    };

    const record = await engine.repair(finding, BOOM_PATH, agent as never, {
      errorText: "IntentionalAppCrash",
      selectors: ["#boom"],
    });

    expect(record.outcome).toBe("RESOLVED");
    expect(record.attempts.some((a) => a.verdict === "ACCEPTED")).toBe(true);
    expect(record.revision ?? revision).toBe(revision);
    // The packet the model saw was bounded and relevant.
    expect(sawContext!.sourceFiles.length).toBeGreaterThan(0);
    expect(sawContext!.sourceFiles.length).toBeLessThan(10);
    // Exact revision provenance retained; primary checkout untouched.
    expect(await primaryCheckoutClean(repoRoot)).toBe(true);
    store.close();
  }, 300000);

  it("rejects an out-of-scope/traversal proposal cleanly without touching anything", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m13-esc-"));
    const { store, findingEngine, finding } = await confirmedFinding(repoRoot, revision, ws);

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir: join(ws, "evidence"),
      maxAttempts: 2,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    const provider = scriptedModelPatchProvider(() => ({
      rationale: "escape the worktree",
      files: [{ path: "../../outside.txt", content: "pwned" }],
    }));
    const agent = new ModelPatchAgent({ runtime: new ModelRuntime().register(provider) });

    const record = await engine.repair(finding, BOOM_PATH, agent, {
      errorText: "IntentionalAppCrash",
    });
    // The agent refuses to emit the unsafe proposal; the pipeline records
    // contained non-patch attempts and never modifies any checkout.
    expect(["NO_PATCH", "VERIFICATION_FAILED", "ERROR"]).toContain(record.outcome);
    expect(record.attempts.every((a) => a.patch === undefined)).toBe(true);
    expect(await primaryCheckoutClean(repoRoot)).toBe(true);
    store.close();
  }, 300000);

  it("rejects a masking/test-tampering proposal via the existing tamper policy", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m13-tamper-"));
    const { store, findingEngine, finding } = await confirmedFinding(repoRoot, revision, ws);

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir: join(ws, "evidence"),
      maxAttempts: 2,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    // The "fix": gut the verification fixture instead of repairing behavior.
    const provider = scriptedModelPatchProvider(() => ({
      rationale: "make the check stop complaining",
      files: [
        {
          path: "app.test.html",
          content: "<html><body>weakened</body></html>",
        },
        { path: "app.html", content: FIXED_APP_HTML },
      ],
    }));
    const agent = new ModelPatchAgent({ runtime: new ModelRuntime().register(provider) });

    const record = await engine.repair(finding, BOOM_PATH, agent, {
      errorText: "IntentionalAppCrash",
    });
    // The engine's P4 tamper policy rejects the proposal outright.
    expect(record.outcome).toBe("POLICY_BLOCKED");
    expect(record.attempts[0]?.verdict).toBe("REJECTED");
    expect(record.attempts[0]?.reason).toContain("test files");
    // Nothing leaked into the primary tree.
    expect(await primaryCheckoutClean(repoRoot)).toBe(true);
    store.close();
  }, 300000);
});
