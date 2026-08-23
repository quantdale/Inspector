import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { huntCommand } from "./hunt.js";
import { verifyCommand } from "./verify.js";
import { regressCommand } from "./regress.js";
import { repairCommand } from "./repair.js";
import { parseArgs } from "./args.js";
import type { CommandContext } from "./hunt.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const providerPath = join(here, "fixtures", "m11-repair-provider.cjs");

describe("M11 product acceptance chain", () => {
  let workspace: string | undefined;
  let repository: string | undefined;

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    if (repository) rmSync(repository, { recursive: true, force: true });
    workspace = undefined;
    repository = undefined;
  });

  it("hunts, verifies, materializes regression, and repairs in isolation", async () => {
    workspace = mkdtempSync(join(tmpdir(), "inspector-m11-acceptance-ws-"));
    repository = mkdtempSync(join(tmpdir(), "inspector-m11-acceptance-repo-"));
    writeFileSync(join(repository, "app.txt"), "BAD\n", "utf8");
    execFileSync("git", ["-C", repository, "init", "-q"]);
    execFileSync("git", ["-C", repository, "config", "user.email", "inspector@example.invalid"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Inspector Test"]);
    execFileSync("git", ["-C", repository, "add", "app.txt"]);
    execFileSync("git", ["-C", repository, "commit", "-qm", "seed acceptance fixture"]);
    const revision = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const huntOutput: string[] = [];
    const base = context(workspace, huntOutput);
    const hunt = await huntCommand(
      parseArgs(["--adapter", "fake", "--seed", "7", "--max-actions", "80", "--max-findings", "2", "--json"], ["--adapter", "--url", "--target", "--seed", "--max-actions", "--max-minutes", "--max-findings", "--resume"], []),
      base,
    );
    expect(hunt.code).toBe(0);
    const hunted = JSON.parse(huntOutput.at(-1)!);
    const finding = hunted.findings.find((candidate: { status: string }) => candidate.status === "CONFIRMED") as { id: string } | undefined;
    expect(finding).toBeDefined();

    const verifyOutput: string[] = [];
    const verification = await verifyCommand(
      parseArgs([finding!.id, "--attempts", "1", "--min-successes", "1", "--json"], ["--attempts", "--min-successes", "--timeout-ms", "--revision"], []),
      context(workspace, verifyOutput),
    );
    expect(verification.code).toBe(2);
    expect(JSON.parse(verifyOutput.at(-1)!).result.classification).toBe("reproduced");

    const regressOutput: string[] = [];
    const regression = await regressCommand(
      parseArgs(["--finding", finding!.id, "--attempts", "1", "--min-successes", "1", "--json"], ["--run", "--finding", "--adapter", "--revision", "--attempts", "--min-successes", "--limit"], []),
      context(workspace, regressOutput),
    );
    expect(regression.code).toBe(2);
    expect(JSON.parse(regressOutput.at(-1)!).counts.reproducedRegression).toBe(1);

    const repairOutput: string[] = [];
    const repair = await repairCommand(
      parseArgs([finding!.id, "--repo-root", repository, "--revision", revision, "--provider", providerPath, "--json"], ["--repo-root", "--revision", "--provider", "--patch-agent", "--max-attempts", "--error-text", "--selectors"], []),
      context(workspace, repairOutput),
    );
    expect(repair.code, repairOutput.join("\n")).toBe(0);
    const repaired = JSON.parse(repairOutput.at(-1)!);
    expect(repaired.result).toMatchObject({
      outcome: "RESOLVED",
      automaticallyApplied: false,
      primaryCheckoutModified: false,
      resolvedRevision: revision,
    });
    expect(readFileSync(join(repository, "app.txt"), "utf8")).toBe("BAD\n");
    expect(execFileSync("git", ["-C", repository, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
    expect(readFileSync(repaired.result.auditPath, "utf8")).toContain("ACCEPTED");
  }, 90000);
});

function context(baseCwd: string, output: string[]): CommandContext {
  return {
    baseCwd,
    json: true,
    out: (line) => output.push(line),
    progress: () => undefined,
  };
}
