import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "./index.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function tmpStore(maxBytes?: number): ArtifactStore {
  dir = mkdtempSync(join(tmpdir(), "inspector-art-"));
  return new ArtifactStore(dir, maxBytes === undefined ? {} : { maxBytes });
}

describe("artifact store", () => {
  it("hashes content deterministically", () => {
    const store = tmpStore();
    const content = Buffer.from("hello inspector");
    const a = store.write({ runId: "run1", content, mime: "text/plain" });
    const b = store.write({ runId: "run1", content, mime: "text/plain" });
    expect(a.sha256).toBe(b.sha256);
    expect(a.size).toBe(content.byteLength);
    expect(a.mime).toBe("text/plain");
  });

  it("deduplicates identical content (no second write)", () => {
    const store = tmpStore();
    const content = Buffer.from("duplicate-me");
    const first = store.write({ runId: "run1", content, mime: "text/plain" });
    const second = store.write({ runId: "run1", content, mime: "text/plain" });
    expect(second.path).toBe(first.path);
  });

  it("detects corruption on read", () => {
    const store = tmpStore();
    const content = Buffer.from("important bytes");
    const m = store.write({ runId: "run1", content, mime: "application/octet-stream" });
    expect(store.verify("run1", m.sha256)).toBe(true);
    // Tamper with the stored file.
    writeFileSync(m.path, Buffer.from("tampered bytes!!"));
    expect(store.verify("run1", m.sha256)).toBe(false);
    expect(() => store.verifyStrict("run1", m.sha256)).toThrow(/corruption/);
  });

  it("enforces size limits", () => {
    const store = tmpStore(4);
    expect(() => store.write({ runId: "run1", content: Buffer.from("too big"), mime: "x" })).toThrow(
      /exceeds limit/,
    );
  });

  it("scopes artifacts per run directory", () => {
    const store = tmpStore();
    const m = store.write({ runId: "runA", content: Buffer.from("x"), mime: "text/plain" });
    expect(m.path).toContain(join("runA", "artifacts"));
    expect(store.meta("runB", m.sha256)).toBeUndefined();
  });
});
