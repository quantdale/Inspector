import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ArtifactMetadata {
  sha256: string;
  mime: string;
  size: number;
  path: string;
  runId: string;
  storedAt: string;
}

export interface WriteOptions {
  runId: string;
  content: Buffer;
  mime: string;
  name?: string;
}

export interface ReadOptions {
  /** Skip hash verification on read. Only for hot paths; default verifies. */
  verify?: boolean;
}

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}

/** A runId/sha256/name/baseDir was rejected before it could reach the filesystem. */
export class PathPolicyError extends ArtifactStoreError {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

/** Stored bytes no longer match their content address. */
export class CorruptionError extends ArtifactStoreError {
  constructor(message: string) {
    super(message);
    this.name = "CorruptionError";
  }
}

// Single path segment, same shape as the protocol ID pattern.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Names may carry an extension; separators, drive letters, and percent-encoded
// traversal are rejected outright.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new PathPolicyError(`unsafe runId: ${JSON.stringify(runId)}`);
  }
}

function assertSha256(sha256: string): void {
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    throw new PathPolicyError(`unsafe sha256: ${JSON.stringify(sha256)}`);
  }
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new PathPolicyError(`unsafe artifact name: ${JSON.stringify(name)}`);
  }
}

/** Classify a path without following symlinks. */
function lstatType(path: string): "absent" | "file" | "dir" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return "absent";
  }
  if (st.isFile()) return "file";
  if (st.isDirectory()) return "dir";
  return "other";
}

export class ArtifactStore {
  private readonly index = new Map<string, ArtifactMetadata>();
  private readonly baseAbs: string;

  constructor(
    baseDir: string,
    private readonly opts: { maxBytes?: number } = {},
  ) {
    if (typeof baseDir !== "string" || baseDir.length === 0) {
      throw new PathPolicyError("baseDir must be a non-empty string");
    }
    const resolved = resolve(baseDir);
    if (dirname(resolved) === resolved) {
      throw new PathPolicyError(`baseDir must not be a filesystem root: ${resolved}`);
    }
    this.baseAbs = resolved;
  }

  /** Refuse any resolved path that is not strictly inside the store base. */
  private contain(p: string): string {
    const resolved = resolve(p);
    const rel = relative(this.baseAbs, resolved);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PathPolicyError(`artifact path escapes store base: ${p}`);
    }
    return resolved;
  }

  private runDir(runId: string): string {
    assertRunId(runId);
    return this.contain(join(this.baseAbs, runId, "artifacts"));
  }

  /**
   * Refuse a run directory that exists but is not a real directory inside the
   * store (e.g. a symlink pointing elsewhere), before anything is created in it.
   */
  private ensureRunDirSafe(runId: string): string {
    const dir = this.runDir(runId);
    const runPath = join(this.baseAbs, runId);
    const t = lstatType(runPath);
    if (t === "dir") {
      this.contain(realpathSync(runPath)); // a symlinked run dir would escape
    } else if (t !== "absent") {
      throw new PathPolicyError(`refusing non-directory run path: ${runPath}`);
    }
    return dir;
  }

  /**
   * Write content to a unique temp file ('wx' guards against planted temp
   * paths) and atomically rename it onto the destination.
   */
  private atomicWrite(dest: string, content: Buffer): void {
    const tmp = `${dest}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tmp, content, { flag: "wx" });
      renameSync(tmp, dest);
    } finally {
      // Best-effort cleanup when rename failed; after a successful rename the
      // temp path no longer exists and unlink fails harmlessly.
      try {
        unlinkSync(tmp);
      } catch {
        /* already renamed or never created */
      }
    }
  }

  write(options: WriteOptions): ArtifactMetadata {
    assertRunId(options.runId);
    if (options.name !== undefined) assertName(options.name);
    if (this.opts.maxBytes !== undefined && options.content.byteLength > this.opts.maxBytes) {
      throw new ArtifactStoreError(
        `artifact size ${options.content.byteLength} exceeds limit ${this.opts.maxBytes}`,
      );
    }
    const sha256 = createHash("sha256").update(options.content).digest("hex");
    const dir = this.ensureRunDirSafe(options.runId);
    const fileName = options.name ? `${sha256}-${options.name}` : sha256;
    const absPath = this.contain(join(dir, fileName));

    const destType = lstatType(absPath); // lstat: never follow a planted link
    if (destType === "file") {
      // Dedup only when the stored bytes are intact; a truncated or tampered
      // canonical file is repaired from the freshly hashed content.
      const disk = readFileSync(absPath);
      const diskSha = createHash("sha256").update(disk).digest("hex");
      if (disk.byteLength !== options.content.byteLength || diskSha !== sha256) {
        this.atomicWrite(absPath, options.content);
      }
    } else {
      if (destType !== "absent") {
        throw new PathPolicyError(`refusing non-regular artifact destination: ${absPath}`);
      }
      mkdirSync(dir, { recursive: true });
      // A symlinked path segment could redirect writes; re-check containment
      // against the real location before writing through it.
      this.contain(realpathSync(dir));
      this.atomicWrite(absPath, options.content);
    }

    const meta: ArtifactMetadata = {
      sha256,
      mime: options.mime,
      size: statSync(absPath).size, // disk truth, not requested length
      path: absPath,
      runId: options.runId,
      storedAt: new Date().toISOString(),
    };
    this.index.set(this.key(options.runId, sha256), meta);
    return meta;
  }

  private key(runId: string, sha256: string): string {
    return `${runId}:${sha256}`;
  }

  read(runId: string, sha256: string, opts: ReadOptions = {}): Buffer {
    const meta = this.meta(runId, sha256);
    if (!meta) throw new ArtifactStoreError(`artifact not found: ${sha256}`);
    const content = readFileSync(meta.path);
    if (opts.verify !== false) {
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== sha256) {
        throw new CorruptionError(`artifact corruption detected on read: ${sha256}`);
      }
    }
    return content;
  }

  meta(runId: string, sha256: string): ArtifactMetadata | undefined {
    assertRunId(runId);
    assertSha256(sha256);
    const cached = this.index.get(this.key(runId, sha256));
    if (cached) return cached;
    const absPath = this.contain(join(this.runDir(runId), sha256));
    let stat: Stats;
    try {
      stat = statSync(absPath);
    } catch {
      return undefined; // absent
    }
    // Never surface metadata for an entry that resolves outside the store.
    this.contain(realpathSync(absPath));
    if (!stat.isFile()) return undefined;
    return {
      sha256,
      mime: "application/octet-stream",
      size: stat.size,
      path: absPath,
      runId,
      storedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  /** Recompute the hash of stored content and compare to the recorded sha256. */
  verify(runId: string, sha256: string): boolean {
    const meta = this.meta(runId, sha256);
    if (!meta) return false;
    const content = readFileSync(meta.path);
    const actual = createHash("sha256").update(content).digest("hex");
    return actual === sha256;
  }

  /** Detect corruption by reading; throws if the stored hash does not match content. */
  verifyStrict(runId: string, sha256: string): void {
    const meta = this.meta(runId, sha256);
    if (!meta) throw new ArtifactStoreError(`artifact not found: ${sha256}`);
    if (!this.verify(runId, sha256)) {
      throw new CorruptionError(`artifact corruption detected: ${sha256}`);
    }
  }

  relativePath(runId: string, sha256: string): string | undefined {
    const meta = this.meta(runId, sha256);
    if (!meta) return undefined;
    return relative(this.baseAbs, meta.path);
  }

  clear(): void {
    // Defensive re-check; the constructor already rejects roots and empty paths.
    if (dirname(this.baseAbs) === this.baseAbs) {
      throw new PathPolicyError(`refusing to clear filesystem root: ${this.baseAbs}`);
    }
    rmSync(this.baseAbs, { recursive: true, force: true });
    this.index.clear();
  }
}
