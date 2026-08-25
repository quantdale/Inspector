import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliBin = join(here, "bin.ts");
const tsxEntry = createRequire(import.meta.url).resolve("tsx");
const tsxImportUrl = pathToFileURL(tsxEntry).href;

let dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  }
  dirs = [];
});

function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-m13-cli-"));
  dirs.push(dir);
  return dir;
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const workspace = dirs[dirs.length - 1]!;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxImportUrl, cliBin, ...args, "--workspace", workspace],
      { cwd: process.cwd(), env: { ...process.env } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", reject);
  });
}

/** A trusted local provider module exactly as an operator would ship one. */
const PROVIDER_MODULE = `
export function createModelProviders() {
  return [
    {
      meta: { id: "fixture-offline", modelId: "fixture-small", roles: ["planner"], priority: 10 },
      healthy: () => true,
      invoke: async (invocation) => ({ text: JSON.stringify({ actionKey: null, confidence: 0 }), usage: { totalChargedTokens: 11 } }),
    },
  ];
}
`;

describe("M13 F13/F24: CLI model configuration and inspection surface", () => {
  it("loads a local deterministic provider module and completes a fake hunt unchanged", async () => {
    const workspace = fresh();
    const providerPath = join(workspace, "fixture-provider.mjs");
    writeFileSync(providerPath, PROVIDER_MODULE);
    // Fake exploration stays deterministic even with a provider loaded.
    const result = await runCli([
      "hunt",
      "--adapter",
      "fake",
      "--max-actions",
      "6",
      "--json",
      "--model-provider",
      providerPath,
    ]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.schema).toBe("inspector-cli/hunt/1");
    expect(payload.ok).toBe(true);
  }, 120000);

  it("fails with stable classifications for malformed providers and orphaned flags", async () => {
    const workspace = fresh();
    writeFileSync(join(workspace, "broken.mjs"), "export default { not: 'a provider' };");
    const badModule = await runCli(["hunt", "--adapter", "fake", "--max-actions", "2", "--planner", "--json", "--model-provider", join(workspace, "broken.mjs")]);
    expect(badModule.code).toBe(4);
    expect(JSON.parse(badModule.stdout).error.kind).toBe("invalid-provider");

    const noProvider = await runCli(["hunt", "--adapter", "fake", "--max-actions", "2", "--planner", "--json"]);
    expect(noProvider.code).toBe(4);
    expect(JSON.parse(noProvider.stdout).error.kind).toBe("provider-required");

    const missingFile = await runCli(["hunt", "--adapter", "fake", "--max-actions", "2", "--planner", "--json", "--model-provider", join(workspace, "missing.mjs")]);
    expect(missingFile.code).toBe(4);
    expect(JSON.parse(missingFile.stdout).error.kind).toBe("provider-load-failed");
  }, 180000);

  it("models summary reports the durable aggregate truthfully on an empty store", async () => {
    fresh();
    const result = await runCli(["models", "summary", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.schema).toBe("inspector-cli/models/1");
    expect(payload.summary.attempts).toBe(0);
    expect(payload.summary.inputTokens).toBeNull();
    expect(payload.summary.costUsd).toBeNull();
    expect(payload.recent).toEqual([]);
  }, 60000);

  it("help documents the model surface", async () => {
    const help = await runCli(["--help"]);
    expect(help.stdout).toContain("models summary");
    const huntHelp = await runCli(["help", "hunt"]);
    expect(huntHelp.stdout).toContain("--model-provider");
    expect(huntHelp.stdout).toContain("Budget permission is obtained BEFORE any model call");
    const modelsHelp = await runCli(["help", "models"]);
    expect(modelsHelp.stdout).toContain("inspector-cli/models/1");
  }, 60000);
});
