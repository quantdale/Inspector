import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const run = promisify(execFile);

export interface GitResult {
  stdout: string;
}

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
  ) {}

  get path(): string {
    return this.wtPath;
  }

  /**
   * Create a detached worktree at `revision` under a fresh temp directory.
   * Refuses when the source repository has uncommitted changes (provenance
   * must be unambiguous).
   */
  static async create(
    repoRoot: string,
    revision: string,
    baseDir: string = mkdtempSync(join(tmpdir(), "inspector-repair-")),
  ): Promise<RepairWorkspace> {
    const status = await run("git", ["-C", repoRoot, "status", "--porcelain"]).catch(
      () => ({ stdout: "" }) as GitResult,
    );
    if (status.stdout.trim().length > 0) {
      throw new Error("repository has uncommitted changes; refusing to create repair workspace");
    }
    const wtPath = join(baseDir, "wt");
    await run("git", ["-C", repoRoot, "worktree", "add", "--detach", wtPath, revision]);
    return new RepairWorkspace(repoRoot, revision, wtPath);
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

  async readFile(relPath: string): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    return readFile(join(this.wtPath, relPath), "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const full = join(this.wtPath, relPath);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  /** List tracked files at this revision. */
  async listFiles(): Promise<string[]> {
    const { stdout } = await run("git", ["-C", this.wtPath, "ls-files"]);
    return stdout.split(/\r?\n/).filter((l) => l.length > 0);
  }

  async dispose(): Promise<void> {
    await run("git", ["-C", this.repoRoot, "worktree", "remove", "--force", this.wtPath]).catch(
      () => undefined,
    );
    rmSync(this.wtPath, { recursive: true, force: true });
  }
}
