import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { resolveContainedPath, PathPolicyError } from "./worktree.js";

// ---------------------------------------------------------------------------
// Property suite for resolveContainedPath (source-write policy, spec 004).
// Complements worktree.hardening.test.ts D1 with generated corpora. The key
// contract pinned here: ANY path containing a '..' segment is rejected with
// PathPolicyError — including traversal forms that would normalize back
// INSIDE the root (defense-in-depth must not rely on the final containment
// check alone).
// ---------------------------------------------------------------------------

const ROOT = resolve(join(tmpdir(), "inspector-repair-prop-root"));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => items[Math.floor(next() * items.length)]!,
  };
}

const SEED = 0x4b50524f;

/** Generated legal workspace-relative paths. */
function legalPaths(rng: Rng): string[] {
  const segments = ["src", "lib", "app", "test", "mod.ts", "index.js", "readme.md", "v2", "pkg.json"];
  const out: string[] = [];
  for (let i = 0; i < 80; i++) {
    const depth = 1 + rng.int(4);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) parts.push(rng.pick(segments));
    out.push(parts.join("/"));
  }
  out.push("file.txt", "a/b/c/d/e/f/g.txt");
  return out;
}

/**
 * Generated hostile paths. Group A normalizes OUTSIDE the root (already
 * caught by the final containment check). Group B contains '..' segments yet
 * normalizes INSIDE or ONTO the root — only the explicit '..' rejection makes
 * these PathPolicyError.
 */
function hostilePaths(rng: Rng): { form: string; path: string }[] {
  const out: { form: string; path: string }[] = [];
  const seeds = ["secret.txt", "id_rsa", "db.sqlite", "x"];
  for (const s of seeds) {
    // Group A: escape the root outright.
    out.push({ form: "parent-escape", path: `../${s}` });
    out.push({ form: "deep-parent-escape", path: `../../${s}` });
    out.push({ form: "backslash-escape", path: `..\\${s}` });
    out.push({ form: "mixed-escape", path: `src/../../${s}` });
    out.push({ form: "absolute", path: `/etc/${s}` });
    out.push({ form: "drive-letter", path: `C:\\windows\\${s}` });
    out.push({ form: "unc", path: `\\\\srv\\share\\${s}` });
    out.push({ form: "protocol-slashes", path: `//${s}` });
    // Group B: '..' present but resolves inside/onto the root.
    out.push({ form: "dotdot-onto-root", path: ".." });
    out.push({ form: "dotdot-slash-onto-root", path: "../" });
    out.push({ form: "dotdot-backslash-onto-root", path: "..\\" });
    out.push({ form: "nested-dotdot-onto-root", path: "src/.." });
    out.push({ form: "inner-collapse", path: "a/../b" });
    out.push({ form: "inner-collapse-deep", path: "src/lib/../util/mod.ts" });
    out.push({ form: "leading-inner-traversal", path: "./src/../src/mod.ts" });
    out.push({ form: "triple-collapse", path: "a/b/../../../c" });
  }
  // VCS metadata and degenerate inputs.
  for (const p of [
    ".git/config",
    ".git/hooks/pre-commit",
    "sub/.git/config",
    "a/b/.git/HEAD",
    ".GIT/config",
    ".Git/HEAD",
    "",
    "   ",
    "\0",
    "bad\0path.txt",
  ]) {
    out.push({ form: "vcs-or-degenerate", path: p });
  }
  // Random slash/backslash mixes that ALWAYS carry a hostile segment.
  // ('.' alone is contained — it resolves onto the root — so it is NOT
  // treated as hostile here; the documented rejections are '..', '.git',
  // absolute/drive/UNC forms.)
  const hostilePieces = ["..", ".", "a", "src", ".git", ".GiT"];
  for (let i = 0; i < 60; i++) {
    const n = 1 + rng.int(5);
    const parts: string[] = [];
    let hasHostile = false;
    for (let j = 0; j < n; j++) {
      const p = rng.pick(hostilePieces);
      if (p === ".." || p.toLowerCase() === ".git") hasHostile = true;
      parts.push(p);
    }
    if (!hasHostile) parts[rng.int(parts.length)] = "..";
    const sepCh = rng.next() < 0.5 ? "/" : "\\";
    out.push({ form: "random-mix", path: parts.join(sepCh) });
  }
  return out;
}

describe("resolveContainedPath properties over generated corpora", () => {
  it("legal relative paths always resolve strictly inside the root", () => {
    const rng = makeRng(SEED ^ 0xf1);
    for (const p of legalPaths(rng)) {
      let full: string | undefined;
      try {
        full = resolveContainedPath(ROOT, p);
      } catch (e) {
        expect.fail(`legal path ${JSON.stringify(p)} was rejected: ${String(e)}`);
      }
      expect(full!.startsWith(ROOT + sep) || full === join(ROOT, p)).toBe(true);
      const rel = relative(ROOT, full!);
      expect(rel).not.toBe("");
      expect(rel.startsWith("..")).toBe(false);
    }
  });

  it("every hostile form is rejected with PathPolicyError specifically", () => {
    const rng = makeRng(SEED ^ 0xf2);
    const hostiles = hostilePaths(rng);
    let rejected = 0;
    for (const { form, path } of hostiles) {
      let err: unknown;
      try {
        resolveContainedPath(ROOT, path);
      } catch (e) {
        err = e;
      }
      expect(
        err,
        `${form} path ${JSON.stringify(path)} must be rejected`,
      ).toBeInstanceOf(PathPolicyError);
      rejected++;
    }
    expect(rejected).toBe(hostiles.length);
    expect(rejected).toBeGreaterThanOrEqual(120);
  });

  it("'..' segments are rejected EVEN WHEN they normalize inside the root", () => {
    // These are the cases where the final containment check alone would pass
    // the request through; the explicit segment rejection is the only guard.
    const innerCases = ["..", "../", "src/..", "a/../b", "src/lib/../util/mod.ts", "a/b/../../../c"];
    for (const p of innerCases) {
      expect(() => resolveContainedPath(ROOT, p), JSON.stringify(p)).toThrow(PathPolicyError);
    }
  });

  it(".git rejection is case-insensitive across separators", () => {
    for (const p of [".git/x", "a\\.git\\y", ".GIT/config", "pkg/.Git/HEAD"]) {
      expect(() => resolveContainedPath(ROOT, p)).toThrow(/VCS metadata/);
    }
  });

  it("NUL bytes and blank paths are rejected before any resolution", () => {
    for (const p of ["\0", "bad\0path.txt", "", "   "]) {
      expect(() => resolveContainedPath(ROOT, p)).toThrow(PathPolicyError);
    }
  });
});
