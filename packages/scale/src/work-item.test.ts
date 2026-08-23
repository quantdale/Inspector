import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CampaignConfigError,
  validateCampaignManifest,
  validateWorkItem,
  type ManifestIssue,
} from "./work-item.js";
import { loadCampaignManifest } from "./manifest.js";

function collect(): ManifestIssue[] {
  return [];
}

describe("M12 F2 work-item validation", () => {
  it("accepts a valid v2 assignment and normalizes defaults", () => {
    const issues = collect();
    const item = validateWorkItem(
      {
        id: "web-hunt-1",
        workflow: "hunt",
        adapterFamily: "web",
        targetUri: "http://127.0.0.1:8091/",
        seed: 3,
        budgets: { maxActions: 100, maxMinutes: 5 },
        requiresCapabilities: ["browser"],
      },
      "items[0]",
      0,
      issues,
    );
    expect(issues).toHaveLength(0);
    expect(item).toMatchObject({
      id: "web-hunt-1",
      mode: "hunt",
      adapterFamily: "web",
      targetUri: "http://127.0.0.1:8091/",
      seed: 3,
      priority: 1,
      requiresCapabilities: ["browser"],
    });
    expect(item?.budgets).toMatchObject({ maxActions: 100 });
  });

  it("keeps legacy regression mode and fake targets loadable", () => {
    const issues = collect();
    const item = validateWorkItem(
      { id: "legacy-1", mode: "regression", target: "fake", seed: 5, steps: 2, priority: 9 },
      "items[0]",
      0,
      issues,
    );
    expect(issues).toHaveLength(0);
    expect(item).toMatchObject({ id: "legacy-1", mode: "regression", target: "fake", steps: 2, priority: 9 });
  });

  it("collects deterministic issues for invalid items", () => {
    const issues = collect();
    const item = validateWorkItem(
      { id: "BAD ID!", workflow: "transmogrify", adapterFamily: "teleporter", seed: -1, steps: 0 },
      "items[2]",
      2,
      issues,
    );
    expect(item).toBeUndefined();
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("id-invalid");
    expect(codes).toContain("workflow-unsupported");
    expect(codes).toContain("family-unsupported");
    expect(codes).toContain("seed-invalid");
    expect(codes).toContain("steps-invalid");
    for (const i of issues) expect(i.path).toBe("items[2]");
  });

  it("refuses unknown capability tags (fail closed)", () => {
    const issues = collect();
    validateWorkItem(
      { id: "cap-1", workflow: "hunt", adapterFamily: "web", requiresCapabilities: ["browser", "holodeck"] },
      "items[0]",
      0,
      issues,
    );
    expect(issues.map((i) => i.code)).toContain("capability-unknown");
  });

  it("never allows repair without explicit per-item authorization", () => {
    const issues = collect();
    const item = validateWorkItem(
      { id: "repair-1", workflow: "repair", adapterFamily: "fake", steps: 1 },
      "items[0]",
      0,
      issues,
    );
    expect(item).toBeUndefined();
    expect(issues.map((i) => i.code)).toContain("repair-not-authorized");

    const okIssues = collect();
    const authorized = validateWorkItem(
      { id: "repair-2", workflow: "repair", adapterFamily: "fake", steps: 1, repairAuthorized: true },
      "items[0]",
      0,
      okIssues,
    );
    expect(okIssues).toHaveLength(0);
    expect(authorized?.repairAuthorized).toBe(true);
  });
});

describe("M12 F2 manifest validation", () => {
  it("validates a full document and applies defaults", () => {
    const config = validateCampaignManifest({
      schema: "inspector-campaign-manifest/1",
      id: "fleet-1",
      workers: 3,
      leases: { backend: "sqlite", ttlMs: 5000 },
      maxMinutes: 4,
      budgets: { global: { maxActions: 900 }, perWorker: { maxActions: 400 } },
      items: [
        { id: "a", workflow: "explore", adapterFamily: "fake", seed: 1, steps: 2 },
        { id: "b", workflow: "hunt", adapterFamily: "web", targetUri: "http://127.0.0.1:1/" },
      ],
    });
    expect(config.workerCount).toBe(3);
    expect(config.maxWallMs).toBe(4 * 60_000);
    expect(config.items).toHaveLength(2);
    expect(config.items[1]).toMatchObject({ id: "b", priority: 2 });
    expect(config.globalBudget).toEqual({ maxActions: 900 });
    expect(config.keepItemWorkspaces).toBe(false);
  });

  it("raises CampaignConfigError with every issue before any work starts", () => {
    try {
      validateCampaignManifest({
        schema: "inspector-campaign-manifest/1",
        workers: 99,
        budgets: { global: { maxActions: -5 } },
        items: [
          { id: "dup", workflow: "hunt" },
          { id: "dup", workflow: "hunt" },
          { id: "x", workflow: "hunt", requiresCapabilities: ["warp-drive"] },
        ],
      });
      throw new Error("expected CampaignConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignConfigError);
      const codes = (err as CampaignConfigError).issues.map((i) => i.code);
      expect(codes).toContain("workers-invalid");
      expect(codes).toContain("budget-invalid");
      expect(codes).toContain("id-duplicate");
      expect(codes).toContain("capability-unknown");
    }
  });

  it("rejects unsupported schema versions loudly", () => {
    expect(() =>
      validateCampaignManifest({ schema: "inspector-campaign-manifest/999", items: [] }),
    ).toThrow(CampaignConfigError);
  });

  it("loads YAML manifests from disk with provenance hash; corrupt YAML fails closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-manifest-"));
    try {
      const path = join(dir, "campaign.yaml");
      writeFileSync(
        path,
        [
          "schema: inspector-campaign-manifest/1",
          "id: yaml-fleet",
          "workers: 2",
          "items:",
          "  - id: one",
          "    workflow: hunt",
          "    adapterFamily: fake",
          "    steps: 2",
          "  - id: two",
          "    workflow: explore",
          "    adapterFamily: fake",
          "    steps: 2",
        ].join("\n"),
        "utf8",
      );
      const loaded = loadCampaignManifest(path);
      expect(loaded.config.id).toBe("yaml-fleet");
      expect(loaded.config.items.map((i) => i.id)).toEqual(["one", "two"]);
      expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);

      const broken = join(dir, "broken.yaml");
      writeFileSync(broken, "items: [unclosed\n", "utf8");
      expect(() => loadCampaignManifest(broken)).toThrow(CampaignConfigError);

      const empty = join(dir, "empty.json");
      writeFileSync(empty, "", "utf8");
      expect(() => loadCampaignManifest(empty)).toThrow(/manifest-empty|manifest is not valid/);
    } finally {
      // tmpdir cleanup handled by OS temp policy in unit scope
    }
  });
});
