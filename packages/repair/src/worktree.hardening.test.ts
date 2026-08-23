import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { RepairWorkspace, PathPolicyError, ProvenanceError } from "./worktree.js";

const runGit = promisify(execFile);

async function makeRepo(): Promise<{ repoRoot: string; revision: string }> {
  const base = mkdtempSync(join(tmpdir(), "inspector-wt-unit-"));
  const repoRoot = join(base, "repo");
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "app.txt"), "hello\n");
  const g = async (...args: string[]) => runGit("git", ["-C", repoRoot, ...args]);
  await g("init");
  await g("add", ".");
  await g("-c", "user.name=fixture", "-c", "user.email=fixture@local", "commit", "-m", "seed");
  const { stdout } = await g("rev-parse", "HEAD");
  return { repoRoot, revision: stdout.trim() };
}

describe("RepairWorkspace hardening", () => {
  it("D1: writeFile rejects traversal outside the worktree and nothing lands outside", async () => {
    const { repoRoot, revision } = await makeRepo();
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      await expect(ws.writeFile("../escape.txt", "pwned")).rejects.toThrow(PathPolicyError);
      expect(existsSync(join(ws.path, "..", "escape.txt"))).toBe(false);
    } finally {
      await ws.dispose();
    }
  });

  it("D1: readFile rejects traversal outside the worktree", async () => {
    const { repoRoot, revision } = await makeRepo();
    const outside = mkdtempSync(join(tmpdir(), "inspector-wt-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      await expect(ws.readFile(join(outside, "secret.txt"))).rejects.toThrow(PathPolicyError);
      await expect(ws.readFile("../app.txt")).rejects.toThrow(PathPolicyError);
    } finally {
      await ws.dispose();
    }
  });

  it("D1: rejects absolute, drive-letter, UNC and .git targets; main repo untouched", async () => {
    const { repoRoot, revision } = await makeRepo();
    const probe = mkdtempSync(join(tmpdir(), "inspector-wt-probe-"));
    const absTarget = join(probe, "evil.txt");
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      const hostile = [absTarget, "C:\\Windows\\Temp\\evil.txt", "\\\\host\\share\\evil.txt", "/abs/evil.txt"];
      for (const p of hostile) {
        await expect(ws.writeFile(p, "x")).rejects.toThrow(PathPolicyError);
        await expect(ws.readFile(p)).rejects.toThrow(PathPolicyError);
      }
      // .git metadata is never patchable, in any spelling
      await expect(ws.writeFile(".git/hooks/pre-commit", "#!/bin/sh\nrm -rf /\n")).rejects.toThrow(
        PathPolicyError,
      );
      await expect(
        ws.writeFile("../../.git/hooks/pre-commit", "#!/bin/sh\nrm -rf /\n"),
      ).rejects.toThrow(PathPolicyError);
      // nothing may have landed outside the worktree
      expect(existsSync(absTarget)).toBe(false);
      expect(existsSync(join(ws.path, "..", "..", "evil.txt"))).toBe(false);
      expect(existsSync(join(repoRoot, ".git", "hooks", "pre-commit"))).toBe(false);
    } finally {
      await ws.dispose();
    }
  });

  it("D1: legitimate relative paths still round-trip (no overblocking)", async () => {
    const { repoRoot, revision } = await makeRepo();
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      await ws.writeFile("src/deep/app.txt", "patched\n");
      expect(await ws.readFile("src/deep/app.txt")).toBe("patched\n");
      // autocrlf may give the checked-out file CRLF endings; compare loosely
      expect((await ws.readFile("app.txt")).trim()).toBe("hello");
    } finally {
      await ws.dispose();
    }
  });

  it("D1: rejects symlink escapes for existing and newly-created files", async () => {
    const { repoRoot, revision } = await makeRepo();
    const outside = mkdtempSync(join(tmpdir(), "inspector-wt-symlink-outside-"));
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      const link = join(ws.path, "linked");
      symlinkSync(outside, link, "junction");
      await expect(ws.writeFile("linked/escaped.txt", "pwned")).rejects.toThrow(PathPolicyError);
      await expect(ws.readFile("linked/escaped.txt")).rejects.toThrow(PathPolicyError);
      expect(existsSync(join(outside, "escaped.txt"))).toBe(false);

      const nested = join(ws.path, "nested");
      mkdirSync(nested, { recursive: true });
      const nestedLink = join(nested, "link");
      symlinkSync(outside, nestedLink, "junction");
      await expect(ws.writeFile("nested/link/deeper/escaped.txt", "pwned")).rejects.toThrow(
        PathPolicyError,
      );
      expect(existsSync(join(outside, "deeper", "escaped.txt"))).toBe(false);
    } finally {
      await ws.dispose();
    }
  });

  it("D2: refuses creation when git status fails (non-repository root)", async () => {
    const base = mkdtempSync(join(tmpdir(), "inspector-wt-unit-nc-"));
    const notARepo = join(base, "not-a-repo");
    mkdirSync(notARepo, { recursive: true });
    await expect(RepairWorkspace.create(notARepo, "HEAD")).rejects.toThrow(ProvenanceError);
  });

  it("D2: still refuses a dirty repository", async () => {
    const { repoRoot, revision } = await makeRepo();
    writeFileSync(join(repoRoot, "dirty.txt"), "uncommitted\n");
    await expect(RepairWorkspace.create(repoRoot, revision)).rejects.toThrow(ProvenanceError);
  });

  it("D5: dispose removes the whole temp base dir (no orphaned directories)", async () => {
    const { repoRoot, revision } = await makeRepo();
    const ownBase = mkdtempSync(join(tmpdir(), "inspector-wt-base-"));
    const ws = await RepairWorkspace.create(repoRoot, revision, ownBase);
    await ws.dispose();
    expect(existsSync(ownBase)).toBe(false);
  });

  it("reports the detached HEAD commit of the worktree", async () => {
    const { repoRoot, revision } = await makeRepo();
    const ws = await RepairWorkspace.create(repoRoot, revision);
    try {
      expect(await ws.headCommit()).toBe(revision);
    } finally {
      await ws.dispose();
    }
  });
});
