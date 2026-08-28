import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const censusScript = join(repoRoot, "scripts", "gen_audit_census.py");

describe("HARDENING_6 audit certification", () => {
  it("does not promote inventory to semantic REVIEWED from path, category, or hash alone", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "inspector-audit-contract-"));
    const output = join(outputDir, "audit.md");
    try {
      const python = process.env.INSPECTOR_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
      execFileSync(python, [censusScript, "--output", output], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      const generated = readFileSync(output, "utf8");
      expect(generated).toContain("UNREVIEWED");
      expect(generated).not.toMatch(/\| R \|/);
      expect(generated).toContain("semantic review evidence");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("requires exact semantic evidence for every authored tracked blob and rejects stale evidence", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "inspector-audit-ledger-"));
    const machine = join(outputDir, "audit.json");
    const staleLedger = join(outputDir, "stale-ledger.json");
    try {
      const python = process.env.INSPECTOR_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
      const ledgerPath = join(repoRoot, ".inspector", "state", "HARDENING_6-SEMANTIC-REVIEW.json");
      execFileSync(
        python,
        [censusScript, "--no-markdown", "--machine-output", machine, "--review-ledger", ledgerPath],
        { cwd: repoRoot, encoding: "utf8" },
      );

      const certificate = JSON.parse(readFileSync(machine, "utf8")) as {
        rows: Array<{
          path: string;
          authored: boolean;
          review_status: string;
          semantic_review: { blob: string; system_maps: string[]; review_targets: string[] } | null;
          review_error: string | null;
        }>;
      };
      const authored = certificate.rows.filter((row) => row.authored);
      expect(authored.length).toBeGreaterThan(0);
      expect(authored.every((row) => row.review_status === "REVIEWED")).toBe(true);
      expect(authored.every((row) => row.semantic_review !== null)).toBe(true);
      expect(authored.every((row) => row.review_error === null)).toBe(true);
      expect(authored.every((row) => row.semantic_review!.blob.length === 40)).toBe(true);
      expect(authored.every((row) => row.semantic_review!.system_maps.length > 0)).toBe(true);
      expect(authored.every((row) => row.semantic_review!.review_targets.length > 0)).toBe(true);

      const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
        schema: string;
        reviews: Array<{ path: string; blob: string }>;
      };
      expect(ledger.schema).toBe("inspector-h6-semantic-review/1");
      expect(ledger.reviews).toHaveLength(authored.length);
      const first = ledger.reviews[0];
      expect(first).toBeDefined();
      if (!first) throw new Error("semantic review ledger unexpectedly empty");
      first.blob = "0".repeat(40);
      writeFileSync(staleLedger, JSON.stringify(ledger), "utf8");
      execFileSync(
        python,
        [censusScript, "--no-markdown", "--machine-output", machine, "--review-ledger", staleLedger],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const staleCertificate = JSON.parse(readFileSync(machine, "utf8")) as {
        rows: Array<{ review_status: string; review_error: string | null }>;
      };
      expect(staleCertificate.rows.some((row) => row.review_status === "UNREVIEWED" && row.review_error?.includes("stale"))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
