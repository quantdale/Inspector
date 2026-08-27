import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readRepo(rel: string): string {
  // Joins repoRoot with rel and reads — indirection matters for test seam and
  // for keeping repo-relative I/O out of inline expressions across tests.
  return readFileSync(join(repoRoot, rel), "utf8");
}

function readJson(rel: string): Record<string, unknown> {
  // Parses JSON with repo-relative path resolution; shared across tests.
  return JSON.parse(readRepo(rel)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers — pure, deterministic, no I/O, no secrets
// ---------------------------------------------------------------------------

export function normalizeVersion(v: string): string {
  return v.trim();
}

export interface VersionCoherenceInput {
  rootVersion: string;
  workspaceVersions: Record<string, string>;
  inspectorVersionTxt?: string | null;
  bundlePackageJsonVersion?: string | null;
  buildManifestVersion?: string | null;
}

export function versionCoherenceErrors(input: VersionCoherenceInput): string[] {
  const errors: string[] = [];
  const root = normalizeVersion(input.rootVersion);
  if (!root) errors.push("root version is empty");

  for (const [pkg, raw] of Object.entries(input.workspaceVersions)) {
    const v = normalizeVersion(raw);
    if (v !== root) {
      errors.push(`workspace package ${pkg} version ${v} diverges from root ${root}`);
    }
  }

  if (input.inspectorVersionTxt !== null && input.inspectorVersionTxt !== undefined) {
    const v = normalizeVersion(input.inspectorVersionTxt);
    if (v.length === 0) {
      errors.push("inspector-version.txt is empty");
    } else if (v !== root) {
      errors.push(`inspector-version.txt version ${v} diverges from root ${root}`);
    }
  }

  if (input.bundlePackageJsonVersion !== null && input.bundlePackageJsonVersion !== undefined) {
    const v = normalizeVersion(input.bundlePackageJsonVersion);
    if (v !== root) {
      errors.push(`bundle package.json version ${v} diverges from root ${root}`);
    }
  }

  if (input.buildManifestVersion !== null && input.buildManifestVersion !== undefined) {
    const v = normalizeVersion(input.buildManifestVersion);
    if (v !== root) {
      errors.push(`build-manifest.json version ${v} diverges from root ${root}`);
    }
  }

  // Cross-check bundle vs txt when both present (should be identical)
  if (
    input.inspectorVersionTxt !== null &&
    input.inspectorVersionTxt !== undefined &&
    input.bundlePackageJsonVersion !== null &&
    input.bundlePackageJsonVersion !== undefined
  ) {
    const a = normalizeVersion(input.inspectorVersionTxt);
    const b = normalizeVersion(input.bundlePackageJsonVersion);
    if (a !== b) {
      errors.push(`inspector-version.txt (${a}) and bundle package.json (${b}) diverge`);
    }
  }

  return errors;
}

// Tarball allowlist — mirrors scripts/build-release.mjs assertPackedContents
export const FORBIDDEN_TARBALL_RE =
  /(?:^|\/)(?:node_modules|\.git|\.inspector|test|tests|fixtures|evidence|artifacts|\.env(?:$|\.))/i;

export const SECRET_BASENAME_RE = /^(?:\.env(?:\..*)?|.*\.pem|.*\.key|secrets?\.json)$/i;

export const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\Users\\)/;

export function validateTarballEntries(entries: string[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    // Absolute path leakage (tar entries must be repo-relative under package/)
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
      errors.push(`absolute path leakage: ${entry}`);
      continue;
    }
    if (ABSOLUTE_PATH_RE.test(entry)) {
      errors.push(`workspace path leakage in entry: ${entry}`);
      continue;
    }
    if (!entry.startsWith("package/")) {
      errors.push(`tarball entry escapes package root: ${entry}`);
      continue;
    }
    const rel = entry.slice("package/".length).replace(/\/$/, "");
    if (!rel || rel === "bundle") continue;

    const base = rel.split("/").at(-1) ?? "";
    if (SECRET_BASENAME_RE.test(base) && !rel.startsWith("bundle/fixtures/")) {
      errors.push(`forbidden secret-adjacent content in tarball: ${entry}`);
      continue;
    }
    if (FORBIDDEN_TARBALL_RE.test(rel) && !rel.startsWith("bundle/fixtures/")) {
      errors.push(`forbidden development/evidence content in tarball: ${entry}`);
      continue;
    }
    const allowed =
      rel === "package.json" ||
      rel === "INSTALL.txt" ||
      rel === "build-manifest.json" ||
      rel === "SHA256SUMS.txt" ||
      rel.startsWith("bundle/");
    if (!allowed) {
      errors.push(`unexpected tarball content: ${entry}`);
    }
  }
  return errors;
}

export function containsWorkspacePathLeakage(text: string): boolean {
  if (ABSOLUTE_PATH_RE.test(text)) return true;
  // Generic absolute unix path that looks like a workspace leak — but avoid
  // flagging the tar prefix `package/` which is repo-relative.
  if (/^\/[A-Za-z]/.test(text)) return true;
  // Check for drive-letter leakage anywhere
  if (/[A-Za-z]:[\\/]/.test(text)) return true;
  return false;
}

export function workspacePathLeakageErrors(text: string, repoRootAbs?: string): string[] {
  const errors: string[] = [];
  if (containsWorkspacePathLeakage(text)) {
    errors.push("absolute/workspace path leakage detected");
  }
  if (repoRootAbs && text.includes(repoRootAbs)) {
    errors.push("repo absolute path leakage detected");
  }
  // Also flag the escaped Windows form (double backslash) for completeness
  if (repoRootAbs && repoRootAbs.includes("\\") && text.includes(repoRootAbs.replace(/\\/g, "/"))) {
    // already covered by slash form; no extra
  }
  return errors;
}

// Deterministic good-manifest fixture (no I/O, no build) — shared across
// tarball-content tests; exported constant avoids per-test duplication.
const GOOD_MANIFEST: readonly string[] = [
  "package/package.json",
  "package/INSTALL.txt",
  "package/build-manifest.json",
  "package/SHA256SUMS.txt",
  "package/bundle/inspector-cli.js",
  "package/bundle/inspector-cli.js.map",
  "package/bundle/inspector-adapter-web.js",
  "package/bundle/inspector-version.txt",
  "package/bundle/fixtures/main.cjs",
  "package/bundle/fixtures/renderer.html",
];

// ---------------------------------------------------------------------------
// Tests — deterministic, credential-free, no tarball build required
// ---------------------------------------------------------------------------

describe("release provenance — version coherence guard (M15 F0)", () => {
  const rootVersion = (readJson("package.json").version as string) ?? "";

  it("root package.json version is a non-empty semver-like string", () => {
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("all workspace packages share the root version", () => {
    const pkgsDir = join(repoRoot, "packages");
    const entries = readdirSync(pkgsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const workspaceVersions: Record<string, string> = {};
    for (const ent of entries) {
      const pkgJsonPath = join(pkgsDir, ent.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        name?: string;
        version?: string;
      };
      const name = parsed.name ?? ent.name;
      workspaceVersions[name] = parsed.version ?? "";
    }
    const errors = versionCoherenceErrors({ rootVersion, workspaceVersions });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("inspector-version.txt, if present, matches root version (no drift)", () => {
    // Build artifact location stamped by scripts/build-release.mjs
    const candidates = [
      join(repoRoot, "dist-release", "bundle", "inspector-version.txt"),
      join(repoRoot, "bundle", "inspector-version.txt"),
    ];
    let found: string | null = null;
    for (const p of candidates) {
      if (existsSync(p)) {
        found = readFileSync(p, "utf8").trim();
        break;
      }
    }
    // If no artifact exists (clean checkout), the guard vacuously passes — the
    // coherence check is still proven by the pure-function tests below.
    if (found === null) {
      expect(candidates[0]).toBeDefined();
      return;
    }
    const errors = versionCoherenceErrors({
      rootVersion,
      workspaceVersions: {},
      inspectorVersionTxt: found,
    });
    expect(errors, errors.join("\n")).toEqual([]);
    // No workspace path leakage in the txt itself
    expect(containsWorkspacePathLeakage(found)).toBe(false);
  });

  it("dist-release package.json and build-manifest.json, if present, match root version", () => {
    const distPkgPath = join(repoRoot, "dist-release", "package.json");
    const manifestPath = join(repoRoot, "dist-release", "build-manifest.json");
    let bundleVersion: string | null = null;
    let manifestVersion: string | null = null;
    if (existsSync(distPkgPath)) {
      const parsed = JSON.parse(readFileSync(distPkgPath, "utf8")) as { version?: string };
      bundleVersion = parsed.version ?? null;
    }
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string };
      manifestVersion = parsed.version ?? null;
    }
    if (bundleVersion === null && manifestVersion === null) return;
    const errors = versionCoherenceErrors({
      rootVersion,
      workspaceVersions: {},
      bundlePackageJsonVersion: bundleVersion,
      buildManifestVersion: manifestVersion,
    });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("fails on injected mismatch fixture (root vs txt vs manifest diverge)", () => {
    const errors = versionCoherenceErrors({
      rootVersion: "0.1.0",
      workspaceVersions: { "@inspector/core": "0.1.0" },
      inspectorVersionTxt: "0.2.0",
      bundlePackageJsonVersion: "0.1.0",
      buildManifestVersion: "0.1.0",
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/inspector-version\.txt/);
  });

  it("fails when a workspace package version diverges", () => {
    const errors = versionCoherenceErrors({
      rootVersion: "0.1.0",
      workspaceVersions: {
        "@inspector/core": "0.1.0",
        "@inspector/cli": "0.9.9",
      },
    });
    expect(errors).toEqual([expect.stringContaining("@inspector/cli")]);
  });

  it("is deterministic: same input yields same errors without I/O or build", () => {
    const input: VersionCoherenceInput = {
      rootVersion: "0.1.0",
      workspaceVersions: { "@inspector/a": "0.1.0", "@inspector/b": "0.1.0" },
      inspectorVersionTxt: "0.1.0",
      bundlePackageJsonVersion: "0.1.0",
      buildManifestVersion: "0.1.0",
    };
    expect(versionCoherenceErrors(input)).toEqual(versionCoherenceErrors(input));
    expect(versionCoherenceErrors(input)).toEqual([]);
  });
});

describe("release provenance — tarball content assertion (M15 F1)", () => {
  it("allowlist: known-good manifest contains only allowed files (no .inspector, no secrets)", () => {
    const errors = validateTarballEntries([...GOOD_MANIFEST]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("rejects injected .inspector path", () => {
    const entries = [...GOOD_MANIFEST, "package/.inspector/state/campaign.yaml"];
    const errors = validateTarballEntries(entries);
    expect(errors.join("\n")).toMatch(/forbidden/);
  });

  it("rejects injected .env secret", () => {
    const entries = [...GOOD_MANIFEST, "package/.env"];
    const errors = validateTarballEntries(entries);
    expect(errors.join("\n")).toMatch(/forbidden|secret/);
  });

  it("rejects injected node_modules and .git", () => {
    expect(validateTarballEntries([...GOOD_MANIFEST, "package/node_modules/foo/index.js"]).join("\n")).toMatch(
      /forbidden/,
    );
    expect(validateTarballEntries([...GOOD_MANIFEST, "package/.git/config"]).join("\n")).toMatch(/forbidden/);
  });

  it("rejects unexpected top-level file", () => {
    const errors = validateTarballEntries([...GOOD_MANIFEST, "package/SECRET.txt"]);
    // SECRET.txt is not in allowlist — should be flagged as unexpected
    expect(errors.join("\n")).toMatch(/unexpected/);
  });

  it("rejects absolute path leakage in tarball entry", () => {
    expect(validateTarballEntries(["/tmp/package/bundle/foo.js"]).join("\n")).toMatch(/absolute/);
    expect(validateTarballEntries(["package/bundle/foo.js", "D:/Documents/tryPython/Inspector/package.json"]).join("\n")).toMatch(
      /absolute|leakage|escapes/,
    );
    expect(validateTarballEntries(["package/C:\\Users\\somebody\\bundle\\x.js"]).join("\n")).toMatch(/leakage|absolute/);
  });

  it("is deterministic: same manifest yields same result without building tarball", () => {
    const a = validateTarballEntries([...GOOD_MANIFEST]);
    const b = validateTarballEntries([...GOOD_MANIFEST]);
    expect(a).toEqual(b);
  });

  it("no workspace path leakage in provenance outputs (if present)", () => {
    const candidates = [
      join(repoRoot, "dist-release", "build-manifest.json"),
      join(repoRoot, "dist-release", "SHA256SUMS.txt"),
      join(repoRoot, "dist-release", "package.json"),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      expect(containsWorkspacePathLeakage(text), `leakage in ${p}: ${text.slice(0, 200)}`).toBe(false);
      expect(workspacePathLeakageErrors(text, repoRoot).length, `repo path leakage in ${p}`).toBe(0);
      // No absolute path segments inside JSON values (except allowed `package/` prefix which is relative)
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    }
  });

  it("containsWorkspacePathLeakage detects synthetic leakage fixtures", () => {
    expect(containsWorkspacePathLeakage("D:/Documents/tryPython/Inspector/dist-release/bundle/x.js")).toBe(true);
    expect(containsWorkspacePathLeakage("C:\\Users\\somebody\\Inspector\\bundle")).toBe(true);
    expect(containsWorkspacePathLeakage("/home/somebody/inspector/bundle")).toBe(true);
    expect(containsWorkspacePathLeakage("/Users/somebody/inspector")).toBe(true);
    expect(containsWorkspacePathLeakage("package/bundle/inspector-cli.js")).toBe(false);
    expect(containsWorkspacePathLeakage('{"version":"0.1.0","name":"inspector-cli"}')).toBe(false);
  });
});
