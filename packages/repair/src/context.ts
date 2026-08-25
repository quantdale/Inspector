import type { RepairWorkspace } from "./worktree.js";
import type { PatchContext } from "./types.js";
import { rankSourceFiles, type RankedSourceFile } from "./source-intel.js";

export interface SourceContext {
  files: Array<{ path: string; content: string }>;
  truncated: boolean;
  bytes: number;
}

/** Richer diagnosis context (M13 F10): ranking provenance + truncation truth. */
export interface DetailedSourceContext extends SourceContext {
  revision?: string | null;
  ranked: RankedSourceFile[];
  slices: Array<{ path: string; bytes: number; truncatedSlice: boolean; reason: string[] }>;
  nearbyTests: string[];
}

export interface SourceContextHints {
  errorText?: string;
  selectors?: string[];
  preferredPaths?: string[];
  /** M13 F9 additions — all optional; absence simply means no signal. */
  referencedPaths?: string[];
  changedPaths?: string[];
  previousAttemptPaths?: string[];
  revision?: string | null;
}

/**
 * Compact repository/context selector (M4 P1; M13 F9/F10 re-platformed onto
 * deterministic source intelligence). Ranks tracked files by preferred /
 * referenced / changed / prior-attempt / error-token / selector / import
 * proximity signals and packs as many as fit into a byte budget so a repair
 * agent receives a small, relevant, AUDITABLE packet instead of the whole
 * repository.
 */
export class SourceContextBuilder {
  constructor(private readonly maxBytes: number = 32 * 1024) {}

  async build(workspace: RepairWorkspace, hints: SourceContextHints = {}): Promise<SourceContext> {
    const detailed = await this.buildDetailed(workspace, hints);
    return { files: detailed.files, truncated: detailed.truncated, bytes: detailed.bytes };
  }

  /**
   * Full context with ranking reasons, per-file slice metadata, nearby test
   * candidates, and honest truncation accounting.
   */
  async buildDetailed(workspace: RepairWorkspace, hints: SourceContextHints = {}): Promise<DetailedSourceContext> {
    const all = await workspace.listFiles();
    const ranked = await rankSourceFiles({
      files: all,
      readFile: async (p) => {
        try {
          return await workspace.readFile(p);
        } catch {
          return null;
        }
      },
      ...(hints.errorText !== undefined ? { errorText: hints.errorText } : {}),
      ...(hints.selectors !== undefined ? { selectors: hints.selectors } : {}),
      ...(hints.preferredPaths !== undefined ? { preferredPaths: hints.preferredPaths } : {}),
      ...(hints.referencedPaths !== undefined ? { referencedPaths: hints.referencedPaths } : {}),
      // Changed-path signal requires an explicitly provided comparison base;
      // the workspace NEVER invents one (revision provenance stays exact).
      ...(hints.changedPaths !== undefined ? { changedPaths: hints.changedPaths } : {}),
      ...(hints.previousAttemptPaths !== undefined
        ? { previousAttemptPaths: hints.previousAttemptPaths }
        : {}),
    });

    const files: SourceContext["files"] = [];
    const slices: DetailedSourceContext["slices"] = [];
    let bytes = 0;
    let truncated = false;
    for (const entry of ranked) {
      let content: string;
      try {
        content = await workspace.readFile(entry.path);
      } catch {
        continue;
      }
      if (bytes + content.length > this.maxBytes) {
        // Deterministic bounded slice: take the head of the file that still
        // fits so the packet ceiling is respected without dropping the file.
        const remaining = this.maxBytes - bytes;
        if (remaining > 512) {
          content = content.slice(0, remaining);
          bytes += content.length;
          truncated = true;
          files.push({ path: entry.path, content });
          slices.push({ path: entry.path, bytes: content.length, truncatedSlice: true, reason: entry.reasons });
        } else {
          truncated = true;
        }
        continue;
      }
      bytes += content.length;
      files.push({ path: entry.path, content });
      slices.push({ path: entry.path, bytes: content.length, truncatedSlice: false, reason: entry.reasons });
    }
    const nearbyTests = [...new Set(ranked.flatMap((r) => r.nearbyTests))];
    return {
      files,
      truncated,
      bytes,
      ...(hints.revision !== undefined ? { revision: hints.revision } : {}),
      ranked,
      slices,
      nearbyTests,
    };
  }

  toPatchContext(
    source: SourceContext,
    meta: { findingId: string; findingStatus: PatchContext["findingStatus"]; errorMessage?: string },
  ): PatchContext {
    return {
      findingId: meta.findingId,
      findingStatus: meta.findingStatus,
      errorMessage: meta.errorMessage,
      sourceFiles: source.files,
    };
  }
}
