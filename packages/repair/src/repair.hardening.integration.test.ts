import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type { Action, ReplayDriver, ReplayResult } from "@inspector/finding";
import { OracleSuite, InvariantOracle } from "@inspector/oracle";
import { RepairEngine } from "./engine.js";
import type { Patch, PatchAgent, PatchContext, RepairRecord } from "./types.js";

const runGit = promisify(execFile);

function act(id: string, kind: string): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input: {},
  } as Action;
}

const BOOM = [act("b1", "boom")];
const PROBE = [act("p1", "probe")];

function outcome(status: string) {
  return {
    actionId: "x",
    runId: "run",
    environmentId: "env",
    status: status as "success" | "target-failure",
    observedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic fake target: verdicts depend on a `sentinel.json` file inside
 * the workspace, so patches have real, observable effect without a browser.
 *  - reproducer ("boom") fires PAGE_ERROR until sentinel says FIXED;
 *  - masking probe fails only when the app was wrecked.
 */
class SentinelDriver implements ReplayDriver {
  constructor(protected readonly root: string) {}
  async replay(actions: Action[]): Promise<ReplayResult> {
    let sentinel = "";
    try {
      sentinel = readFileSync(join(this.root, "sentinel.json"), "utf8");
    } catch {
      /* unpatched workspace */
    }
    if (actions.every((a) => a.kind === "probe")) {
      return sentinel.includes("WRECKED")
        ? { outcomes: [outcome("target-failure")], signals: [{ kind: "TARGET_FAILURE" }], observations: [] }
        : { outcomes: [outcome("success")], signals: [], observations: [] };
    }
    if (sentinel.includes("FIXED")) {
      return { outcomes: [outcome("success")], signals: [], observations: [] };
    }
    return {
      outcomes: [outcome("success")],
      signals: [{ kind: "PAGE_ERROR", detail: "seeded bug" }],
      observations: [],
    };
  }
}

/** Probe that is broken regardless of any patch (invalid instrumentation). */
class AlwaysBrokenProbeDriver extends SentinelDriver {
  override async replay(actions: Action[]): Promise<ReplayResult> {
    const result = await super.replay(actions);
    if (actions.every((a) => a.kind === "probe")) {
      result.signals.push({ kind: "TARGET_FAILURE" });
    }
    return result;
  }
}

function verificationSuite(): OracleSuite {
  return new OracleSuite().register(
    new InvariantOracle("page-error", (r) => r.signals.some((s) => s.kind === "PAGE_ERROR")),
  );
}

async function makeRepo(): Promise<{ repoRoot: string; revision: string }> {
  const base = mkdtempSync(join(tmpdir(), "inspector-harden-repo-"));
  const repoRoot = join(base, "repo");
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "app.txt"), "BUG\n");
  const g = async (...args: string[]) => runGit("git", ["-C", repoRoot, ...args]);
  await g("init");
  await g("add", ".");
  await g("-c", "user.name=fixture", "-c", "user.email=fixture@local", "commit", "-m", "seed");
  const { stdout } = await g("rev-parse", "HEAD");
  return { repoRoot, revision: stdout.trim() };
}

function confirmedFinding(revision: string): {
  engine: FindingEngine;
  finding: ReturnType<FindingEngine["ingest"]>;
} {
  const engine = new FindingEngine(OracleEngine.defaults());
  const finding = engine.ingest(
    { kind: "PAGE_ERROR", detail: "seeded bug" },
    { runId: "run", title: "boom", revision },
  );
  engine.transition(finding, "CONFIRMED");
  return { engine, finding };
}

function makeEngine(
  findingEngine: FindingEngine,
  repoRoot: string,
  revision: string,
  evidenceDir: string,
  extra: Partial<ConstructorParameters<typeof RepairEngine>[1]> = {},
): RepairEngine {
  return new RepairEngine(findingEngine, {
    repoRoot,
    revision,
    evidenceDir,
    driverFor: async (ws) => new SentinelDriver(ws.path),
    oracleSuite: verificationSuite(),
    maskingProbe: PROBE,
    ...extra,
  });
}

const fixingAgent: PatchAgent = {
  id: "fixer",
  async proposePatch(): Promise<Patch> {
    return {
      files: [{ path: "sentinel.json", content: '{"state":"FIXED"}' }],
      rationale: "fix the seeded bug",
    } as Patch;
  },
};

describe("repair hardening", () => {
  it("D1: hostile patch agent cannot escape the worktree through the engine", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = join(tmpdir(), "inspector-harden-ev-d1");
    const probeDir = mkdtempSync(join(tmpdir(), "inspector-harden-d1-"));
    const absTarget = join(probeDir, "evil.txt");

    const hostile: PatchAgent = {
      id: "escape-artist",
      async proposePatch(ctx: PatchContext) {
        void ctx;
        return {
          files: [
            { path: "../escape.txt", content: "pwned" },
            { path: absTarget, content: "pwned-abs" },
            { path: "../../.git/hooks/pre-commit", content: "#!/bin/sh\nexit 1\n" },
          ],
          rationale: "totally legit",
        } as Patch;
      },
    };

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir);
    const record = await eng.repair(finding, BOOM, hostile);

    expect(record.outcome).toBe("POLICY_BLOCKED");
    expect(record.attempts[0]?.verdict).toBe("REJECTED");
    expect(record.attempts[0]?.reason).toMatch(/source-write policy/);
    // nothing landed outside the (disposed) worktree
    expect(existsSync(absTarget)).toBe(false);
    expect(existsSync(join(repoRoot, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "..", "escape.txt"))).toBe(false);
  });

  it("D3: mid-pipeline throw restores CONFIRMED and persists an audit record", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d3-"));

    const thrower: PatchAgent = {
      id: "thrower",
      async proposePatch(): Promise<Patch | null> {
        throw new Error("model exploded");
      },
    };

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, { maxAttempts: 2 });
    const record: RepairRecord = await eng.repair(finding, BOOM, thrower);

    expect(record.outcome).toBe("VERIFICATION_FAILED");
    expect(finding.status).toBe("CONFIRMED");
    expect(existsSync(join(evidenceDir, `repair-${finding.id}.json`))).toBe(true);
  });

  it("D3: replay crash after patch is contained per attempt, not stranded in PATCHING", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d3b-"));

    // Reproducer replays crash only once a patch has been applied.
    class CrashingPostPatchDriver extends SentinelDriver {
      override async replay(actions: Action[]): Promise<ReplayResult> {
        const patched = existsSync(join(this.root, "sentinel.json"));
        if (patched && !actions.every((a) => a.kind === "probe")) {
          throw new Error("replay exploded mid-pipeline");
        }
        return super.replay(actions);
      }
    }

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, {
      maxAttempts: 1,
      driverFor: async (ws) => new CrashingPostPatchDriver(ws.path),
    });

    const record = await eng.repair(finding, BOOM, fixingAgent);
    expect(record.outcome).toBe("VERIFICATION_FAILED");
    expect(record.attempts[0]?.verdict).toBe("ABORTED");
    expect(record.attempts[0]?.reason).toMatch(/attempt 1 failed/);
    expect(finding.status).toBe("CONFIRMED");
    expect(existsSync(join(evidenceDir, `repair-${finding.id}.json`))).toBe(true);
  });

  it("D3: pipeline-level failure persists an ERROR record and keeps the finding recoverable", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d3c-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, {
      driverFor: async () => {
        throw new Error("driver factory exploded");
      },
    });

    const record: RepairRecord = await eng.repair(finding, BOOM, fixingAgent);
    expect(record.outcome).toBe("ERROR");
    expect(record.attempts.some((a) => (a.reason ?? "").includes("driver factory exploded"))).toBe(true);
    expect(finding.status).toBe("CONFIRMED");
    expect(existsSync(join(evidenceDir, `repair-${finding.id}.json`))).toBe(true);
  });

  it("D4: accepted patch and regression evidence survive dispose; worktree identity recorded", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d4-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir);
    const record = await eng.repair(finding, BOOM, fixingAgent);

    expect(record.outcome).toBe("RESOLVED");
    // regression artifact must exist AFTER the workspace was disposed
    expect(record.regressionArtifact).toBeDefined();
    expect(existsSync(record.regressionArtifact as string)).toBe(true);
    const scenario = JSON.parse(readFileSync(record.regressionArtifact as string, "utf8"));
    expect(scenario.findingId).toBe(finding.id);
    // full accepted patch embedded for audit
    const accepted = record.attempts.find((a) => a.verdict === "ACCEPTED");
    expect(accepted?.patch?.files?.[0]?.content).toContain("FIXED");
    // actual worktree identity, not the primary checkout
    expect(record.workspacePath).not.toBe(repoRoot);
    expect(record.workspacePath).toContain("inspector-repair-");
    expect(record.worktreeCommit).toBe(revision);
  });

  it("D6a: rejects patches that tamper with test files unless allow-listed", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6a-"));

    const tamperer: PatchAgent = {
      id: "tamperer",
      async proposePatch(): Promise<Patch> {
        return {
          files: [
            { path: "sentinel.json", content: '{"state":"FIXED"}' },
            { path: "src/app.test.ts", content: "it('now passes', () => {});\n" },
          ],
          rationale: "fix + quietly weaken the test",
        } as Patch;
      },
    };

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir);
    const record = await eng.repair(finding, BOOM, tamperer);
    expect(record.outcome).toBe("POLICY_BLOCKED");
    expect(record.attempts[0]?.verdict).toBe("REJECTED");
    expect(record.attempts[0]?.reason).toMatch(/test file/i);
    // rejected attempts keep the full patch content for audit
    expect(record.attempts[0]?.patch?.files.map((f) => f.path)).toContain("src/app.test.ts");
    expect(finding.status).toBe("CONFIRMED");
  });

  it("D6a: allow-listed test paths are still patchable", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6a2-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, {
      allowedTestPaths: ["src/app.test.ts"],
    });
    const record = await eng.repair(finding, BOOM, fixingAgent);
    expect(record.outcome).toBe("RESOLVED");
  });

  it("D6b: probe failing on the unpatched revision yields PROBE_INVALID, not blamed patches", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6b-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, {
      driverFor: async (ws) => new AlwaysBrokenProbeDriver(ws.path),
    });

    const record = await eng.repair(finding, BOOM, fixingAgent);
    expect(record.outcome).toBe("PROBE_INVALID");
    expect(finding.status).toBe("CONFIRMED");
    // no patch attempt may be blamed for an invalid probe
    expect(record.attempts.filter((a) => a.agentId !== "engine")).toHaveLength(0);
  });

  it("D6c: agent returning no patch within budget yields NO_PATCH", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6c-"));

    const lazy: PatchAgent = {
      id: "lazy",
      async proposePatch(): Promise<Patch | null> {
        return null;
      },
    };

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, { maxAttempts: 2 });
    const record = await eng.repair(finding, BOOM, lazy);
    expect(record.outcome).toBe("NO_PATCH");
    // two agent attempts plus the engine's budget-exhausted audit entry
    expect(record.attempts.filter((a) => a.agentId !== "engine")).toHaveLength(2);
    expect(record.attempts[record.attempts.length - 1]?.reason).toMatch(/budget exhausted/);
    expect(finding.status).toBe("CONFIRMED");
  });

  it("D6c: empty-file patch counts as NO_PATCH too", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6c2-"));

    const empty: PatchAgent = {
      id: "empty",
      async proposePatch(): Promise<Patch | null> {
        return { files: [], rationale: "no idea" } as Patch;
      },
    };

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir, { maxAttempts: 1 });
    const record = await eng.repair(finding, BOOM, empty);
    expect(record.outcome).toBe("NO_PATCH");
  });

  it("D6d: regression scenario derives its expected oracle from the repair hints", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d6d-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir);
    const record = await eng.repair(finding, BOOM, fixingAgent, {
      expectOracle: "DEFECT_SUBMIT_INVALID",
    });

    expect(record.outcome).toBe("RESOLVED");
    const scenario = JSON.parse(readFileSync(record.regressionArtifact as string, "utf8"));
    expect(scenario.expectOracle).toBe("DEFECT_SUBMIT_INVALID");
  });

  it("D4: applyAcceptedPatch materializes the accepted patch into a target checkout on explicit request", async () => {
    const { repoRoot, revision } = await makeRepo();
    const { engine: fe, finding } = confirmedFinding(revision);
    const evidenceDir = mkdtempSync(join(tmpdir(), "inspector-harden-ev-d4b-"));

    const eng = makeEngine(fe, repoRoot, revision, evidenceDir);
    const record = await eng.repair(finding, BOOM, fixingAgent);
    expect(record.outcome).toBe("RESOLVED");

    const target = mkdtempSync(join(tmpdir(), "inspector-harden-target-"));
    const written = await eng.applyAcceptedPatch(record, target);
    expect(written).toEqual(["sentinel.json"]);
    expect(readFileSync(join(target, "sentinel.json"), "utf8")).toContain("FIXED");

    // traversal via the record is refused at apply time
    const evilRecord = {
      findingId: "find_x",
      attempts: [
        {
          index: 1,
          agentId: "evil",
          verdict: "ACCEPTED",
          filesTouched: ["../outside.txt"],
          at: new Date().toISOString(),
          patch: { files: [{ path: "../outside.txt", content: "pwn" }], rationale: "pwn" },
        },
      ],
    } as unknown as RepairRecord;
    await expect(eng.applyAcceptedPatch(evilRecord, target)).rejects.toThrow();
    expect(existsSync(join(target, "..", "outside.txt"))).toBe(false);
  });
});
