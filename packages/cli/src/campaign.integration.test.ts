import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "./args.js";
import { campaignCommand } from "./campaign.js";
import type { CommandContext } from "./hunt.js";

describe("M11 campaign CLI workflow", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("runs two isolated bounded workers and remains idempotent across rerun/stop/resume", async () => {
    root = mkdtempSync(join(tmpdir(), "inspector-m11-campaign-"));
    const firstOutput: string[] = [];
    const first = await campaignCommand(
      parse(["run", "--id", "m11-campaign", "--items", "one=fake,two=fake", "--workers", "2", "--steps", "2", "--json"]),
      context(root, firstOutput),
    );
    expect(first.code).toBe(0);
    const firstPayload = JSON.parse(firstOutput.at(-1)!);
    expect(firstPayload).toMatchObject({
      schema: "inspector-cli/campaign/1",
      ok: true,
      campaign: {
        id: "m11-campaign",
        status: "complete",
        workerCount: 2,
        completed: ["one", "two"],
        inFlight: 0,
        leaseBackend: "sqlite",
      },
    });
    expect(new Set(firstPayload.campaign.executions.map((entry: { workerId: string }) => entry.workerId)).size).toBe(2);
    expect(firstPayload.campaign.usage.actions).toBe(4);

    const rerunOutput: string[] = [];
    const rerun = await campaignCommand(
      parse(["run", "--id", "m11-campaign", "--json"]),
      context(root, rerunOutput),
    );
    expect(rerun.code).toBe(0);
    const rerunPayload = JSON.parse(rerunOutput.at(-1)!);
    expect(rerunPayload.campaign.executions).toHaveLength(2);
    expect(rerunPayload.campaign.usage.actions).toBe(4);

    const stopOutput: string[] = [];
    const stopped = await campaignCommand(
      parse(["stop", "m11-campaign", "--json"]),
      context(root, stopOutput),
    );
    expect(stopped.code).toBe(0);
    expect(JSON.parse(stopOutput.at(-1)!).campaign.status).toBe("stopped");

    const resumeOutput: string[] = [];
    const resumed = await campaignCommand(
      parse(["resume", "m11-campaign", "--json"]),
      context(root, resumeOutput),
    );
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumeOutput.at(-1)!).campaign.status).toBe("complete");

    const listOutput: string[] = [];
    const listed = await campaignCommand(
      parse(["list", "--json"]),
      context(root, listOutput),
    );
    expect(listed.code).toBe(0);
    expect(JSON.parse(listOutput.at(-1)!).campaigns).toHaveLength(1);

    const showOutput: string[] = [];
    const shown = await campaignCommand(
      parse(["show", "m11-campaign", "--json"]),
      context(root, showOutput),
    );
    expect(shown.code).toBe(0);
    expect(JSON.parse(showOutput.at(-1)!).campaign).toMatchObject({ id: "m11-campaign", status: "complete" });
  }, 60000);

  it("validates a manifest, refuses invalid ones, and runs a manifest campaign end-to-end (M12 F2)", async () => {
    root = mkdtempSync(join(tmpdir(), "inspector-m12-campaign-"));
    const manifestPath = join(root, "campaign.yaml");
    writeFileSync(
      manifestPath,
      [
        "schema: inspector-campaign-manifest/1",
        "id: m12-manifest",
        "workers: 2",
        "leases:",
        "  backend: sqlite",
        "  ttlMs: 60000",
        "maxMinutes: 5",
        "budgets:",
        "  global:",
        "    maxActions: 500",
        "items:",
        "  - id: alpha",
        "    workflow: hunt",
        "    adapterFamily: fake",
        "    seed: 11",
        "    steps: 2",
        "  - id: beta",
        "    workflow: explore",
        "    adapterFamily: fake",
        "    seed: 22",
        "    steps: 2",
        "    priority: 2",
      ].join("\n"),
      "utf8",
    );

    // validate operation: deterministic JSON proof without creating a campaign.
    const validateOut: string[] = [];
    const validated = await campaignCommand(
      parse(["validate", "--manifest", manifestPath]),
      context(root, validateOut),
    );
    expect(validated.code).toBe(0);
    const validatePayload = JSON.parse(validateOut.at(-1)!);
    expect(validatePayload).toMatchObject({ schema: "inspector-cli/campaign-validate/1", ok: true });
    expect(validatePayload.result.items).toHaveLength(2);
    expect(validatePayload.result.items[0]).toMatchObject({ id: "alpha", workflow: "hunt", adapterFamily: "fake", repairAuthorized: false });
    expect(typeof validatePayload.result.sha256).toBe("string");

    // Invalid manifests fail closed with stable error kinds.
    const badPath = join(root, "bad.yaml");
    writeFileSync(badPath, "schema: wrong-schema\nitems: []\n", "utf8");
    await expect(
      campaignCommand(parse(["run", "--manifest", badPath]), context(root, [])),
    ).rejects.toMatchObject({ kind: "manifest-invalid" });

    // Graduated autonomy: repair items require explicit authorization.
    const repairPath = join(root, "repair.yaml");
    writeFileSync(
      repairPath,
      [
        "schema: inspector-campaign-manifest/1",
        "items:",
        "  - id: sneaky",
        "    workflow: repair",
        "    adapterFamily: fake",
        "    seed: 3",
        "    steps: 1",
      ].join("\n"),
      "utf8",
    );
    await expect(
      campaignCommand(parse(["validate", "--manifest", repairPath]), context(root, [])),
    ).rejects.toMatchObject({ kind: "manifest-invalid" });

    // End-to-end manifest run through the durable campaign surface.
    const runOutput: string[] = [];
    const run = await campaignCommand(
      parse(["run", "--manifest", manifestPath, "--json"]),
      context(root, runOutput),
    );
    expect(run.code).toBe(0);
    const runPayload = JSON.parse(runOutput.at(-1)!);
    expect(runPayload.campaign).toMatchObject({ id: "m12-manifest", status: "complete", workerCount: 2 });
    expect([...runPayload.campaign.completed].sort()).toEqual(["alpha", "beta"]);
    expect(new Set(runPayload.campaign.executions.map((e: { workerId: string }) => e.workerId)).size).toBe(2);
    expect(runPayload.campaign.usage.actions).toBe(4);

    // Durable provenance of the source manifest is retained.
    const durable = JSON.parse(
      readFileSync(join(root, ".inspector", "campaigns", "m12-manifest", "manifest.json"), "utf8"),
    );
    expect(durable.sourceManifest).toMatchObject({ path: manifestPath });
    expect(durable.sourceManifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 60000);
});

function parse(argv: string[]) {
  return parseArgs(
    argv,
    [
      "--id",
      "--items",
      "--manifest",
      "--workers",
      "--steps",
      "--seed",
      "--mode",
      "--lease-backend",
      "--lease-ttl-ms",
      "--max-minutes",
      "--max-actions",
      "--max-tokens",
      "--max-cost-usd",
      "--max-worker-actions",
      "--model-requests-per-step",
      "--tokens-per-step",
      "--cost-per-step",
      "--actions-per-step",
      "--limit",
    ],
    [],
  );
}

function context(baseCwd: string, output: string[]): CommandContext {
  return {
    baseCwd,
    json: true,
    out: (line) => output.push(line),
    progress: () => undefined,
  };
}
