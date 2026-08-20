import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}

export class ArtifactStore {
  private readonly index = new Map<string, ArtifactMetadata>();

  constructor(
    private readonly baseDir: string,
    private readonly opts: { maxBytes?: number } = {},
  ) {}

  private runDir(runId: string): string {
    return join(this.baseDir, runId, "artifacts");
  }

  write(options: WriteOptions): ArtifactMetadata {
    if (this.opts.maxBytes !== undefined && options.content.byteLength > this.opts.maxBytes) {
      throw new ArtifactStoreError(
        `artifact size ${options.content.byteLength} exceeds limit ${this.opts.maxBytes}`,
      );
    }
    const sha256 = createHash("sha256").update(options.content).digest("hex");
    const dir = this.runDir(options.runId);
    const fileName = options.name ? `${sha256}-${options.name}` : sha256;
    const absPath = join(dir, fileName);

    if (!existsSync(absPath)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(absPath, options.content);
    }

    const meta: ArtifactMetadata = {
      sha256,
      mime: options.mime,
      size: options.content.byteLength,
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

  read(runId: string, sha256: string): Buffer {
    const meta = this.meta(runId, sha256);
    if (!meta) throw new ArtifactStoreError(`artifact not found: ${sha256}`);
    return readFileSync(meta.path);
  }

  meta(runId: string, sha256: string): ArtifactMetadata | undefined {
    const cached = this.index.get(this.key(runId, sha256));
    if (cached) return cached;
    const absPath = join(this.runDir(runId), sha256);
    if (!existsSync(absPath)) return undefined;
    const stat = statSync(absPath);
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
      throw new ArtifactStoreError(`artifact corruption detected: ${sha256}`);
    }
  }

  relativePath(runId: string, sha256: string): string | undefined {
    const meta = this.meta(runId, sha256);
    if (!meta) return undefined;
    return relative(this.baseDir, meta.path);
  }

  clear(): void {
    rmSync(this.baseDir, { recursive: true, force: true });
    this.index.clear();
  }
}
