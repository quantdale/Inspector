import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { LineChannel, type RpcInbound, type LineProtocolErrorKind } from "./jsonrpc.js";

// ---------------------------------------------------------------------------
// Fuzz suite for LineChannel framing. Seeded deterministic generators; every
// case is reproducible from SEED. Properties:
//   P1  random chunk splittings of valid streams deliver EVERY message in order;
//   P2  random garbage bytes never throw synchronously and only ever produce
//       typed errors; newline-terminated garbage leaves valid traffic intact;
//   P3  the overflow boundary is exact: a partial line triggers line-overflow
//       iff it exceeds maxLineBytes, and framing recovers at the next newline.
// ---------------------------------------------------------------------------

const SEED = 0x4b50524f;

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
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => items[Math.floor(next() * items.length)]!,
  };
}

interface Harness {
  channel: LineChannel;
  readable: PassThrough;
  received: Array<{ id: number | string; method?: string }>;
  errors: LineProtocolErrorKind[];
  parseErrorReplies: number;
}

function makeChannel(maxLineBytes?: number): Harness {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const h: Harness = {
    channel: null as unknown as LineChannel,
    readable,
    received: [],
    errors: [],
    parseErrorReplies: 0,
  };
  const channel = new LineChannel(readable, writable, { maxLineBytes });
  channel.onMessage((msg: RpcInbound) =>
    h.received.push({ id: (msg as { id?: number }).id ?? "", method: (msg as { method?: string }).method }),
  );
  channel.onError((err) => h.errors.push(err.kind));
  // Parse-error replies are written back onto the wire; count them.
  writable.on("data", (chunk: Buffer) => {
    if (chunk.toString("utf8").includes('"code":-32700')) h.parseErrorReplies += 1;
  });
  h.channel = channel;
  return h;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await sleep(2);
  }
}

/** Random valid JSON-RPC message stream. */
function genMessages(rng: Rng, maxCount: number): Array<{ jsonrpc: "2.0"; id: number; method: string }> {
  const n = 1 + rng.int(maxCount);
  return Array.from({ length: n }, (_, i) => ({
    jsonrpc: "2.0" as const,
    id: i,
    method: `m${rng.int(1000)}`,
  }));
}

/** Split a buffer into random-sized chunks (1..maxChunk bytes). */
function splitRandom(rng: Rng, buf: Buffer, maxChunk: number): Buffer[] {
  const chunks: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const size = Math.min(1 + rng.int(maxChunk), buf.length - i);
    chunks.push(buf.subarray(i, i + size));
    i += size;
  }
  return chunks;
}

describe("P1: random chunk splittings of valid message streams", () => {
  it("delivers every message in order across 80 generated streams", async () => {
    const rng = makeRng(SEED ^ 0xe1);
    for (let stream = 0; stream < 80; stream++) {
      const messages = genMessages(rng, 24);
      const payload = Buffer.from(
        messages.map((m) => JSON.stringify(m) + "\n").join(""),
        "utf8",
      );
      const chunks = splitRandom(rng, payload, 1 + rng.int(16));
      const h = makeChannel();
      for (const c of chunks) h.readable.write(c);
      h.readable.end();

      const expected = messages.map((m) => ({ id: m.id, method: m.method }));
      await until(() => h.received.length === expected.length);
      expect(h.received).toEqual(expected); // order preserved, none lost
      expect(h.errors).toEqual([]);
    }
  });

  it("byte-splits inside multi-byte UTF-8 characters still reassemble", async () => {
    const rng = makeRng(SEED ^ 0xe2);
    const exotic = ["café", "日本語", "🚀💥", "ünïcödé", "Ωμέγα"];
    for (let i = 0; i < 60; i++) {
      const method = rng.pick(exotic) + rng.int(100);
      const msg = { jsonrpc: "2.0" as const, id: i, method };
      const bytes = Buffer.from(JSON.stringify(msg) + "\n", "utf8");
      const cut = 1 + rng.int(bytes.length - 1); // arbitrary BYTE offset
      const h = makeChannel();
      h.readable.write(bytes.subarray(0, cut));
      h.readable.write(bytes.subarray(cut));
      h.readable.end();
      await until(() => h.received.length === 1 || h.errors.length > 0);
      expect(h.errors).toEqual([]);
      expect(h.received[0]).toEqual({ id: i, method });
    }
  });
});

describe("P2: random garbage resistance", () => {
  it("newline-terminated garbage between lines never loses valid traffic", async () => {
    const rng = makeRng(SEED ^ 0xe3);
    const garbageAlphabet = "{}[]()<>!@#$%^&*abcXYZ123 \t\"'\\/:;,.";
    for (let round = 0; round < 60; round++) {
      const messages = genMessages(rng, 12);
      const parts: string[] = [];
      for (const m of messages) {
        if (rng.next() < 0.7) {
          const len = rng.int(40);
          let g = "";
          for (let j = 0; j < len; j++) g += garbageAlphabet[rng.int(garbageAlphabet.length)];
          parts.push(g + "\n"); // garbage confined to its own line
        }
        parts.push(JSON.stringify(m) + "\n");
      }
      const h = makeChannel();
      const payload = Buffer.from(parts.join(""), "utf8");
      for (const c of splitRandom(rng, payload, 1 + rng.int(20))) h.readable.write(c);
      h.readable.end();

      const expected = messages.map((m) => ({ id: m.id, method: m.method }));
      await until(() => h.received.length === expected.length);
      expect(h.received).toEqual(expected);
      // Only typed errors may have been emitted for the garbage lines.
      for (const kind of h.errors) {
        expect(["invalid-message", "line-overflow", "invalid-trailing", "write-failed"]).toContain(
          kind,
        );
      }
    }
  });

  it("raw binary garbage never throws and ends with the channel closed or typed errors", async () => {
    const rng = makeRng(SEED ^ 0xe4);
    for (let round = 0; round < 60; round++) {
      const h = makeChannel();
      const bursts = 1 + rng.int(8);
      let threw = false;
      try {
        for (let b = 0; b < bursts; b++) {
          const len = rng.int(512);
          const buf = Buffer.alloc(len);
          for (let j = 0; j < len; j++) buf[j] = rng.int(256); // full byte range
          h.readable.write(buf);
        }
        h.readable.end(Buffer.from('{"jsonrpc":"2.0","id":99,"method":"after"}\n'));
      } catch {
        threw = true;
      }
      expect(threw).toBe(false); // no synchronous throw out of write()
      await sleep(10);
      for (const kind of h.errors) {
        expect(["invalid-message", "line-overflow", "invalid-trailing", "write-failed"]).toContain(
          kind,
        );
      }
      expect(h.channel.isClosed).toBe(true); // end-of-stream always closes
    }
  });
});

describe("P3: overflow boundary property", () => {
  it("overflow fires exactly when a partial line exceeds maxLineBytes; framing recovers", async () => {
    const rng = makeRng(SEED ^ 0xe5);
    for (let trial = 0; trial < 60; trial++) {
      const cap = 8 + rng.int(64);
      // Line length sweeps the boundary: cap-1, cap, cap+1.
      const lineLen = cap - 1 + rng.int(3);
      const body = "x".repeat(lineLen);
      const valid = { jsonrpc: "2.0" as const, id: trial, method: "probe" };

      const h = makeChannel(cap);
      h.readable.write(Buffer.from(body)); // partial: no newline yet
      await sleep(5);

      const overflowExpected = lineLen > cap;
      const sawOverflow = h.errors.includes("line-overflow");
      expect(sawOverflow).toBe(overflowExpected);

      // Complete the line, then send a valid message: framing must recover.
      h.readable.write(Buffer.from("\n" + JSON.stringify(valid) + "\n"));
      h.readable.end();
      await until(() => h.received.length >= 1 || h.parseErrorReplies > 0);

      // In both cases the follow-up message is the ONLY delivery: an
      // overflowing line is discarded wholesale; a non-overflowing 'xxx…'
      // line is answered with a parse error instead of reaching the handler.
      expect(h.received).toEqual([{ id: trial, method: "probe" }]);
      expect(h.parseErrorReplies > 0).toBe(!overflowExpected);
      await until(() => h.channel.isClosed); // end-of-stream always closes
      expect(h.channel.isClosed).toBe(true);
    }
  });

  it("a blank line of exactly maxLineBytes is skipped without overflow; cap+1 overflows", async () => {
    const cap = 48;
    // Exactly-cap whitespace: buffer.length === cap is NOT > cap, so no
    // overflow; the line trims to empty and is skipped.
    const h = makeChannel(cap);
    h.readable.write(" ".repeat(cap) + "\n");
    h.readable.write('{"jsonrpc":"2.0","id":7,"method":"ok"}\n');
    h.readable.end();
    await until(() => h.received.length === 1);
    expect(h.received[0]).toEqual({ id: 7, method: "ok" });
    expect(h.errors).toEqual([]);

    // One byte past the cap with no newline yet: overflow must fire.
    const h2 = makeChannel(cap);
    h2.readable.write(" ".repeat(cap + 1));
    await until(() => h2.errors.length === 1);
    expect(h2.errors[0]).toBe("line-overflow");
  });
});
