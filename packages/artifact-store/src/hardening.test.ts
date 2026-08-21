import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, parse } from "node:path";
import {
  ArtifactStore,
  ArtifactStoreError,
  CorruptionError,
  PathPolicyError,
} from "./index.js";

// Scratch dirs created by each test; removed after every test.
let scratch: string[] = [];
// Base dir of the most recent tmpStore(), for computing escape paths in tests.
let storeDir = "";
afterEach(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
  scratch = [];
  storeDir = "";
});

function tmpStore(maxBytes?: number): ArtifactStore {
  const dir = mkdtempSync(join(tmpdir(), "inspector-art-hard-"));
  scratch.push(dir);
  storeDir = dir;
  return new ArtifactStore(dir, maxBytes === undefined ? {} : { maxBytes });
}

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Capture an error instead of letting it escape; undefined when nothing thrown. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

function errName(fn: () => unknown): string {
  const err = capture(fn);
  return err instanceof Error ? err.name : `no-error(${String(err)})`;
}

/** Probe whether this environment may create file symlinks (Windows needs privileges). */
function probeSymlink(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "inspector-art-probe-"));
  try {
    symlinkSync("definitely-missing-target", join(probeDir, "probe-link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
const SYMLINKS_AVAILABLE = probeSymlink();

const shaOf = (content: Buffer | string): string =>
  createHash("sha256").update(content).digest("hex");

describe("path policy (D1)", () => {
  it("rejects traversal via artifact name and writes nothing outside baseDir", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-victim-");
    const target = join(victim, "escaped.txt");
    // Relative path from the run's artifacts dir to a file OUTSIDE the store.
    const evilName = relative(join(storeDir, "run", "artifacts"), target);

    const err = capture(() =>
      store.write({ runId: "run", content: Buffer.from("x"), mime: "text/plain", name: evilName }),
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("PathPolicyError");
    expect(existsSync(target)).toBe(false);
  });

  it("rejects traversal via runId", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-victim-");
    const evilRun = relative(storeDir, join(victim, "rundir"));

    const err = capture(() =>
      store.write({ runId: evilRun, content: Buffer.from("x"), mime: "text/plain" }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
    expect(existsSync(join(victim, "rundir"))).toBe(false);
  });

  it("read/meta/verify refuse sha256 that escapes baseDir", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-victim-");
    const secret = join(victim, "secret.txt");
    writeFileSync(secret, "SECRET");
    const esc = relative(join(storeDir, "run", "artifacts"), secret);

    expect(errName(() => store.meta("run", esc))).toBe("PathPolicyError");
    expect(errName(() => store.read("run", esc))).toBe("PathPolicyError");
    expect(errName(() => store.verify("run", esc))).toBe("PathPolicyError");
    expect(errName(() => store.verifyStrict("run", esc))).toBe("PathPolicyError");
    expect(readFileSync(secret, "utf8")).toBe("SECRET");
  });

  it.each([
    "../evil.png",
    "..\\evil.png",
    "sub/evil.png",
    "sub\\evil.png",
    "/absolute.png",
    "C:\\evil.png",
    "c:relative.png",
    "\\\\server\\share\\evil.png",
    "%2e%2e%2fevil.png",
    "..%2f..%2fevil.png",
    ".hidden",
    "..",
    ".",
    "",
  ])("write rejects unsafe name %j", (name) => {
    const store = tmpStore();
    const err = capture(() =>
      store.write({ runId: "run", content: Buffer.from("x"), mime: "text/plain", name }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
  });

  it.each([
    "",
    ".",
    "..",
    "../outside",
    "a/b",
    "a\\b",
    "/abs",
    "C:\\tmp",
    "%2e%2e",
    "run_".repeat(40), // > 128 chars
  ])("write rejects unsafe runId %j", (runId) => {
    const store = tmpStore();
    const err = capture(() =>
      store.write({ runId, content: Buffer.from("x"), mime: "text/plain" }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
  });

  it.each([
    "",
    ".",
    "..",
    "../../package.json",
    "ABCDEF0000000000000000000000000000000000000000000000000000000000", // uppercase
    "abcd", // too short
    `${"a".repeat(64)}x`, // too long
  ])("read/meta/verify reject unsafe sha256 %j", (sha) => {
    const store = tmpStore();
    expect(errName(() => store.meta("run", sha))).toBe("PathPolicyError");
    expect(errName(() => store.read("run", sha))).toBe("PathPolicyError");
    expect(errName(() => store.verify("run", sha))).toBe("PathPolicyError");
  });

  it("still accepts legitimate caller inputs", () => {
    const store = tmpStore();
    const runId = `run_${"ab12".repeat(8)}`; // run_<32 hex> like newId("run")
    for (const name of ["screenshot.png", "trace.zip", "stub-act_4f2a9c", "Screenshot.PNG"]) {
      const m = store.write({ runId, content: Buffer.from(`content-${name}`), mime: "image/png", name });
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(store.read(runId, m.sha256).toString()).toBe(`content-${name}`);
      expect(store.verify(runId, m.sha256)).toBe(true);
    }
    const unnamed = store.write({ runId: "run", content: Buffer.from("bare"), mime: "m" });
    expect(unnamed.path.endsWith(unnamed.sha256)).toBe(true);
  });
});

describe("integrity (D2)", () => {
  it("rewrites a truncated canonical file on identical rewrite instead of dedup-hitting", () => {
    const store = tmpStore();
    const content = Buffer.from("canonical-content-0123456789");
    const m1 = store.write({ runId: "run1", content, mime: "text/plain" });

    // Simulate a crash mid-write: canonical file holds only part of the bytes.
    writeFileSync(m1.path, content.subarray(0, 5));

    const m2 = store.write({ runId: "run1", content, mime: "text/plain" });
    expect(m2.path).toBe(m1.path);
    expect(store.read("run1", m1.sha256).equals(content)).toBe(true);
    expect(store.verify("run1", m1.sha256)).toBe(true);
    expect(statSync(m2.path).size).toBe(content.byteLength);
  });

  it("read() verifies the content hash by default and throws CorruptionError", () => {
    const store = tmpStore();
    const m = store.write({ runId: "run1", content: Buffer.from("important bytes"), mime: "m" });
    writeFileSync(m.path, Buffer.from("tampered bytes!!"));
    const err = capture(() => store.read("run1", m.sha256));
    expect((err as Error)?.name).toBe("CorruptionError");
  });

  it("read() can skip verification on hot paths when explicitly asked", () => {
    const store = tmpStore();
    const m = store.write({ runId: "run1", content: Buffer.from("good"), mime: "m" });
    writeFileSync(m.path, Buffer.from("bad!"));
    expect(store.read("run1", m.sha256, { verify: false }).toString()).toBe("bad!");
  });

  it("meta.size reports disk truth, not the requested byte length", () => {
    const store = tmpStore();
    const content = Buffer.from("0123456789");
    const m1 = store.write({ runId: "run1", content, mime: "text/plain" });
    writeFileSync(m1.path, content.subarray(0, 4)); // truncated on disk
    const m2 = store.write({ runId: "run1", content, mime: "text/plain" });
    expect(m2.size).toBe(content.byteLength);
    expect(statSync(m2.path).size).toBe(content.byteLength);
  });

  it("verifyStrict throws the typed corruption error", () => {
    const store = tmpStore();
    const m = store.write({ runId: "run1", content: Buffer.from("data"), mime: "m" });
    writeFileSync(m.path, Buffer.from("drat!!!"));
    const err = capture(() => store.verifyStrict("run1", m.sha256));
    expect((err as Error)?.name).toBe("CorruptionError");
    expect(String(capture(() => store.verifyStrict("run1", m.sha256)))).toMatch(/corruption/);
  });

  it("interleaved identical writes across instances converge to one valid artifact", () => {
    const shared = tmpDir("inspector-art-shared-");
    const s1 = new ArtifactStore(shared);
    const s2 = new ArtifactStore(shared);
    const content = Buffer.from("shared-content");

    const m1 = s1.write({ runId: "runX", content, mime: "text/plain" });
    const m2 = s2.write({ runId: "runX", content, mime: "text/plain" });
    expect(m2.path).toBe(m1.path);
    expect(s1.read("runX", m1.sha256).equals(content)).toBe(true);
    expect(s2.read("runX", m2.sha256).equals(content)).toBe(true);
    const artifactsDir = join(shared, "runX", "artifacts");
    expect(readdirSync(artifactsDir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("checks size limit before any filesystem side effect", () => {
    const store = tmpStore(4);
    const err = capture(() =>
      store.write({ runId: "run1", content: Buffer.alloc(8, 0), mime: "m" }),
    );
    expect(String(err)).toMatch(/exceeds limit/);
    expect(existsSync(join(storeDir, "run1"))).toBe(false);
  });

  it("treats a directory planted at the content-addressed path as absent metadata", () => {
    const store = tmpStore();
    const sha = shaOf("never-written");
    const planted = join(storeDir, "run", "artifacts", sha);
    mkdirSync(planted, { recursive: true });
    expect(store.meta("run", sha)).toBeUndefined();
  });
});

describe("symlink safety (D3)", () => {
  it.skipIf(!SYMLINKS_AVAILABLE)(
    "write refuses a pre-planted symlink at the artifact destination",
    () => {
      const store = tmpStore();
      const victim = tmpDir("inspector-art-canary-");
      const canary = join(victim, "canary.txt");
      writeFileSync(canary, "CANARY");

      const content = Buffer.from("payload");
      const destDir = join(storeDir, "run", "artifacts");
      mkdirSync(destDir, { recursive: true });
      symlinkSync(canary, join(destDir, shaOf(content)));

      const err = capture(() =>
        store.write({ runId: "run", content, mime: "application/octet-stream" }),
      );
      expect((err as Error)?.name).toBe("PathPolicyError");
      expect(readFileSync(canary, "utf8")).toBe("CANARY");
      expect(readdirSync(destDir).filter((f) => !f.includes(".tmp-"))).toEqual([shaOf(content)]);
    },
  );

  it.skipIf(!SYMLINKS_AVAILABLE)("write refuses a symlinked run directory", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-canary-");
    const runLink = join(storeDir, "run");
    symlinkSync(victim, runLink, "dir");

    const err = capture(() =>
      store.write({ runId: "run", content: Buffer.from("x"), mime: "text/plain" }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
    expect(existsSync(join(victim, "artifacts"))).toBe(false);
  });

  it.skipIf(!SYMLINKS_AVAILABLE)("meta/read refuse a symlinked artifact path pointing outside", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-canary-");
    const outside = join(victim, "outside.txt");
    writeFileSync(outside, "OUTSIDE");

    const sha = shaOf("planned-content");
    const artifactsDir = join(storeDir, "run", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    symlinkSync(outside, join(artifactsDir, sha));

    expect(errName(() => store.meta("run", sha))).toBe("PathPolicyError");
    expect(errName(() => store.read("run", sha))).toBe("PathPolicyError");
  });

  // Junctions need no privilege on Windows (and degrade to plain symlinks on
  // POSIX), so link-following refusal is exercised even unprivileged.
  it("write refuses a junction planted as the run directory", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-canary-");
    symlinkSync(victim, join(storeDir, "run"), "junction");

    const err = capture(() =>
      store.write({ runId: "run", content: Buffer.from("x"), mime: "text/plain" }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
    expect(existsSync(join(victim, "artifacts"))).toBe(false);
  });

  it("meta/read refuse an artifact path junction pointing outside", () => {
    const store = tmpStore();
    const victim = tmpDir("inspector-art-canary-");

    const sha = shaOf("planned-content");
    const artifactsDir = join(storeDir, "run", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    symlinkSync(victim, join(artifactsDir, sha), "junction");

    expect(errName(() => store.meta("run", sha))).toBe("PathPolicyError");
    expect(errName(() => store.read("run", sha))).toBe("PathPolicyError");
  });

  it("refuses a non-regular file at the destination even without symlinks", () => {
    const store = tmpStore();
    const content = Buffer.from("x");
    const plantedDir = join(storeDir, "run", "artifacts", shaOf(content));
    mkdirSync(plantedDir, { recursive: true });

    const err = capture(() =>
      store.write({ runId: "run", content, mime: "application/octet-stream" }),
    );
    expect((err as Error)?.name).toBe("PathPolicyError");
  });
});

describe("clear safety (D4)", () => {
  it("clear() removes a normal store and resets the in-memory index", () => {
    const store = tmpStore();
    const m = store.write({ runId: "run1", content: Buffer.from("bye"), mime: "m" });
    store.clear();
    expect(existsSync(m.path)).toBe(false);
    expect(store.meta("run1", m.sha256)).toBeUndefined();
  });

  it("refuses an empty baseDir at construction (it would resolve to cwd)", () => {
    const err = capture(() => new ArtifactStore(""));
    expect((err as Error)?.name).toBe("PathPolicyError");
  });

  it("refuses a filesystem-root baseDir at construction", () => {
    const root = parse(resolve(tmpdir())).root; // e.g. "C:\"
    const err = capture(() => new ArtifactStore(root));
    expect((err as Error)?.name).toBe("PathPolicyError");
  });
});

describe("typed errors", () => {
  it("exports PathPolicyError and CorruptionError as ArtifactStoreError subclasses", () => {
    expect(errName(() => { throw new ArtifactStoreError("base"); })).toBe("ArtifactStoreError");
    expect(new PathPolicyError("p").name).toBe("PathPolicyError");
    expect(new CorruptionError("c").name).toBe("CorruptionError");
    expect(new PathPolicyError("p")).toBeInstanceOf(ArtifactStoreError);
    expect(new CorruptionError("c")).toBeInstanceOf(ArtifactStoreError);
  });
});
