import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import {
  LineChannel,
  JSON_RPC_PARSE_ERROR,
  type RpcInbound,
} from "./jsonrpc.js";

interface ChannelHarness {
  channel: LineChannel;
  readable: PassThrough;
  writable: PassThrough;
  received: unknown[];
  written: string[];
  errors: Array<{ kind: string; message: string }>;
}

function makeChannel(opts?: { maxLineBytes?: number }): ChannelHarness {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const received: unknown[] = [];
  const written: string[] = [];
  const errors: Array<{ kind: string; message: string }> = [];
  const channel = new LineChannel(readable, writable, opts);
  channel.onMessage((msg: RpcInbound) => received.push(msg));
  channel.onError((err) => errors.push({ kind: err.kind, message: err.message }));
  writable.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  return { channel, readable, writable, received, written, errors };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred` holds for the harness, polling to let stream events land. */
async function until(
  pred: () => boolean,
  ms = 1000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await sleep(5);
  }
}

describe("LineChannel framing", () => {
  it("reassembles a message split across chunks", async () => {
    const h = makeChannel();
    h.readable.write('{"jsonrpc":"2.0","id":1,');
    h.readable.write('"method":"he');
    h.readable.write('alth"}');
    h.readable.write("\n");
    await until(() => h.received.length === 1);
    expect(h.received[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "health" });
  });

  it("delivers multiple complete lines carried in one chunk", async () => {
    const h = makeChannel();
    h.readable.write(
      '{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,"method":"b"}\n',
    );
    await until(() => h.received.length === 2);
    expect(h.received.map((m) => (m as { id: number }).id)).toEqual([1, 2]);
  });

  it("skips blank lines", async () => {
    const h = makeChannel();
    h.readable.write('\n\n{"jsonrpc":"2.0","id":1,"method":"a"}\n\n');
    await until(() => h.received.length === 1);
  });

  it("replies with a parse error for malformed JSON and keeps framing", async () => {
    const h = makeChannel();
    h.readable.write('{"broken\n');
    h.readable.write('{"jsonrpc":"2.0","id":1,"method":"a"}\n');
    await until(() => h.written.length > 0 && h.received.length === 1);
    const parseErrorResponse = JSON.parse(h.written[0]!) as {
      error?: { code?: number };
    };
    expect(parseErrorResponse.error?.code).toBe(JSON_RPC_PARSE_ERROR);
    expect(h.received[0]).toMatchObject({ id: 1, method: "a" });
  });
});

describe("LineChannel garbage resistance", () => {
  it.each([["5"], ['"str"'], ["true"], ["null"], ["[1,2]"], ['[{"jsonrpc":"2.0","id":1,"method":"a"}]']])(
    "drops non-object payload %s via onError without invoking the handler",
    async (line) => {
      const h = makeChannel();
      h.readable.write(`${line}\n`);
      await until(() => h.errors.length === 1);
      expect(h.errors[0]!.kind).toBe("invalid-message");
      expect(h.received).toHaveLength(0);
    },
  );

  it("survives a bounded garbage flood and still delivers valid traffic", async () => {
    const h = makeChannel();
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(i % 10 === 0 ? '{"jsonrpc":"2.0","id":1,"method":"a"}' : "{{{not-json");
    }
    h.readable.write(lines.join("\n") + "\n");
    await until(() => h.received.length === 500);
    // Buffer fully drained after processing.
    expect((h.channel as unknown as { buffer: string }).buffer).toBe("");
  });

  it("reports a typed overflow error for oversized lines and recovers framing", async () => {
    const h = makeChannel({ maxLineBytes: 1024 });
    // The oversized line is still partial when it crosses the cap.
    h.readable.write("x".repeat(4096));
    await until(() => h.errors.length >= 1);
    expect(h.errors[0]!.kind).toBe("line-overflow");
    // Framing recovers at the next newline: the tail of the discarded line
    // plus a valid message are processed normally.
    h.readable.write("\n");
    h.readable.write('{"jsonrpc":"2.0","id":1,"method":"a"}\n');
    await until(() => h.received.length === 1);
    expect(h.received[0]).toMatchObject({ id: 1 });
    expect((h.channel as unknown as { buffer: string }).buffer).toBe("");
  });
});

describe("LineChannel end-of-stream handling", () => {
  it("flushes a trailing unterminated valid message at EOF", async () => {
    const h = makeChannel();
    h.readable.end('{"jsonrpc":"2.0","id":9,"method":"last"}');
    await until(() => h.received.length === 1);
    expect(h.received[0]).toMatchObject({ id: 9, method: "last" });
  });

  it("surfaces an unparsable trailing fragment instead of dropping it silently", async () => {
    const h = makeChannel();
    h.readable.end('{"broken": ');
    await until(() => h.errors.length === 1);
    expect(h.errors[0]!.kind).toBe("invalid-trailing");
    expect(h.received).toHaveLength(0);
  });

  it("reassembles a multi-byte UTF-8 character split across chunks", async () => {
    const h = makeChannel();
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "café" });
    const bytes = Buffer.from(msg + "\n", "utf8");
    const splitAt = msg.length - 1; // split inside the multi-byte sequence
    h.readable.write(bytes.subarray(0, splitAt));
    h.readable.write(bytes.subarray(splitAt));
    await until(() => h.received.length === 1);
    expect((h.received[0] as { method: string }).method).toBe("café");
  });

  it("replaces invalid UTF-8 bytes without throwing and keeps framing", async () => {
    const h = makeChannel();
    h.readable.write(Buffer.from([0xff, 0xfe]));
    h.readable.write("\n");
    h.readable.write('{"jsonrpc":"2.0","id":1,"method":"a"}\n');
    await until(() => h.received.length === 1);
    expect(h.received[0]).toMatchObject({ id: 1 });
  });

  it("handles a multi-byte character truncated at EOF via decoder flush", async () => {
    const h = makeChannel();
    const bytes = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"café"}\n', "utf8");
    // Cut the final two bytes: the second byte of 'é' plus the newline. The
    // decoder must flush the pending partial character at EOF and the
    // unterminated (now complete) message must be delivered.
    h.readable.write(bytes.subarray(0, bytes.length - 2));
    h.readable.end(bytes.subarray(bytes.length - 2));
    await until(() => h.received.length === 1);
    expect((h.received[0] as { method: string }).method).toBe("café");
    expect((h.channel as unknown as { buffer: string }).buffer).toBe("");
  });
});

describe("LineChannel send semantics", () => {
  it("returns false and writes nothing once closed", () => {
    const h = makeChannel();
    h.channel.close();
    const ok = h.channel.send({ jsonrpc: "2.0", method: "x" });
    expect(ok).toBe(false);
    expect(h.written).toHaveLength(0);
  });

  it("propagates write failures as false plus a typed error", () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    writable.write = () => {
      throw new Error("EPIPE");
    };
    const errors: Array<{ kind: string }> = [];
    const channel = new LineChannel(readable, writable);
    channel.onError((err) => errors.push({ kind: err.kind }));
    const ok = channel.send({ jsonrpc: "2.0", method: "x" });
    expect(ok).toBe(false);
    expect(errors.map((e) => e.kind)).toContain("write-failed");
    expect(channel.isClosed).toBe(true);
  });

  it("treats backpressure (write() === false) as accepted, not failed", () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    writable.write = () => false;
    const channel = new LineChannel(readable, writable);
    const ok = channel.send({ jsonrpc: "2.0", method: "x" });
    expect(ok).toBe(true);
    expect(channel.isClosed).toBe(false);
  });
});
