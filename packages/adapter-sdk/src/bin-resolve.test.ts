import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pickAdapterBinFile, resolveAdapterBin } from "./bin-resolve.js";

describe("pickAdapterBinFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "adapter-bin-resolve-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function touch(rel: string): string {
    const file = join(dir, rel);
    writeFileSync(file, "");
    return file;
  }

  it("prefers the bundled release sibling", () => {
    const bundled = touch("inspector-adapter-demo.js");
    const pick = pickAdapterBinFile(dir, "inspector-adapter-demo.js", "bin");
    expect(pick).toEqual({ kind: "bundled", binFile: bundled });
  });

  it("falls back to a compiled sibling .js in the dev segments", () => {
    mkdirSync(join(dir, "src"));
    const compiled = touch(join("src", "bin.js"));
    const pick = pickAdapterBinFile(join(dir, "src"), "inspector-adapter-demo.js", "bin");
    expect(pick).toEqual({ kind: "compiled", binFile: compiled });
  });

  it("falls back to TypeScript source last", () => {
    mkdirSync(join(dir, "nested"));
    const source = touch(join("nested", "bin.ts"));
    const pick = pickAdapterBinFile(dir, "inspector-adapter-demo.js", "nested", "bin");
    expect(pick).toEqual({ kind: "source", binFile: source });
  });

  it("throws naming every candidate when nothing exists", () => {
    expect(() =>
      pickAdapterBinFile(dir, "inspector-adapter-missing.js", "nope", "bin"),
    ).toThrowError(/inspector-adapter-missing\.js/);
  });
});

describe("resolveAdapterBin", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "adapter-bin-resolve-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a bundled artifact directly under node", () => {
    const bundled = join(dir, "inspector-adapter-demo.js");
    writeFileSync(bundled, "");
    const ref = resolveAdapterBin(
      pathToFileURL(join(dir, "inspector-cli.js")).href,
      "inspector-adapter-demo.js",
      "bin",
    );
    expect(ref.command).toBe(process.execPath);
    expect(ref.args).toEqual([bundled]);
  });
});
