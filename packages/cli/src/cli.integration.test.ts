import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Store, type FindingRecord } from "@inspector/store-sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const cliBin = join(here, "bin.ts");
// Absolute tsx entry so the CLI can be spawned with a cwd outside the repo
// (workspace-resolution tests) where bare 'tsx' would not resolve.
const tsxEntry = createRequire(import.meta.url).resolve("tsx");
const tsxImportUrl = pathToFileURL(tsxEntry).href;

let dir: string | null = null;
afterEach(async () => {
  if (dir) {
    // Killed subprocesses' SQLite handles can outlive the "close" event on
    // Windows by a few hundred ms; retry removal like repair/worktree.dispose.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    dir = null;
  }
});

function runCli(
  args: string[],
  workspace: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return spawnCli([...args, "--workspace", workspace], { cwd: process.cwd() });
}

/** Spawn the CLI without forcing --workspace, for resolution/env tests. */
function spawnCli(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxImportUrl, cliBin, ...args],
      {
        cwd: opts.cwd ?? process.cwd(),
        env: { ...process.env, ...opts.env },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", reject);
  });
}

function seedFindings(dbPath: string): FindingRecord[] {
  const store = Store.open(dbPath);
  try {
    const now = new Date().toISOString();
    const records: FindingRecord[] = [
      {
        id: "find_test_1",
        runId: "run_seed_1",
        status: "CONFIRMED",
        title: "boom button crashes the app",
        confidence: 1,
        severity: "high",
        revision: null,
        oracleIds: '["page-error"]',
        reproductionJson: '{"attempts":2,"successes":2,"errors":0}',
        artifactRefs: '["sha_a","sha_b"]',
        createdAt: now,
        updatedAt: now,
        signature: "PAGE_ERROR",
        minimizationJson:
          '{"probes":3,"removals":1,"verifiedReproduction":true}',
        lastTransitionJson: null,
        adapter: "web-playwright",
      },
      {
        id: "find_test_2",
        runId: "run_seed_2",
        status: "REJECTED",
        title: "flaky candidate",
        confidence: 0,
        severity: "unknown",
        revision: null,
        oracleIds: "[]",
        reproductionJson: null,
        artifactRefs: "[]",
        createdAt: now,
        updatedAt: now,
        signature: null,
        minimizationJson: null,
        lastTransitionJson: null,
        adapter: null,
      },
    ];
    for (const r of records) store.putFinding(r);
    return records;
  } finally {
    store.close();
  }
}

describe("cli", () => {
  it("doctor passes on a clean checkout", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const { code, stdout } = await runCli(["doctor", "--json"], dir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
  });

  it("doctor reports structured probes with remediation hints", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const { code, stdout } = await runCli(["doctor", "--json"], dir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.checks)).toBe(true);
    const names = parsed.checks.map((c: { name: string }) => c.name);
    for (const expected of [
      "node >= 22",
      "workspace writable",
      "sqlite store opens",
      "fake adapter resolvable",
      "web adapter (Playwright + Chromium)",
      "pty support (@lydell/node-pty)",
      "android adb on PATH",
      "windows-uia automation",
      "electron runtime",
    ]) {
      expect(names).toContain(expected);
    }
    for (const c of parsed.checks) {
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.required).toBe("boolean");
      expect(typeof c.detail).toBe("string");
      if (!c.ok) expect(typeof c.remediation).toBe("string");
    }
    // Core probes must pass on a clean checkout.
    for (const c of parsed.checks) {
      if (c.required) expect(c.ok, c.name).toBe(true);
    }
  });

  it("rejects unknown flags with a named error on stderr", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const { code, stdout, stderr } = await runCli(
      ["doctor", "--frobnicate"],
      dir,
    );
    expect(code).toBe(1);
    expect(stderr).toContain("unknown-flag: --frobnicate");
    expect(stdout).not.toContain("--frobnicate");
  });

  it("prints the version from the root package.json", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const short = await runCli(["-v"], dir);
    const long = await runCli(["--version"], dir);
    for (const r of [short, long]) {
      expect(r.code).toBe(0);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("prints general and per-command help", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const general = await runCli(["--help"], dir);
    expect(general.code).toBe(0);
    expect(general.stdout).toContain("hunt");
    expect(general.stdout).toContain("--workspace");

    const huntHelp = await runCli(["help", "hunt"], dir);
    expect(huntHelp.code).toBe(0);
    expect(huntHelp.stdout).toContain("--max-actions");
    expect(huntHelp.stdout).toContain("--url");
  });

  it("runs a non-interactive fake demonstration and records the run", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const run = await runCli(["run", "--adapter", "fake", "--json"], dir);
    expect(run.code).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary.runId).toMatch(/^run_/);
    expect(summary.deterministicFailure).toBe("target-failure");

    const list = await runCli(["runs", "list", "--json"], dir);
    expect(list.code).toBe(0);
    const runs = JSON.parse(list.stdout);
    expect(runs.some((r: { id: string }) => r.id === summary.runId)).toBe(true);

    const show = await runCli(["runs", "show", summary.runId, "--json"], dir);
    expect(show.code).toBe(0);
    const detail = JSON.parse(show.stdout);
    expect(detail.steps.length).toBeGreaterThan(0);
  });

  it("says 'no runs recorded' instead of printing nothing", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const list = await runCli(["runs", "list"], dir);
    expect(list.code).toBe(0);
    expect(list.stdout.trim()).toBe("no runs recorded");
  });

  it("creates a durable workspace directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    await runCli(["run", "--adapter", "fake"], dir);
    expect(existsSync(join(dir, ".inspector", "runs.db"))).toBe(true);
  });

  it("lists and shows seeded findings", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    seedFindings(join(dir, ".inspector", "runs.db"));

    const list = await runCli(["findings", "list", "--json"], dir);
    expect(list.code).toBe(0);
    const findings = JSON.parse(list.stdout);
    expect(findings.map((f: { id: string }) => f.id).sort()).toEqual([
      "find_test_1",
      "find_test_2",
    ]);
    const confirmed = findings.find(
      (f: { id: string }) => f.id === "find_test_1",
    );
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.artifactRefCount).toBe(2);
    expect(confirmed.evidenceBundlePath).toBeNull();

    const filtered = await runCli(
      ["findings", "list", "--run", "run_seed_1", "--json"],
      dir,
    );
    const onlyRun1 = JSON.parse(filtered.stdout);
    expect(onlyRun1.map((f: { id: string }) => f.id)).toEqual(["find_test_1"]);

    const show = await runCli(
      ["findings", "show", "find_test_1", "--json"],
      dir,
    );
    expect(show.code).toBe(0);
    const detail = JSON.parse(show.stdout);
    expect(detail.signature).toBe("PAGE_ERROR");
    expect(detail.reproduction.attempts).toBe(2);
    expect(detail.minimization.verifiedReproduction).toBe(true);

    const missing = await runCli(
      ["findings", "show", "find_missing", "--json"],
      dir,
    );
    expect(missing.code).toBe(1);
  });

  it("hunts autonomously against the fake adapter end-to-end", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const hunt = await runCli(
      [
        "hunt",
        "--adapter",
        "fake",
        "--seed",
        "7",
        "--max-actions",
        "80",
        "--max-findings",
        "2",
        "--json",
      ],
      dir,
    );
    expect(hunt.code).toBe(0);
    const summary = JSON.parse(hunt.stdout);
    expect(summary.runId).toMatch(/^run_/);
    expect(summary.adapter).toBe("fake");
    expect(["finding-cap", "action-budget"]).toContain(summary.stoppedReason);
    expect(summary.actionsExecuted).toBeGreaterThan(0);
    expect(summary.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of summary.findings) {
      expect(f.status).toBe("CONFIRMED");
      expect(f.signature).toBe("DEFECT_SUBMIT_INVALID");
    }

    // Evidence bundles are written under <workspace>/bundles/<runId>/.
    expect(summary.bundles.length).toBe(summary.findings.length);
    for (const b of summary.bundles) {
      expect(existsSync(b.path)).toBe(true);
      expect(b.path).toContain(join(".inspector", "bundles", summary.runId));
    }

    // Findings were durably persisted through the same store.
    const list = await runCli(["findings", "list", "--json"], dir);
    const persisted = JSON.parse(list.stdout) as Array<{
      id: string;
      status: string;
    }>;
    for (const f of summary.findings) {
      expect(
        persisted.some((p) => p.id === f.id && p.status === "CONFIRMED"),
      ).toBe(true);
    }
    const firstFinding = summary.findings[0];
    const show = await runCli(
      ["findings", "show", firstFinding.id, "--json"],
      dir,
    );
    const detail = JSON.parse(show.stdout);
    expect(detail.reproduction.successes).toBeGreaterThanOrEqual(1);
    expect(detail.evidenceBundlePath).not.toBeNull();
  }, 60000);

  it("refuses to resume a closed run and resumes an interrupted one", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));

    // A terminal run has nothing to resume; refusing beats a misleading
    // half-resume that fails later with an opaque error (clean-install D1).
    const demo = await runCli(["run", "--adapter", "fake", "--json"], dir);
    expect(demo.code).toBe(0);
    const closedId = (JSON.parse(demo.stdout) as { runId: string }).runId;
    const refused = await runCli(["runs", "resume", closedId], dir);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("already closed");
    expect(refused.stdout).not.toContain("resumed");

    // Genuine interrupt: start a long fake hunt, wait until actions are
    // streaming, then hard-kill the CLI tree mid-run.
    // The action budget must exceed what the walker can exhaust during the
    // polling window (a full 400-action fake hunt completes in ~2s on a warm
    // cache, racing the kill); 20000 keeps the run live until killed.
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsxImportUrl,
        cliBin,
        "hunt",
        "--adapter",
        "fake",
        "--max-actions",
        "20000",
        "--max-minutes",
        "5",
        "--json",
        "--workspace",
        dir,
      ],
      { cwd: process.cwd(), env: { ...process.env }, stdio: "ignore" },
    );
    // Wait until the hunt is past initialization and executing actions.
    const dbPath = join(dir, ".inspector", "runs.db");
    let midRun = false;
    for (let i = 0; i < 60 && !midRun; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!existsSync(dbPath)) continue;
      let probe;
      try {
        probe = Store.open(dbPath);
        const runs = probe.listRuns(5);
        const active = runs.find(
          (r) =>
            r.status !== "closed" &&
            r.status !== "failed" &&
            r.status !== "crashed",
        );
        if (active && probe.getRunSteps(active.id).length >= 3) midRun = true;
      } catch {
        // db locked/absent mid-write; retry
      } finally {
        probe?.close();
      }
    }
    expect(midRun).toBe(true);
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGKILL");
    }
    await new Promise((resolve) => child.once("close", resolve));

    // Find the non-terminal run left behind by the kill.
    const wsStore = Store.open(dbPath);
    let interruptedId: string | undefined;
    try {
      const active = wsStore
        .listRuns(5)
        .find(
          (r) =>
            r.status !== "closed" &&
            r.status !== "failed" &&
            r.status !== "crashed",
        );
      interruptedId = active?.id;
    } finally {
      wsStore.close();
    }
    expect(interruptedId).toBeTruthy();

    // Resume re-attaches, re-observes, and reports an honest final state.
    const resumed = await runCli(["runs", "resume", interruptedId!], dir);
    expect(
      resumed.code,
      `resume failed (stderr: ${resumed.stderr} stdout: ${resumed.stdout})`,
    ).toBe(0);
    expect(resumed.stdout).toContain(`resumed ${interruptedId}`);
    expect(resumed.stdout).toContain("final status:");
  }, 90000);

  it("resolves $INSPECTOR_WORKSPACE when --workspace is absent", async () => {
    const envWs = mkdtempSync(join(tmpdir(), "inspector-cli-envws-"));
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    try {
      const run = await spawnCli(["run", "--adapter", "fake", "--json"], {
        cwd: dir, // NOT the workspace; env must win over the process cwd
        env: {
          INSPECTOR_WORKSPACE: envWs,
          TSX_TSCONFIG_PATH: join(here, "..", "..", "..", "tsconfig.json"),
        },
      });
      expect(run.code).toBe(0);
      expect(existsSync(join(envWs, ".inspector", "runs.db"))).toBe(true);
    } finally {
      rmSync(envWs, { recursive: true, force: true });
    }
  }, 60000);

  it("warns on stderr when the resolved workspace is a repository root", async () => {
    const repo = mkdtempSync(join(tmpdir(), "inspector-cli-repo-"));
    dir = repo;
    mkdirSync(join(repo, "packages"), { recursive: true });
    mkdirSync(join(repo, ".inspector", "state"), { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}");
    writeFileSync(
      join(repo, ".inspector", "state", "campaign.yaml"),
      "mode: IMPLEMENTATION\n",
    );
    const human = await spawnCli(["doctor"], {
      cwd: repo,
      env: { TSX_TSCONFIG_PATH: join(here, "..", "..", "..", "tsconfig.json") },
    });
    expect(human.stderr).toContain(
      "warning: using repository-root workspace; pass --workspace <dir> to isolate runs",
    );
    // Under --json the warning moves into the payload instead of stderr.
    const json = await spawnCli(["doctor", "--json"], {
      cwd: repo,
      env: { TSX_TSCONFIG_PATH: join(here, "..", "..", "..", "tsconfig.json") },
    });
    expect(json.stderr).not.toContain("repository-root workspace");
    const parsed = JSON.parse(json.stdout);
    expect(parsed.warning).toContain("--workspace <dir> to isolate");
  }, 60000);

  it("keeps two concurrent hunts in two workspaces fully isolated", async () => {
    const wsA = mkdtempSync(join(tmpdir(), "inspector-cli-wsa-"));
    const wsB = mkdtempSync(join(tmpdir(), "inspector-cli-wsb-"));
    dir = wsA;
    try {
      const args = [
        "hunt",
        "--adapter",
        "fake",
        "--seed",
        "7",
        "--max-actions",
        "60",
        "--max-findings",
        "2",
        "--json",
      ];
      const [a, b] = await Promise.all([runCli(args, wsA), runCli(args, wsB)]);
      // Sharing one runs.db would crash at least one hunt with
      // UNIQUE constraint failed: actions.idempotency.
      expect(a.code, a.stderr).toBe(0);
      expect(b.code, b.stderr).toBe(0);
      const runIdA = (JSON.parse(a.stdout) as { runId: string }).runId;
      const runIdB = (JSON.parse(b.stdout) as { runId: string }).runId;
      expect(runIdA).not.toBe(runIdB);
      expect(existsSync(join(wsA, ".inspector", "runs.db"))).toBe(true);
      expect(existsSync(join(wsB, ".inspector", "runs.db"))).toBe(true);

      // Each store only knows its own run.
      for (const [ws, own, other] of [
        [wsA, runIdA, runIdB],
        [wsB, runIdB, runIdA],
      ] as const) {
        const list = await runCli(["runs", "list", "--json"], ws);
        const ids = (JSON.parse(list.stdout) as Array<{ id: string }>).map(
          (r) => r.id,
        );
        expect(ids).toContain(own);
        expect(ids).not.toContain(other);
      }
    } finally {
      rmSync(wsB, { recursive: true, force: true });
    }
  }, 120000);
});
