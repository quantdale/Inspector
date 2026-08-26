import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicateListItems, findDuplicateMappingKeys } from "./index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

function scalarValue(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^\\s{0,2}${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`, "m").exec(yaml);
  return match?.[1]?.trim();
}

describe("durable campaign state contract (H4-D2 regression guard)", () => {
  const campaignYaml = readRepo(".inspector/state/campaign.yaml");

  it("campaign.yaml has NO duplicate mapping keys (loader-semantics history loss)", () => {
    const duplicates = findDuplicateMappingKeys(campaignYaml);
    expect(duplicates).toEqual([]);
  });

  it("campaign.yaml has NO duplicated identities inside its durable progress lists", () => {
    const duplicates = findDuplicateListItems(campaignYaml).filter(
      (d) =>
        d.container.includes("completed_task_groups") ||
        d.container.includes("completed_milestones") ||
        d.container.includes("completed_waypoints"),
    );
    expect(duplicates).toEqual([]);
  });

  it("the historical duplicate completed_task_groups shape can never pass again", () => {
    const historicalShape = [
      "progress:",
      "  completed_task_groups:",
      "    - F0",
      "    - F1",
      "  completed_task_groups:",
      "    - M13.F0",
      "",
    ].join("\n");
    const duplicates = findDuplicateMappingKeys(historicalShape);
    expect(duplicates.length).toBe(1);
    expect(duplicates[0]?.key).toBe("progress.completed_task_groups");
  });

  it("every state YAML under .inspector/state parses without duplicate sibling keys", () => {
    const dir = join(repoRoot, ".inspector", "state");
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    for (const file of files) {
      const duplicates = findDuplicateMappingKeys(readFileSync(join(dir, file), "utf8"));
      expect(duplicates, `${file} carries duplicate mapping keys`).toEqual([]);
    }
  });

  it("active prompt and canonical state agree on the ACTIVE campaign", () => {
    const prompt = readRepo(".agent/EXECUTION_PROMPT.md");
    const statusActive = /\*\*Status:\*\*\s*ACTIVE/.test(prompt);
    if (!statusActive) return; // No active prompt: nothing to cross-check.

    const campaignMatch = /\*\*Campaign:\*\*\s*([A-Za-z0-9_]+)/.exec(prompt);
    const activeCampaign = campaignMatch?.[1] ?? "";
    expect(activeCampaign.startsWith("HARDENING_")).toBe(true);

    // Canonical state must carry a block for that campaign marked ACTIVE.
    // Key aliases: HARDENING_2 lives under the generic `hardening:` key;
    // later campaigns use numbered keys (`hardening3:`, `hardening4:`).
    const blockKey =
      activeCampaign === "HARDENING_2"
        ? "hardening"
        : activeCampaign.toLowerCase().replace(/_/g, "");
    expect(campaignYaml).toMatch(new RegExp(`^${blockKey}:`, "m"));
    const blockStart = campaignYaml.indexOf(`\n${blockKey}:`);
    const blockBody = campaignYaml.slice(blockStart, campaignYaml.indexOf("\nhardening1_history:", blockStart));
    const blockStatus = scalarValue(blockBody, "status");
    expect(blockStatus).toBe("ACTIVE");
  });

  it("M13 milestone identity is consistent across AGENTS.md and canonical state", () => {
    expect(campaignYaml).toContain('campaign: INTELLIGENCE_GUIDED_AUTONOMOUS_QA');
    const agents = readRepo("AGENTS.md");
    expect(agents).toContain("INTELLIGENCE_GUIDED_AUTONOMOUS_QA");
    // The historical drift (M13 labeled with M12's campaign name) must not return.
    expect(agents).not.toMatch(/M13[^]*?REAL_TARGET_FLEET_CAMPAIGNS/);
  });

  it("implementation campaign truth: M13 COMPLETE and no invented successor milestone", () => {
    const activeBlock = campaignYaml.slice(campaignYaml.indexOf("\nactive:"), campaignYaml.indexOf("\nprogress:"));
    expect(activeBlock).toMatch(/status: COMPLETE/);
    expect(activeBlock).toMatch(/milestone_id: M13\b/);
    expect(activeBlock).not.toMatch(/milestone_id: M14/);
  });
});
