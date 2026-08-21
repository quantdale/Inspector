import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRepoRoot,
  REPO_ROOT_WARNING,
  remapWorkspaceConflict,
  resolveWorkspaceDir,
} from "./workspace.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), "inspector-cli-ws-"));
  return dir;
}

/** Shape a directory like the Inspector repository root. */
function fakeRepoRoot(base: string): void {
  mkdirSync(join(base, "packages"), { recursive: true });
  mkdirSync(join(base, ".inspector", "state"), { recursive: true });
  writeFileSync(join(base, "package.json"), "{}");
  writeFileSync(join(base, ".inspector", "state", "campaign.yaml"), "mode: IMPLEMENTATION\n");
}

describe("workspace resolution", () => {
  it("prefers the explicit --workspace flag over everything", () => {
    const base = tmp();
    const env = { INSPECTOR_WORKSPACE: join(base, "env") };
    const r = resolveWorkspaceDir(join(base, "flag"), join(base, "cwd"), env);
    expect(r.dir).toBe(join(base, "flag"));
    expect(r.repoRootWarning).toBeNull();
  });

  it("falls back to $INSPECTOR_WORKSPACE when --workspace is absent", () => {
    const base = tmp();
    const r = resolveWorkspaceDir(undefined, join(base, "cwd"), {
      INSPECTOR_WORKSPACE: join(base, "env"),
    });
    expect(r.dir).toBe(join(base, "env"));
    expect(r.repoRootWarning).toBeNull();
  });

  it("falls back to cwd when neither flag nor env is set", () => {
    const base = tmp();
    const r = resolveWorkspaceDir(undefined, join(base, "cwd"), {});
    expect(r.dir).toBe(join(base, "cwd"));
    expect(r.repoRootWarning).toBeNull();
  });

  it("emits the repo-root warning only for a repository-root-shaped directory", () => {
    const base = tmp();
    const repo = join(base, "repo");
    mkdirSync(repo, { recursive: true });
    fakeRepoRoot(repo);
    expect(isRepoRoot(repo)).toBe(true);
    const r = resolveWorkspaceDir(undefined, repo, {});
    expect(r.repoRootWarning).toBe(REPO_ROOT_WARNING);

    // A plain directory (or one missing any marker) is not the repo root.
    expect(isRepoRoot(base)).toBe(false);
    const plain = join(base, "plain");
    mkdirSync(plain, { recursive: true });
    fakeRepoRoot(plain);
    rmSync(join(plain, ".inspector", "state", "campaign.yaml"));
    expect(isRepoRoot(plain)).toBe(false);
  });
});

describe("remapWorkspaceConflict", () => {
  it("maps shared/locked database failures to an actionable CliError", () => {
    for (const message of [
      "UNIQUE constraint failed: actions.idempotency",
      "SQLITE_CONSTRAINT: PRIMARY key must be unique",
      "database is locked",
    ]) {
      const mapped = remapWorkspaceConflict(new Error(message)) as Error;
      expect(mapped).toBeInstanceOf(Error);
      expect(mapped.message).toContain("workspace database is locked");
      expect(mapped.message).toContain("pass --workspace <dir> to isolate");
      expect(mapped.message).toContain(message);
    }
  });

  it("passes unrelated errors through untouched", () => {
    const original = new Error("adapter subprocess exited with code 1");
    expect(remapWorkspaceConflict(original)).toBe(original);
    expect(remapWorkspaceConflict("string error")).toBe("string error");
  });
});
