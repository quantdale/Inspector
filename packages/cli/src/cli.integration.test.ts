import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliBin = join(here, "bin.ts");

let dir: string | null = null;
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function runCli(args: string[], workspace: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliBin, ...args, "--workspace", workspace], {
      cwd: process.cwd(),
      env: { ...process.env },
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.on("error", reject);
  });
}

describe("cli", () => {
  it("doctor passes on a clean checkout", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    const { code, stdout } = await runCli(["doctor", "--json"], dir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
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

  it("creates a durable workspace directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "inspector-cli-"));
    await runCli(["run", "--adapter", "fake"], dir);
    expect(existsSync(join(dir, ".inspector", "runs.db"))).toBe(true);
  });
});
