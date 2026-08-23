import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const run = promisify(execFile);

export interface GitResult {
  stdout: string;
}

/** Raised when a path violates the source-write policy (spec 004 P0/P3). */
export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

/** Raised when repository provenance cannot be established (fail closed). */
export class ProvenanceError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options ? { cause: options.cause } : undefined);
    this.name = "ProvenanceError";
  }
}

/**
 * Resolve `relPath` strictly inside `rootDir` (source-write policy).
 * Rejects absolute paths, drive-letter/UNC forms, `..` traversal and any
 * `.git` segment; everything else must resolve under the root prefix.
 */
export function resolveContainedPath(rootDir: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new PathPolicyError(`invalid workspace path: ${JSON.stringify(relPath)}`);
  }
  if (relPath.includes("\0")) {
    throw new PathPolicyError(`path contains NUL byte: ${JSON.stringify(relPath)}`);
  }
  if (isAbsolute(relPath) || /^[a-zA-Z]:[\\/]/.test(relPath) || /^\\\\/.test(relPath) || /^\/\//.test(relPath)) {
    throw new PathPolicyError(`absolute paths are not allowed: ${relPath}`);
  }
  const segments = relPath.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw new PathPolicyError(`path traversal is not allowed: ${relPath}`);
  }
  if (segments.some((s) => s.toLowerCase() === ".git")) {
    throw new PathPolicyError(`VCS metadata is not patchable: ${relPath}`);
  }
  const root = resolve(rootDir);
  const full = resolve(root, relPath);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (full !== root && !full.startsWith(prefix)) {
    throw new PathPolicyError(`path escapes the workspace root: ${relPath}`);
  }

  // Lexical containment is not sufficient when a repository contains a
  // symlink, junction, or other reparse point. Resolve the root and the
  // nearest existing path component before allowing a read/write. For a new
  // file, the nearest existing ancestor is the strongest check available
  // before mkdir/write creates the missing suffix. Any real path lookup
  // failure is a policy refusal rather than an optimistic fallback.
  let realRoot: string;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    throw new PathPolicyError(`workspace root cannot be resolved: ${root}`);
  }

  let probe = full;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) {
      throw new PathPolicyError(`workspace path cannot be resolved: ${relPath}`);
    }
    probe = parent;
  }

  let realProbe: string;
  try {
    // realpath follows symlinks and Windows junction/reparse points. The
    // native implementation preserves the platform's canonical spelling.
    realProbe = realpathSync.native(probe);
    // lstat makes dangling symlinks fail closed instead of looking like a
    // missing ordinary path during the ancestor walk.
    lstatSync(probe);
  } catch {
    throw new PathPolicyError(`workspace path cannot be resolved: ${relPath}`);
  }

  const comparisonRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  const comparisonProbe = process.platform === "win32" ? realProbe.toLowerCase() : realProbe;
  const realRelative = relative(comparisonRoot, comparisonProbe);
  if (
    isAbsolute(realRelative) ||
    realRelative === ".." ||
    realRelative.startsWith(`..${sep}`)
  ) {
    throw new PathPolicyError(`path escapes the real workspace root: ${relPath}`);
  }
  return full;
}

const disposeDelayMs = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Exact-revision repair workspace (M4 P0). A linked, detached git worktree is
 * created OUTSIDE the primary checkout so autonomous source modification can
 * never touch the operator's tree. Rollback restores the exact revision;
 * dispose removes the worktree entirely.
 */
export class RepairWorkspace {
  private constructor(
    readonly repoRoot: string,
    readonly revision: string,
    private readonly wtPath: string,
    private readonly baseDir: string,
  ) {}

  get path(): string {
    return this.wtPath;
  }

  /**
   * Create a detached worktree at `revision` under a fresh temp directory.
   * Fails closed when provenance cannot be established: a failing `git
   * status` is treated as refusal, not as a clean repository.
   */
  static async create(
    repoRoot: string,
    revision: string,
    baseDir: string = mkdtempSync(join(tmpdir(), "inspector-repair-")),
  ): Promise<RepairWorkspace> {
    let status: GitResult;
    try {
      status = await run("git", ["-C", repoRoot, "status", "--porcelain"]);
    } catch (err) {
      throw new ProvenanceError(
        `git status failed for repository at ${repoRoot}; refusing to create repair workspace`,
        { cause: err },
      );
    }
    if (status.stdout.trim().length > 0) {
      throw new ProvenanceError(
        "repository has uncommitted changes; refusing to create repair workspace",
      );
    }
    const wtPath = join(baseDir, "wt");
    try {
      await run("git", ["-C", repoRoot, "worktree", "add", "--detach", wtPath, revision]);
    } catch (err) {
      throw new ProvenanceError(`failed to create repair worktree at ${revision}`, { cause: err });
    }
    return new RepairWorkspace(repoRoot, revision, wtPath, baseDir);
  }

  async isClean(): Promise<boolean> {
    const { stdout } = await run("git", ["-C", this.wtPath, "status", "--porcelain"]);
    return stdout.trim().length === 0;
  }

  /** Restore every tracked file to the exact revision and drop extras. */
  async rollback(): Promise<void> {
    await run("git", ["-C", this.wtPath, "checkout", "--", "."]);
    await run("git", ["-C", this.wtPath, "clean", "-fd"]).catch(() => undefined);
  }

  /** Detached HEAD commit of this worktree. */
  async headCommit(): Promise<string> {
    const { stdout } = await run("git", ["-C", this.wtPath, "rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async readFile(relPath: string): Promise<string> {
    const full = resolveContainedPath(this.wtPath, relPath);
    const { readFile } = await import("node:fs/promises");
    return readFile(full, "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const full = resolveContainedPath(this.wtPath, relPath);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  /** List tracked files at this revision. */
  async listFiles(): Promise<string[]> {
    const { stdout } = await run("git", ["-C", this.wtPath, "ls-files"]);
    return stdout.split(/\r?\n/).filter((l) => l.length > 0);
  }

  /**
   * Remove the worktree AND its temp base directory. Best-effort and
   * non-throwing: dispose runs in finally blocks and must never mask the
   * primary error. On Windows rmSync can hit EBUSY/EPERM while handles are
   * still open, so removal retries a bounded number of times.
   */
  async dispose(): Promise<void> {
    await run("git", ["-C", this.repoRoot, "worktree", "remove", "--force", this.wtPath]).catch(
      () => undefined,
    );
    // Prune stale admin entries when the remove above failed.
    await run("git", ["-C", this.repoRoot, "worktree", "prune"]).catch(() => undefined);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        rmSync(this.baseDir, { recursive: true, force: true });
        return;
      } catch {
        await disposeDelayMs(25 * (attempt + 1));
      }
    }
    // Final failure tolerated: a leaked temp dir is preferable to masking
    // the error that dispose was called to clean up after.
  }
}
