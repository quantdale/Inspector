import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "@inspector/store-sqlite";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type { Action, ReplayDriver } from "@inspector/finding";
import { OracleSuite, InvariantOracle, classifySuspicion } from "@inspector/oracle";
import { RepairEngine, ScriptedPatchAgent } from "@inspector/repair";
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

async function makeFixtureRepo(): Promise<{
  repoRoot: string;
  revision: string;
}> {
  const base = mkdtempSync(join(tmpdir(), "inspector-m4-"));
  const repoRoot = join(base, "repo");
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "app.html"), SEED_HTML);
  const g = async (...args: string[]) =>
    runGit("git", ["-C", repoRoot, ...args]);
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

describe("M4 autonomous repair", () => {
  it("repairs a confirmed seeded defect end-to-end in an isolated worktree", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m4-ws-"));
    const store = Store.open(join(ws, "runs.db"));
    const evidenceDir = join(ws, "evidence");

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

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir,
      maxAttempts: 2,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    const goodAgent = new ScriptedPatchAgent("good-fixer", [
      {
        apply: (_path, content) => {
          if (!content.includes("IntentionalAppCrash")) return null;
          return content.replace(
            /throw new Error\("IntentionalAppCrash[^"]*"\);/,
            "// crash removed by repair",
          );
        },
      },
    ]);

    const record = await engine.repair(rep.finding, BOOM_PATH, goodAgent, {
      errorText: "IntentionalAppCrash",
      selectors: ["#boom"],
    });

    expect(record.outcome).toBe("RESOLVED");
    expect(record.attempts.some((a) => a.verdict === "ACCEPTED")).toBe(true);
    expect(rep.finding.status).toBe("RESOLVED");
    expect(existsSync(join(evidenceDir, `repair-${rep.finding.id}.json`))).toBe(true);

    // Oracle provenance: verification-phase evaluations are persisted.
    const evals = store.listOracleEvaluationsForFinding(rep.finding.id);
    const repairVerify = evals.filter((e) => e.phase === "repair-verify");
    expect(repairVerify.length).toBeGreaterThan(0);
    // Pre-patch regression gate (must fail) and post-patch gates (must pass).
    expect(repairVerify.some((e) => e.expected?.includes("unpatched") && e.reproduced)).toBe(true);
    expect(
      repairVerify.some(
        (e) =>
          e.expected === "post-patch reproducer replay fires no hard oracle" && !e.reproduced,
      ),
    ).toBe(true);
    expect(repairVerify.every((e) => e.oracleId === "page-error")).toBe(true);
    expect(repairVerify[0]!.oracleStrength).toBe("hard");

    // Repair happened outside the primary checkout: the fixture repo is untouched.
    const { stdout } = await runGit("git", ["-C", repoRoot, "status", "--porcelain"]);
    expect(stdout.trim()).toBe("");

    store.close();
  }, 300000);

  it("rejects and rolls back a bad patch, preserving the audit trail", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m4-bad-"));
    const store = Store.open(join(ws, "runs.db"));
    const evidenceDir = join(ws, "evidence");

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

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir,
      maxAttempts: 1,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    // Broken agent: wipes the app instead of fixing it. The reproducer stops
    // firing only because the whole UI is gone -> masking probe catches it.
    const badAgent = new ScriptedPatchAgent("wrecker", [
      { apply: () => "<html><body>wrecked</body></html>" },
    ]);

    const record = await engine.repair(rep.finding, BOOM_PATH, badAgent, {
      errorText: "IntentionalAppCrash",
    });

    expect(record.outcome).toBe("VERIFICATION_FAILED");
    expect(record.attempts[0]?.verdict).toBe("REJECTED");
    // Finding falls back to CONFIRMED (still valid, unpatched).
    expect(rep.finding.status).toBe("CONFIRMED");

    store.close();
  }, 300000);

  it("policy-blocks weak-suspicion findings from entering repair", async () => {
    const { repoRoot, revision } = await makeFixtureRepo();
    const ws = mkdtempSync(join(tmpdir(), "inspector-m4-pol-"));
    const store = Store.open(join(ws, "runs.db"));
    const findingEngine = new FindingEngine(OracleEngine.defaults(), store);

    // Uncorroborated LLM suspicion must be held at NEEDS_HUMAN_ORACLE...
    expect(classifySuspicion({ source: "llm", confidence: 0.99, summary: "looks wrong" }, false)).toBe(
      "NEEDS_HUMAN_ORACLE",
    );

    const finding = findingEngine.ingest(
      { kind: "DEFECT_SUBMIT_INVALID", detail: "llm suspicion only" },
      { runId: "run", title: "suspicious", revision },
    );
    // Simulate the weak-signal lifecycle: CANDIDATE -> NEEDS_HUMAN_ORACLE.
    findingEngine.transition(finding, "NEEDS_HUMAN_ORACLE");

    const engine = new RepairEngine(findingEngine, {
      repoRoot,
      revision,
      evidenceDir: join(ws, "evidence"),
      maxAttempts: 1,
      driverFor: driverForWorkspace(),
      oracleSuite: verificationSuite(),
      maskingProbe: LOGIN_PROBE,
    });

    const record = await engine.repair(finding, BOOM_PATH, new ScriptedPatchAgent("any", []));
    expect(record.outcome).toBe("POLICY_BLOCKED");
    // The block itself is preserved as an aborted audit entry.
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0]?.verdict).toBe("ABORTED");
    expect(finding.status).toBe("NEEDS_HUMAN_ORACLE");

    store.close();
  }, 120000);
});
