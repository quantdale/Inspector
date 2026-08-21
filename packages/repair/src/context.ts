import type { RepairWorkspace } from "./worktree.js";
import type { PatchContext } from "./types.js";

export interface SourceContext {
  files: Array<{ path: string; content: string }>;
  truncated: boolean;
  bytes: number;
}

/**
 * Compact repository/context selector (M4 P1). Ranks tracked files by hint
 * overlap (error text tokens, UI selectors) and packs as many as fit into a
 * byte budget so a repair agent receives a small, relevant packet instead of
 * the whole repository.
 */
export class SourceContextBuilder {
  constructor(private readonly maxBytes: number = 32 * 1024) {}

  async build(
    workspace: RepairWorkspace,
    hints: { errorText?: string; selectors?: string[]; preferredPaths?: string[] } = {},
  ): Promise<SourceContext> {
    const tokens = new Set<string>();
    for (const t of (hints.errorText ?? "").toLowerCase().matchAll(/[a-z0-9_-]{4,}/g)) {
      tokens.add(t[0]);
    }
    for (const s of hints.selectors ?? []) {
      const id = s.replace(/^[#.[]+/, "").replace(/["\]]$/g, "");
      if (id.length >= 3) tokens.add(id.toLowerCase());
    }

    const all = await workspace.listFiles();
    const preferred = new Set(hints.preferredPaths ?? []);
    const scored: Array<{ path: string; score: number }> = [];
    for (const p of all) {
      let score = preferred.has(p) ? 100 : 0;
      if (tokens.size > 0) {
        try {
          const content = (await workspace.readFile(p)).toLowerCase();
          for (const t of tokens) if (content.includes(t)) score += 10;
        } catch {
          /* unreadable file scores 0 */
        }
      }
      scored.push({ path: p, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    const files: SourceContext["files"] = [];
    let bytes = 0;
    let truncated = false;
    for (const { path } of scored) {
      let content: string;
      try {
        content = await workspace.readFile(path);
      } catch {
        continue;
      }
      if (bytes + content.length > this.maxBytes) {
        truncated = true;
        continue;
      }
      files.push({ path, content });
      bytes += content.length;
    }
    return { files, truncated, bytes };
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
