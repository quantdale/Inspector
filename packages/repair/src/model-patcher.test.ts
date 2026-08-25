import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, ScriptedModelProvider, jsonOutcome } from "@inspector/model-runtime";
import { ModelPatchAgent } from "./model-patcher.js";
import type { PatchContext } from "./types.js";

function ctx(over: Partial<PatchContext> = {}): PatchContext {
  return {
    findingId: "find_1",
    findingStatus: "CONFIRMED",
    errorMessage: "TypeError: boom at submitTodo (src/todo-form.ts:12)",
    sourceFiles: [
      { path: "src/todo-form.ts", content: "export function submitTodo() {\n  throw new Error('boom');\n}" },
      { path: "src/app.ts", content: "import { submitTodo } from './todo-form';" },
    ],
    ...over,
  };
}

const GOOD_PATCH = {
  rationale: "replace the thrown error with correct handling",
  files: [
    {
      path: "src/todo-form.ts",
      content: "export function submitTodo() {\n  return { ok: true };\n}",
    },
  ],
};

describe("M13 F11: provider-neutral model PatchAgent proposals", () => {
  it("returns a validated whole-file patch from a structured model response", async () => {
    const provider = new ScriptedModelProvider({
      id: "fixer",
      respond: jsonOutcome(GOOD_PATCH),
    });
    const agent = new ModelPatchAgent({ runtime: new ModelRuntime().register(provider) });
    const patch = await agent.proposePatch(ctx());
    expect(patch).not.toBeNull();
    expect(patch!.files[0]!.path).toBe("src/todo-form.ts");
    expect(patch!.rationale).toContain("handling");
  });

  it("rejects traversal, absolute, drive-letter, and forbidden-segment paths before the engine sees them", async () => {
    const cases = [
      { rationale: "r", files: [{ path: "../../etc/passwd", content: "x" }] },
      { rationale: "r", files: [{ path: "C:\\repo\\app.ts", content: "x" }] },
      { rationale: "r", files: [{ path: "/etc/cron.d/evil", content: "x" }] },
      { rationale: "r", files: [{ path: ".git/hooks/pre-commit", content: "x" }] },
      { rationale: "r", files: [{ path: ".inspector/state/campaign.yaml", content: "x" }] },
      { rationale: "r", files: [{ path: "node_modules/left-pad/index.js", content: "x" }] },
    ];
    for (const bad of cases) {
      const provider = new ScriptedModelProvider({ id: "p", respond: jsonOutcome(bad) });
      const agent = new ModelPatchAgent({
        runtime: new ModelRuntime().register(provider),
        workspacePath: () => mkdtempSync(join(tmpdir(), "inspector-patch-")),
      });
      expect(await agent.proposePatch(ctx())).toBeNull();
    }
  });

  it("enforces file-count and total-byte caps", async () => {
    const manyFiles = {
      rationale: "spray",
      files: Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, content: "// tiny" })),
    };
    const agent = new ModelPatchAgent({
      runtime: new ModelRuntime().register(new ScriptedModelProvider({ id: "p", respond: jsonOutcome(manyFiles) })),
      config: { maxFiles: 8 },
    });
    expect(await agent.proposePatch(ctx())).toBeNull();

    const huge = {
      rationale: "huge",
      files: [{ path: "src/big.ts", content: "x".repeat(400 * 1024) }],
    };
    const byteAgent = new ModelPatchAgent({
      runtime: new ModelRuntime().register(new ScriptedModelProvider({ id: "q", respond: jsonOutcome(huge) })),
      config: { maxTotalBytes: 256 * 1024 },
    });
    expect(await byteAgent.proposePatch(ctx())).toBeNull();
  });

  it("returns null on malformed, schema-invalid, and budget-denied responses (proposal-only semantics)", async () => {
    const malformed = new ScriptedModelProvider({ id: "m", respond: { text: "no json here {" } });
    const schemaInvalid = new ScriptedModelProvider({ id: "s", respond: jsonOutcome({ files: "many" }) });
    for (const provider of [malformed, schemaInvalid]) {
      const agent = new ModelPatchAgent({ runtime: new ModelRuntime().register(provider) });
      expect(await agent.proposePatch(ctx())).toBeNull();
    }
    const deniedGate = { admit: () => false, settle: () => {} };
    const denied = new ModelPatchAgent({
      runtime: new ModelRuntime().register(new ScriptedModelProvider({ id: "d", respond: jsonOutcome(GOOD_PATCH) })),
      gate: deniedGate,
    });
    expect(await denied.proposePatch(ctx())).toBeNull();
  });

  it("carries attribution into durable model-call rows when a sink is wired", async () => {
    const finished: Array<Record<string, unknown>> = [];
    const provider = new ScriptedModelProvider({ id: "p", respond: jsonOutcome(GOOD_PATCH) });
    const agent = new ModelPatchAgent({
      runtime: new ModelRuntime().register(provider),
      attribution: { repairId: "rep_1", findingId: "find_1" },
      sink: {
        start: () => {},
        finish: (r) => finished.push({ role: r.role, requestClass: r.requestClass, attribution: r.attribution }),
      },
    });
    await agent.proposePatch(ctx());
    expect(finished[0]).toMatchObject({
      role: "repairer",
      requestClass: "repair-proposal",
      attribution: { repairId: "rep_1", findingId: "find_1" },
    });
  });
});
