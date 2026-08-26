import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ciExecutableViolations,
  extractRunSteps,
  type RootBinsInput,
} from "./index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** Root-owned binaries: manifest deps ∪ what install actually materialized in node_modules/.bin. */
function rootBins(): Set<string> {
  const bins = new Set<string>();
  const manifest = JSON.parse(readRepo("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const name of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]) {
    bins.add(name);
  }
  const binDir = join(repoRoot, "node_modules", ".bin");
  if (existsSync(binDir)) {
    for (const entry of readdirSync(binDir)) {
      bins.add(entry.replace(/\.(cmd|CMD|ps1|exe)$/i, ""));
    }
  }
  return bins;
}

function binOwners(): Record<string, string> {
  // Which workspace package owns which externally-invoked CLI binary.
  const owners: Record<string, string> = {};
  const webManifest = JSON.parse(readRepo("packages/adapter-web/package.json")) as {
    dependencies?: Record<string, string>;
  };
  if (webManifest.dependencies?.playwright !== undefined) owners.playwright = "@inspector/adapter-web";
  return owners;
}

describe("CI workflow executable-resolution contract (H4-D1 regression guard)", () => {
  const ciYaml = readRepo(".github/workflows/ci.yml");

  it("every pnpm exec step resolves its binary from the root or is explicitly --filter-scoped", () => {
    const input: RootBinsInput = { rootBins: rootBins(), binOwners: binOwners() };
    const violations = ciExecutableViolations(ciYaml, input);
    expect(violations).toEqual([]);
  });

  it("playwright provisioning is scoped to @inspector/adapter-web, which owns the locked dependency", () => {
    const webManifest = JSON.parse(readRepo("packages/adapter-web/package.json")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(webManifest.dependencies?.playwright).toBeDefined();
    expect(webManifest.scripts?.["provision:browser"]).toContain("playwright install");

    const provisioning = extractRunSteps(ciYaml).filter(
      (s) => /\bplaywright\b/.test(s.command) || /provision:browser\b/.test(s.command),
    );
    expect(provisioning.length).toBeGreaterThanOrEqual(1);
    for (const step of provisioning) {
      expect(step.command).toContain("@inspector/adapter-web");
    }
  });

  it("the Linux quality job provisions the browser BEFORE running the integration lane", () => {
    const steps = extractRunSteps(ciYaml).map((s) => s.command);
    const provisionIdx = steps.findIndex(
      (c) => /\bplaywright\b/.test(c) || /provision:browser\b/.test(c),
    );
    const integrationIdx = steps.findIndex((c) => c === "pnpm test:integration");
    expect(provisionIdx).toBeGreaterThanOrEqual(0);
    expect(integrationIdx).toBeGreaterThanOrEqual(0);
    expect(provisionIdx).toBeLessThan(integrationIdx);
  });

  it("the guard itself bites on the historical defect shape", () => {
    // Regression proof for the guard: the EXACT failing hosted step must be flagged.
    const historical = [
      "      - run: pnpm exec playwright install --with-deps chromium",
    ].join("\n");
    const violations = ciExecutableViolations(historical, {
      rootBins: new Set(["vitest", "eslint", "tsc"]),
      binOwners: { playwright: "@inspector/adapter-web" },
    });
    expect(violations.length).toBe(2);
    expect(violations.some((v) => v.reason.includes("32840538303"))).toBe(true);
    expect(violations.some((v) => v.reason.includes("owning workspace package"))).toBe(true);

    // A hypothetical unscoped workspace-only binary is flagged too...
    const unscopedVitest = ciExecutableViolations(
      "      - run: pnpm exec vitest run\n",
      { rootBins: new Set(["eslint"]), binOwners: {} },
    );
    expect(unscopedVitest.length).toBe(1);

    // ...while root-owned binaries and filtered calls pass.
    expect(ciExecutableViolations("      - run: pnpm exec vitest run\n", {
      rootBins: new Set(["vitest"]),
      binOwners: {},
    })).toEqual([]);
    expect(ciExecutableViolations("      - run: pnpm --filter @inspector/android exec adb-helper\n", {
      rootBins: new Set(),
      binOwners: {},
    })).toEqual([]);
  });
});
