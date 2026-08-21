import type { Patch, PatchAgent, PatchContext } from "./types.js";

/** Bounded patch-attempt budget (M4 P3). */
export class PatchBudget {
  private used = 0;
  constructor(readonly maxAttempts: number) {}
  consume(): boolean {
    if (this.used >= this.maxAttempts) return false;
    this.used += 1;
    return true;
  }
  get attemptsUsed(): number {
    return this.used;
  }
}

/**
 * Deterministic scripted repair agent. Maps a predicate over file content to
 * a whole-file transform. Used for the M4 proof loop; a real model-driven
 * agent implements the same `PatchAgent` contract with the same budget and
 * verification gates.
 */
export class ScriptedPatchAgent implements PatchAgent {
  readonly id: string;

  constructor(
    id: string,
    private readonly rules: Array<{
      /** Returns the fixed content, or null when this rule does not apply. */
      apply: (path: string, content: string) => string | null;
    }>,
  ) {
    this.id = id;
  }

  async proposePatch(ctx: PatchContext): Promise<Patch | null> {
    const files: Patch["files"] = [];
    for (const f of ctx.sourceFiles) {
      for (const rule of this.rules) {
        const fixed = rule.apply(f.path, f.content);
        if (fixed !== null && fixed !== f.content) {
          files.push({ path: f.path, content: fixed });
          break;
        }
      }
    }
    if (files.length === 0) return null;
    return { files, rationale: "scripted fix" };
  }
}
