import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type { Action } from "@inspector/protocol";
import { Store } from "@inspector/store-sqlite";
import { parseArgs } from "./args.js";
import { repairCommand } from "./repair.js";
import type { CommandContext } from "./hunt.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const providerPath = join(here, "fixtures", "m11-repair-provider.cjs");

describe("M11 repair CLI workflow", () => {
  let root: string | undefined;
  let repo: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (repo) rmSync(repo, { recursive: true, force: true });
    root = undefined;
    repo = undefined;
  });

  it("requires an explicit provider instead of inventing a patch agent", async () => {
    const parsed = parseArgs(
      ["find_missing", "--repo-root", "C:/repo", "--revision", "HEAD"],
      ["--repo-root", "--revision", "--provider", "--patch-agent", "--max-attempts", "--error-text", "--selectors"],
      [],
    );
    await expect(repairCommand(parsed, context("C:/workspace"))).rejects.toThrowError(
      expect.objectContaining({ kind: "provider-required" }),
    );
  });

  it("runs RepairEngine in an exact detached worktree and leaves the primary checkout untouched", async () => {
    root = mkdtempSync(join(tmpdir(), "inspector-m11-repair-ws-"));
    repo = mkdtempSync(join(tmpdir(), "inspector-m11-repair-repo-"));
    writeFileSync(join(repo, "app.txt"), "BAD\n", "utf8");
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "config", "user.email", "inspector@example.invalid"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Inspector Test"]);
    execFileSync("git", ["-C", repo, "add", "app.txt"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "seed repair fixture"]);
    const revision = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const runId = "run_m11_repair";
    const environmentId = "env_m11_repair";
    const trigger: Action = {
      id: "trigger-defect",
      runId,
      environmentId,
      kind: "trigger",
      risk: "interact",
      deadlineMs: 5000,
      idempotency: "safe-retry",
    };
    const store = Store.open(join(root, ".inspector", "runs.db"));
    try {
      store.createRun({ id: runId, adapter: "adapter-fake" });
      store.createEnvironment({ id: environmentId, runId, adapter: "adapter-fake" });
      const engine = new FindingEngine(OracleEngine.defaults(), store);
      const finding = engine.ingest(
        { kind: "TARGET_FAILURE", detail: "fixture defect" },
        { runId, adapter: "adapter-fake", revision },
      );
      engine.transition(finding, "CONFIRMED", { actor: "repair-cli-test" });
      const bundle = engine.buildBundle(finding, [trigger], [trigger], {
        revision,
        signals: [{ kind: "TARGET_FAILURE", detail: "fixture defect" }],
      });
      const bundleDir = join(root, ".inspector", "bundles", runId);
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(join(bundleDir, `${finding.id}.json`), JSON.stringify(bundle), "utf8");

      const output: string[] = [];
      const result = await repairCommand(
        parseArgs(
          [
            finding.id,
            "--repo-root",
            repo,
            "--revision",
            revision,
            "--provider",
            providerPath,
            "--json",
            "--workspace",
            root,
          ],
          ["--repo-root", "--revision", "--provider", "--patch-agent", "--max-attempts", "--error-text", "--selectors"],
          [],
        ),
        { ...context(root), json: true, out: (line) => output.push(line) },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(output.at(-1)!);
      expect(parsed).toMatchObject({
        schema: "inspector-cli/repair/1",
        ok: true,
        result: {
          findingId: finding.id,
          outcome: "RESOLVED",
          automaticallyApplied: false,
          primaryCheckoutModified: false,
          resolvedRevision: revision,
        },
      });
      expect(existsSync(parsed.result.auditPath)).toBe(true);
      const audit = JSON.parse(readFileSync(parsed.result.auditPath, "utf8"));
      expect(audit.record.attempts.some((attempt: { verdict: string }) => attempt.verdict === "ACCEPTED")).toBe(true);
      expect(readFileSync(join(repo, "app.txt"), "utf8")).toBe("BAD\n");
      expect(execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
      expect(store.getFinding(finding.id)?.status).toBe("RESOLVED");
      expect(store.getRepairWorkflowRecord(parsed.result.repairId)).toMatchObject({
        status: "completed",
        outcome: "RESOLVED",
      });
    } finally {
      store.close();
    }
  }, 60000);
});

function context(baseCwd: string): CommandContext {
  return {
    baseCwd,
    json: false,
    out: () => undefined,
    progress: () => undefined,
  };
}
