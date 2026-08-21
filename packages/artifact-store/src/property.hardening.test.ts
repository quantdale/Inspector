import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  ArtifactStore,
  CorruptionError,
  PathPolicyError,
} from "./index.js";

// ---------------------------------------------------------------------------
// Seeded deterministic generator (mulberry32). No fast-check dependency:
// every case is reproducible from SEED and the whole corpus is bounded.
// ---------------------------------------------------------------------------

const SEED = 0x4b50524f; // "KPRO"
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    bool: (p = 0.5) => next() < p,
  };
}

// Scratch dirs removed after every test.
let scratch: string[] = [];
afterEach(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
  scratch = [];
});

function tmpStore(maxBytes?: number): { store: ArtifactStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "inspector-art-prop-"));
  scratch.push(dir);
  return {
    store: new ArtifactStore(dir, maxBytes === undefined ? {} : { maxBytes }),
    dir,
  };
}

const shaOf = (content: Buffer): string =>
  createHash("sha256").update(content).digest("hex");

/** Random content with mixed byte profiles (zeros, ascii, binary, high bytes). */
function randomContent(rng: Rng, size: number): Buffer {
  const buf = Buffer.alloc(size);
  const profile = rng.int(4);
  for (let i = 0; i < size; i++) {
    if (profile === 0) buf[i] = 0;
    else if (profile === 1) buf[i] = 0x41 + (i % 26);
    else if (profile === 2) buf[i] = rng.int(256);
    else buf[i] = 128 + rng.int(128);
  }
  return buf;
}

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789._-";
/** Generate a name matching the legal pattern ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$. */
function legalName(rng: Rng): string {
  const len = 1 + rng.int(40);
  const head = rng.pick(["a", "Z", "9", "screenshot", "trace"]);
  let s = head;
  for (let i = 0; i < len; i++) s += NAME_ALPHABET[rng.int(NAME_ALPHABET.length)];
  return s.slice(0, 128);
}

function legalRunId(rng: Rng): string {
  const len = 1 + rng.int(60);
  let s = rng.pick(["run", "R", "a7", "run_"]);
  const rest = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  for (let i = 0; i < len; i++) s += rest[rng.int(rest.length)];
  return s.slice(0, 128);
}

// ---------------------------------------------------------------------------
// Round-trip / dedup / disk-truth property
// ---------------------------------------------------------------------------

describe("artifact-store round-trip property (seeded)", () => {
  it("write→read round-trips 250 random buffers; meta matches disk truth", () => {
    const rng = makeRng(SEED ^ 0xa1);
    const { store, dir } = tmpStore();
    for (let i = 0; i < 250; i++) {
      // Bias towards small payloads; a few larger ones exercise chunked writes.
      const size = rng.bool(0.85) ? rng.int(2048) : rng.int(64 * 1024);
      const content = randomContent(rng, size);
      const runId = legalRunId(rng);
      const name = rng.bool(0.5) ? legalName(rng) : undefined;

      const meta = store.write({ runId, content, mime: "application/octet-stream", name });

      expect(meta.sha256).toBe(shaOf(content));
      expect(meta.size).toBe(content.byteLength);
      expect(statSync(meta.path).size).toBe(content.byteLength); // disk truth
      expect(relative(dir, meta.path)).not.toMatch(/^\.\./); // inside the store
      expect(meta.runId).toBe(runId);

      expect(store.read(runId, meta.sha256).equals(content)).toBe(true);
      expect(store.verify(runId, meta.sha256)).toBe(true);
      expect(store.meta(runId, meta.sha256)?.size).toBe(content.byteLength);
    }
  });

  it("dedup identity: same content+runId+name maps to one file, never a second copy", () => {
    const rng = makeRng(SEED ^ 0xa2);
    const { store, dir } = tmpStore();
    for (let i = 0; i < 120; i++) {
      const content = randomContent(rng, rng.int(1024));
      const runId = legalRunId(rng);
      const name = rng.bool(0.5) ? legalName(rng) : undefined;

      const m1 = store.write({ runId, content, mime: "m", name });
      const m2 = store.write({ runId, content, mime: "m", name });

      expect(m2.path).toBe(m1.path);
      expect(m2.sha256).toBe(m1.sha256);

      const artifactsDir = join(dir, runId, "artifacts");
      const files = readdirSync(artifactsDir).filter((f) => !f.includes(".tmp-"));
      expect(files).toEqual([`${m1.sha256}${name ? `-${name}` : ""}`]);
      expect(store.read(runId, m1.sha256).equals(content)).toBe(true);
    }
  });

  it("distinct content never collides onto the same sha or path", () => {
    const rng = makeRng(SEED ^ 0xa3);
    const { store } = tmpStore();
    const shas = new Set<string>();
    const paths = new Set<string>();
    for (let i = 0; i < 150; i++) {
      // Length prefix guarantees contents are distinct across cases.
      const content = Buffer.concat([
        Buffer.from([i % 256, (i >> 8) % 256]),
        randomContent(rng, rng.int(512)),
      ]);
      const meta = store.write({ runId: "run", content, mime: "m" });
      shas.add(meta.sha256);
      paths.add(meta.path);
    }
    expect(shas.size).toBe(150);
    expect(paths.size).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Single-byte flip detection property
// ---------------------------------------------------------------------------

describe("artifact-store corruption detection property", () => {
  it("verify/read detect ANY single-byte flip in stored content", () => {
    const rng = makeRng(SEED ^ 0xa4);
    for (let i = 0; i < 60; i++) {
      const { store } = tmpStore();
      const size = 1 + rng.int(4096);
      const content = randomContent(rng, size);
      const m = store.write({ runId: "run", content, mime: "m" });
      expect(store.verify("run", m.sha256)).toBe(true);

      // Flip exactly one byte to a DIFFERENT value at a random position.
      const pos = rng.int(size);
      const tampered = Buffer.from(content);
      let replacement = rng.int(256);
      if (replacement === tampered[pos]) replacement = (replacement + 1) % 256;
      tampered[pos] = replacement;
      writeFileSync(m.path, tampered);

      expect(store.verify("run", m.sha256)).toBe(false);

      let readErr: unknown;
      try {
        store.read("run", m.sha256);
      } catch (e) {
        readErr = e;
      }
      expect(readErr).toBeInstanceOf(CorruptionError);

      expect(() => store.verifyStrict("run", m.sha256)).toThrow(CorruptionError);
    }
  });
});

// ---------------------------------------------------------------------------
// Traversal-rejection property over generated hostile strings
// ---------------------------------------------------------------------------

/** Mutate a legal seed string into hostile variants aimed at escaping the store. */
function hostileNames(rng: Rng): string[] {
  const seeds = ["evil.png", "a", "x9.zip", "shot-001.bin", "log.txt", "A7", "dump.json", "z"];
  const out: string[] = [];
  for (const seed of seeds) {
    out.push(
      `../${seed}`,
      `..\\${seed}`,
      `sub/../${seed}`,
      `sub\\..\\${seed}`,
      `..%2f${seed}`,
      `%2e%2e%2f${seed}`,
      `..%5c${seed}`,
      `/abs/${seed}`,
      `C:\\win\\${seed}`,
      `\\\\srv\\share\\${seed}`,
      `${seed}\\..\\..\\${seed}`,
      `.`,
      "..",
      "...",
      "",
      " ",
      ".hidden",
      `-leading-dash-${rng.int(99)}`,
      `${seed}\0`,
      `${seed}\n`,
      `${seed}%00`,
      `${"9".repeat(129)}`, // overlong
      `${rng.next().toString(36)}:${rng.next().toString(36)}`, // drive-letter-ish
    );
  }
  // A few fully random hostile strings from a binary-ish alphabet.
  const hostileAlphabet = "./\\:%*?\0<>| \t\"'`$;&#";
  for (let i = 0; i < 60; i++) {
    const len = 1 + rng.int(24);
    let s = "";
    for (let j = 0; j < len; j++) s += hostileAlphabet[rng.int(hostileAlphabet.length)];
    out.push(s);
  }
  return out;
}

describe("artifact-store traversal-rejection property", () => {
  it("every generated hostile name is rejected with PathPolicyError and writes nothing", () => {
    const rng = makeRng(SEED ^ 0xa5);
    const { store, dir } = tmpStore();
    // One legitimate write so we can assert the base listing never grows.
    const anchor = store.write({ runId: "anchor", content: Buffer.from("a"), mime: "m" });

    let rejected = 0;
    for (const name of hostileNames(rng)) {
      let err: unknown;
      try {
        store.write({ runId: "run", content: Buffer.from("payload"), mime: "m", name });
      } catch (e) {
        err = e;
      }
      expect(err, `expected rejection for ${JSON.stringify(name)}`).toBeInstanceOf(PathPolicyError);
      rejected++;
    }
    expect(rejected).toBeGreaterThanOrEqual(200);

    // Nothing landed anywhere in the store except the anchor.
    expect(readdirSync(join(dir, "anchor", "artifacts"))).toEqual([anchor.sha256]);
    expect(existsSync(join(dir, "run"))).toBe(false);
  });

  it("every generated hostile runId is rejected with PathPolicyError", () => {
    const rng = makeRng(SEED ^ 0xa6);
    const { store, dir } = tmpStore();
    const hostiles = [
      "../outside", "a/b", "a\\b", ".", "..", "", " ", "/abs", "C:\\tmp",
      "%2e%2e", "run\0", "run\n", ".hidden", "-lead", "_lead",
      `r${"u".repeat(128)}n`, // > 128 chars
      "run id", "run:id", "run#id", "café",
    ];
    for (let i = 0; i < 40; i++) {
      const len = 1 + rng.int(20);
      const alphabet = "./\\:- \0\t%<>|";
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[rng.int(alphabet.length)];
      hostiles.push(s);
    }
    for (const runId of hostiles) {
      let err: unknown;
      try {
        store.write({ runId, content: Buffer.from("x"), mime: "m" });
      } catch (e) {
        err = e;
      }
      expect(err, `expected rejection for runId ${JSON.stringify(runId)}`).toBeInstanceOf(
        PathPolicyError,
      );
    }
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("legal generated names/runIds are NEVER rejected (no overblocking)", () => {
    const rng = makeRng(SEED ^ 0xa7);
    const { store } = tmpStore();
    for (let i = 0; i < 120; i++) {
      const runId = legalRunId(rng);
      const name = rng.bool(0.5) ? legalName(rng) : undefined;
      const content = randomContent(rng, rng.int(256));
      expect(() =>
        store.write({ runId, content, mime: "m", name }),
      ).not.toThrow();
    }
  });
});
