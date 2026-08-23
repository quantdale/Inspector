import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
});

function parse(argv: string[]) {
  return parseArgs(
    argv,
    [
      "--id",
      "--items",
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
