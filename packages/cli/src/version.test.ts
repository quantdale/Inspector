/**
 * Unit tests for version resolution precedence (RC1 Phase 8 coherence):
 * the installed artifact's stamped inspector-version.txt must win over
 * ambient package.json files — a consumer's own manifest or a global
 * prefix root sits at the exact paths resolveVersion() probes first when
 * running from a bundle layout, and reporting a foreign version breaks
 * release coherence (--version vs artifact filename vs release notes).
 *
 * These tests replicate resolveVersion()'s candidate walk against synthetic
 * layouts anchored at a temp "here" directory, so no repo files are touched.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Same candidate ordering as packages/cli/src/version.ts. */
function resolveFrom(anchorDir: string): string {
  const candidates = [
    join(anchorDir, "inspector-version.txt"),
    join(anchorDir, "..", "..", "..", "package.json"),
    join(anchorDir, "..", "package.json"),
  ];
  for (const c of candidates) {
    try {
      if (c.endsWith(".txt")) {
        const raw = readFileSync(c, "utf8").trim();
        if (raw.length > 0) return raw;
        continue;
      }
      const parsed = JSON.parse(readFileSync(c, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return "0.0.0-dev";
}

describe("version resolution precedence (artifact coherence)", () => {
  const dirs: string[] = [];
  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), "inspector-version-"));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("stamped version file wins over an ambient parent package.json", () => {
    // Simulate the installed-artifact trap: bundle/ inside
    // node_modules/inspector-cli/, with a CONSUMER package.json three levels
    // up claiming a different version.
    const root = scratch();
    const bundle = join(root, "node_modules", "inspector-cli", "bundle");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    writeFileSync(join(bundle, "inspector-version.txt"), "0.1.0-rc.1\n");
    expect(resolveFrom(bundle)).toBe("0.1.0-rc.1");
  });

  it("falls back to the workspace root manifest in a dev checkout", () => {
    const root = scratch();
    const src = join(root, "packages", "cli", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    expect(resolveFrom(src)).toBe("0.1.0");
  });

  it("yields the dev placeholder on an unreadable tree", () => {
    expect(resolveFrom(scratch())).toBe("0.0.0-dev");
  });
});
