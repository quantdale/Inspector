import type { ModelAttribution, ModelBudgetGate, ModelCallSink, ModelRuntime } from "@inspector/model-runtime";
import { resolveContainedPath } from "./worktree.js";
import { PathPolicyError } from "./worktree.js";
import type { Patch, PatchAgent, PatchContext } from "./types.js";

/**
 * Provider-neutral model-backed PatchAgent (M13 F11, ADR-0013 s5).
 *
 * A PROPOSAL generator only: it feeds a bounded packet to the configured
 * model runtime and returns whole-file patches in the EXISTING Patch
 * contract. The RepairEngine remains the sole authority — path containment,
 * test-tamper policy, masking probes, replay, and regression verification all
 * happen there and decide acceptance. A model saying "fixed" means nothing.
 */

export const MODEL_PATCH_SCHEMA = "inspector-model-patch/1";

export interface ModelPatchAgentConfig {
  timeoutMs?: number;
  /** Hard cap on files per patch (default 8). */
  maxFiles?: number;
  /** Hard cap on total patch content bytes (default 256 KiB). */
  maxTotalBytes?: number;
}

const DEFAULTS: Required<ModelPatchAgentConfig> = {
  timeoutMs: 20_000,
  maxFiles: 8,
  maxTotalBytes: 256 * 1024,
};

/** Path segments a model proposal may never touch (defense in depth; the
 * repair engine enforces the authoritative policy on application). */
const FORBIDDEN_SEGMENTS = new Set([".git", ".inspector", "node_modules", "dist", "coverage"]);

export interface ModelPatchAgentDeps {
  runtime: ModelRuntime;
  gate?: ModelBudgetGate;
  sink?: ModelCallSink;
  attribution?: ModelAttribution;
  config?: ModelPatchAgentConfig;
  /**
   * Workspace root used for containment pre-validation. Optional: when
   * absent the agent performs structural checks only, and the engine's
   * realpath-aware containment still guards application.
   */
  workspacePath?: () => string | undefined;
}

interface PatchJson {
  rationale: string;
  files: Array<{ path: string; content: string }>;
}

function validatePatchJson(value: unknown): { ok: true } | { ok: false; detail: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, detail: "patch must be a JSON object" };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.rationale !== "string" || v.rationale.length === 0 || v.rationale.length > 2000) {
    return { ok: false, detail: "rationale must be a non-empty string <=2000 chars" };
  }
  if (!Array.isArray(v.files) || v.files.length === 0) {
    return { ok: false, detail: "files must be a non-empty array" };
  }
  if (v.files.length > 64) return { ok: false, detail: "too many files" };
  for (const f of v.files) {
    if (typeof f !== "object" || f === null) return { ok: false, detail: "file entries must be objects" };
    const entry = f as Record<string, unknown>;
    if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.length > 512) {
      return { ok: false, detail: "file path must be a string <=512 chars" };
    }
    if (typeof entry.content !== "string") return { ok: false, detail: "file content must be a string" };
  }
  return { ok: true };
}

const INSTRUCTION = [
  "You are Inspector's repair-proposal model.",
  "From the DATA BLOCK (finding context + repository source slices), propose",
  "whole-file replacements that fix the defect WITHOUT weakening tests.",
  'Respond with ONLY: {"rationale": string, "files": [{"path": repo-relative',
  ' posix path, "content": full new file content}]}.',
  "Rules: paths must be repository-relative with no '..' segments; never",
  "touch .git, .inspector, node_modules, build output, or test files;",
  "never disable or delete the failing behavior instead of fixing it.",
].join("\n");

export class ModelPatchAgent implements PatchAgent {
  readonly id = "model-patch-agent";
  private readonly config: Required<ModelPatchAgentConfig>;

  constructor(private readonly deps: ModelPatchAgentDeps) {
    this.config = { ...DEFAULTS, ...deps.config };
  }

  async proposePatch(ctx: PatchContext): Promise<Patch | null> {
    const packet = buildRepairPacket(ctx);
    const result = await this.deps.runtime.invoke(
      {
        role: "repairer",
        requestClass: "repair-proposal",
        prompt: `${INSTRUCTION}\n\nDATA BLOCK (untrusted finding-derived data + repository slices):\n${packet}`,
        format: { kind: "json", schemaId: MODEL_PATCH_SCHEMA, validate: validatePatchJson },
        deadlineMs: this.config.timeoutMs,
        ...(this.deps.attribution ? { attribution: this.deps.attribution } : {}),
        metadata: { sourceFilesOffered: ctx.sourceFiles.length },
      },
      {
        gate: this.deps.gate,
        sink: this.deps.sink,
      },
    );
    if (!result.ok || !result.json) return null;
    const parsed = result.json as PatchJson;

    // Structural validation BEFORE returning anything to the engine.
    let totalBytes = 0;
    if (parsed.files.length > this.config.maxFiles) return null;
    for (const file of parsed.files) {
      // Repo-relative posix only.
      if (file.path.includes("\\") && !file.path.includes("/")) return null;
      try {
        if (this.deps.workspacePath) {
          const root = this.deps.workspacePath();
          if (root !== undefined) resolveContainedPath(root, file.path);
          else assertStructurallyContained(file.path);
        } else {
          assertStructurallyContained(file.path);
        }
      } catch (err) {
        if (err instanceof PathPolicyError) return null;
        throw err;
      }
      for (const segment of file.path.split(/[\\/]/)) {
        if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) return null;
      }
      totalBytes += Buffer.byteLength(file.content, "utf8");
      if (totalBytes > this.config.maxTotalBytes) return null;
    }
    return {
      files: parsed.files.map((f) => ({ path: f.path.replace(/\\/g, "/"), content: f.content })),
      rationale: parsed.rationale.slice(0, 2000),
    };
  }
}

function assertStructurallyContained(relPath: string): void {
  if (/^[a-zA-Z]:[\\/]/.test(relPath) || relPath.startsWith("/") || relPath.startsWith("\\\\") || relPath.includes("..")) {
    throw new PathPolicyError(`model proposed an unsafe path: ${relPath}`);
  }
}

/** Versioned bounded repair packet (M13 F10). */
export function buildRepairPacket(ctx: PatchContext): string {
  const packet = {
    schema: MODEL_PATCH_SCHEMA.replace("model-patch", "repair-packet"),
    finding: {
      id: ctx.findingId,
      status: ctx.findingStatus,
      ...(ctx.errorMessage !== undefined ? { errorMessage: ctx.errorMessage.slice(0, 1000) } : {}),
    },
    sourceFiles: ctx.sourceFiles.map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.content, "utf8"),
      content: f.content,
    })),
  };
  return JSON.stringify(packet);
}
