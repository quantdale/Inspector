import { describe, expect, it } from "vitest";
import { rankSourceFiles } from "./source-intel.js";

function fileMap(files: Record<string, string>) {
  return {
    files: Object.keys(files),
    readFile: async (p: string) => files[p] ?? null,
  };
}

describe("M13 F9: deterministic source intelligence", () => {
  it("ranks error-token and selector matches above untouched files with reasons", async () => {
    const ranking = await rankSourceFiles(
      {
        ...fileMap({
          "src/app.ts": "export function boot() { submitTodo() }",
          "src/todo-form.ts": "function submitTodo() { throw new TypeError('cannot read property id of undefined') }",
          "src/unrelated.ts": "const color = 'blue';",
        }),
        errorText: "TypeError: cannot read property 'id' of undefined in submitTodo",
        selectors: ["#todo-input"],
      },
    );
    expect(ranking[0]!.path).toBe("src/todo-form.ts");
    expect(ranking[0]!.reasons.some((r) => r.startsWith("error-token:"))).toBe(true);
    const untouched = ranking.find((r) => r.path === "src/unrelated.ts")!;
    expect(untouched.score).toBe(0);
    expect(untouched.reasons).toEqual([]);
  });

  it("honors preferred, evidence-referenced, changed, and prior-attempt signals", async () => {
    const ranking = await rankSourceFiles(
      {
        ...fileMap({
          "a/preferred.ts": "x",
          "b/referenced.ts": "y",
          "c/changed.ts": "z",
          "d/prior.ts": "w",
          "e/plain.ts": "v",
        }),
        preferredPaths: ["a/preferred.ts"],
        referencedPaths: ["b/referenced.ts"],
        changedPaths: ["c/changed.ts"],
        previousAttemptPaths: ["d/prior.ts"],
      },
    );
    const byPath = new Map(ranking.map((r) => [r.path, r]));
    expect(byPath.get("e/plain.ts")!.score).toBe(0);
    expect(byPath.get("a/preferred.ts")!.reasons).toContain("operator-preferred");
    expect(byPath.get("b/referenced.ts")!.reasons).toContain("evidence-referenced");
    expect(byPath.get("c/changed.ts")!.reasons).toContain("changed-vs-known-base");
    expect(byPath.get("d/prior.ts")!.reasons).toContain("prior-attempt-touched");
    // Preferred ranks first deterministically.
    expect(ranking[0]!.path).toBe("a/preferred.ts");
  });

  it("finds nearby test candidates for implementation files", async () => {
    const ranking = await rankSourceFiles(
      {
        ...fileMap({
          "src/cart.ts": "checkout logic throws CheckoutError",
          "src/cart.test.ts": "cart tests",
          "src/other.ts": "nothing",
          "docs/readme.md": "documentation only",
        }),
        errorText: "CheckoutError",
      },
    );
    const cart = ranking.find((r) => r.path === "src/cart.ts")!;
    expect(cart.nearbyTests).toContain("src/cart.test.ts");
    // A same-directory implementation also sees the directory's tests...
    const other = ranking.find((r) => r.path === "src/other.ts")!;
    expect(other.nearbyTests).toContain("src/cart.test.ts");
    // ...but a file with no shared directory or stem gets none.
    const docs = ranking.find((r) => r.path === "docs/readme.md");
    if (docs) expect(docs.nearbyTests).toEqual([]);
  });

  it("is deterministic for identical inputs", async () => {
    const input = {
      ...fileMap({ "m/a.ts": "alpha", "n/b.ts": "beta alpha", "o/c.test.ts": "tests" }),
      errorText: "alpha",
    };
    const first = await rankSourceFiles(input);
    const second = await rankSourceFiles(input);
    expect(first.map((r) => [r.path, r.score, r.reasons])).toEqual(
      second.map((r) => [r.path, r.score, r.reasons]),
    );
  });
});
