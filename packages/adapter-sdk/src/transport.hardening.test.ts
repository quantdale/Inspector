import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { AdapterClient } from "./client.js";
import { AdapterServer, type AdapterHandler } from "./server.js";
import type { CapabilityDoc, Observation, ActionOutcome } from "@inspector/protocol";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Frame {
  id?: unknown;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
  params?: unknown;
}

/** Minimal schema-valid action used for act-param validation checks. */
const validAction = {
  id: "act_1",
  runId: "run_1",
  environmentId: "env_1",
  kind: "click",
  risk: "interact",
  deadlineMs: 1000,
  idempotency: "safe-retry",
} as const;

const validCapabilityDoc = (): CapabilityDoc => ({
  protocolVersion: "0.1",
  adapter: "adapter-fake",
  capabilities: { observe: ["uiTree"], act: ["click"], lifecycle: ["reset"] },
});

function stubHandler(): AdapterHandler {
  return {
    initialize: () => validCapabilityDoc(),
    observe: () =>
      ({
        id: "obs_1",
        runId: "run_1",
        environmentId: "env_1",
        sequence: 0,
        source: "test",
        capturedAt: new Date().toISOString(),
        summary: {},
      }) as Observation,
    act: () =>
      ({
        actionId: "act_1",
        runId: "run_1",
        environmentId: "env_1",
        status: "success",
        observedAt: new Date().toISOString(),
      }) as ActionOutcome,
    lifecycle: () => ({ ok: true }),
    health: () => ({ ok: true, uptimeMs: 1, now: new Date().toISOString() }),
    cancel: () => undefined,
  };
}

/** Split a stream into newline-delimited parsed frames. */
function collectFrames(stream: PassThrough, sink: Frame[]): void {
  let rest = "";
  stream.on("data", (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    let nl: number;
    while ((nl = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      if (line.trim()) sink.push(JSON.parse(line) as Frame);
    }
  });
}

async function waitForFrame(
  frames: Frame[],
  pred: (f: Frame) => boolean,
  ms = 2000,
): Promise<Frame> {
  const start = Date.now();
  let idx = 0;
  while (Date.now() - start < ms) {
    while (idx < frames.length) {
      const f = frames[idx++]!;
      if (pred(f)) return f;
    }
    await sleep(5);
  }
  throw new Error("no matching frame arrived in time");
}

// ---------------------------------------------------------------------------
// Server-side harness: we write raw lines to the server, collect its frames.
// ---------------------------------------------------------------------------

function makeServerHarness(handler: AdapterHandler = stubHandler()) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const frames: Frame[] = [];
  collectFrames(fromServer, frames);
  const server = new AdapterServer(toServer, fromServer, handler);
  const send = (line: string) => toServer.write(line + "\n");
  return { server, send, frames, handler };
}

// ---------------------------------------------------------------------------
// Client-side harness over in-memory streams.
// ---------------------------------------------------------------------------

function makeClientHarness() {
  const toClient = new PassThrough(); // adapter -> client
  const fromClient = new PassThrough(); // client -> adapter
  const frames: Frame[] = [];
  collectFrames(fromClient, frames);
  const client = AdapterClient.overStreams(toClient, fromClient);
  const respond = (frame: unknown) => toClient.write(JSON.stringify(frame) + "\n");
  return { client, frames, respond, toClient };
}

/** Echo adapter subprocess: replies {reqId, echo} for every request line. */
const ECHO_ADAPTER = [
  'let b="";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data",c=>{b+=c;let i;',
  'while((i=b.indexOf("\\n"))>=0){const l=b.slice(0,i);b=b.slice(i+1);',
  "if(!l.trim())continue;",
  "try{const m=JSON.parse(l);",
  'if(m&&m.id!=null){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{reqId:m.id,echo:m.method}})+"\\n")}}catch{}}});',
].join("");

// The STUBBORN adapter traps SIGTERM/SIGINT (effective on POSIX; Windows
// terminates regardless), exercising the SIGKILL escalation path.

describe("server: malformed inbound traffic (defect 1)", () => {
  it("ignores primitive/array garbage without crashing and keeps serving", async () => {
    const h = makeServerHarness();
    h.send("5");
    h.send("[1,2]");
    h.send('"just a string"');
    h.send("null");
    h.send('{"jsonrpc":"2.0","id":1,"method":"health"}');
    const resp = await waitForFrame(h.frames, (f) => f.id === 1);
    expect(resp.result).toMatchObject({ ok: true });
    // Exactly one response: nothing was sent for the garbage lines.
    expect(h.frames).toHaveLength(1);
    h.server.close();
  });

  it("replies -32600 to an object carrying an id but no usable method", async () => {
    const h = makeServerHarness();
    h.send('{"jsonrpc":"2.0","id":7}');
    const resp = await waitForFrame(h.frames, (f) => f.id === 7);
    expect(resp.error?.code).toBe(-32600);
    h.server.close();
  });
});

describe("server: JSON-RPC error codes (defect 6)", () => {
  it("returns -32601 for an unknown method", async () => {
    const h = makeServerHarness();
    h.send('{"jsonrpc":"2.0","id":1,"method":"teleport"}');
    const resp = await waitForFrame(h.frames, (f) => f.id === 1);
    expect(resp.error?.code).toBe(-32601);
    expect(resp.error?.message).toContain("teleport");
    h.server.close();
  });
});

describe("server: boundary param validation (defect 8)", () => {
  it("replies -32602 when act params violate the action schema", async () => {
    const h = makeServerHarness();
    const spy = vi.spyOn(h.handler, "act");
    h.send(
      '{"jsonrpc":"2.0","id":1,"method":"act","params":{"action":{"id":"act_1","kind":"click"}}}',
    );
    const resp = await waitForFrame(h.frames, (f) => f.id === 1);
    expect(resp.error?.code).toBe(-32602);
    expect(spy).not.toHaveBeenCalled();
    h.server.close();
  });

  it("replies -32602 when observe params are malformed", async () => {
    const h = makeServerHarness();
    h.send('{"jsonrpc":"2.0","id":1,"method":"observe","params":{"observe":"uiTree"}}');
    const resp = await waitForFrame(h.frames, (f) => f.id === 1);
    expect(resp.error?.code).toBe(-32602);
    h.server.close();
  });

  it("passes schema-valid act/observe params through to the handler", async () => {
    const h = makeServerHarness();
    h.send(
      `{"jsonrpc":"2.0","id":1,"method":"act","params":{"action":${JSON.stringify(validAction)}}}`,
    );
    const actResp = await waitForFrame(h.frames, (f) => f.id === 1);
    expect(actResp.result).toMatchObject({ status: "success" });
    h.send('{"jsonrpc":"2.0","id":2,"method":"observe","params":{"observe":["uiTree"]}}');
    const obsResp = await waitForFrame(h.frames, (f) => f.id === 2);
    expect(obsResp.result).toMatchObject({ id: "obs_1" });
    h.server.close();
  });
});

describe("client: initialize result validation (defect 8)", () => {
  /** Fire an initialize request and answer it with a canned result. */
  function initializeWith(result: unknown): Promise<unknown> {
    const h = makeClientHarness();
    const p = h.client.request("initialize", {});
    void (async () => {
      await sleep(20); // let the request frame land
      h.respond({ jsonrpc: "2.0", id: 1, result });
    })();
    return p;
  }

  it("accepts a schema-valid capability document", async () => {
    const caps = (await initializeWith(validCapabilityDoc())) as CapabilityDoc;
    expect(caps.adapter).toBe("adapter-fake");
  }, 8000);

  it("rejects a capability document missing required capabilities", async () => {
    await expect(
      initializeWith({ protocolVersion: "0.1", adapter: "adapter-fake" }),
    ).rejects.toThrow(/capabilit/i);
  }, 8000);

  it("rejects a capability document with a mismatched protocol version", async () => {
    const doc = { ...validCapabilityDoc(), protocolVersion: "9.9" };
    await expect(initializeWith(doc)).rejects.toThrow(/protocol version/i);
  }, 8000);
});

describe("client: spawn failures (defect 2)", () => {
  it("rejects spawn with a typed error on ENOENT instead of crashing the host", async () => {
    await expect(
      AdapterClient.spawn({ command: "inspector-definitely-missing-cmd-xyz" }),
    ).rejects.toMatchObject({ reason: "spawn-failed" });
  }, 10000);

  it("fails requests after a failed spawn instead of hanging", async () => {
    let client: AdapterClient | null = null;
    try {
      client = await AdapterClient.spawn({ command: "inspector-definitely-missing-cmd-xyz" });
    } catch {
      // Expected: spawn itself rejects.
    }
    if (client) {
      await expect(client.request("health", {}, 500)).rejects.toThrow(/spawn-failed|adapter-crash/);
      await client.close();
    }
  }, 10000);
});

describe("client: early child exit classification (defect 3)", () => {
  it("reports adapter-crash (not deadline-exceeded) when the child exits during settle", async () => {
    let client: AdapterClient | null = null;
    try {
      client = await AdapterClient.spawn({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      });
    } catch (err) {
      // Path A: the child died inside the settle window.
      expect((err as Error).message).toBe("adapter-crash");
    }
    if (client) {
      // Path B: it died just after settle; the global close watcher must
      // still classify the failure as adapter-crash, never deadline-exceeded.
      await expect(client.request("health", {}, 5000)).rejects.toMatchObject({
        message: "adapter-crash",
      });
      await client.close();
    }
  }, 10000);

  it("fails requests on a dead client immediately with adapter-crash", async () => {
    const h = makeClientHarness();
    // Simulate the adapter side dying: its outbound stream closes.
    h.toClient.end();
    const start = Date.now();
    await expect(h.client.request("health", {}, 30000)).rejects.toThrow(/adapter-crash/);
    expect(Date.now() - start).toBeLessThan(2000);
  }, 10000);
});

describe("client: request-after-close (defect 3)", () => {
  it("rejects immediately with a typed closed error instead of burning the deadline", async () => {
    const h = makeClientHarness();
    await h.client.close();
    const start = Date.now();
    await expect(h.client.request("health", {}, 30000)).rejects.toMatchObject({
      reason: "closed",
    });
    expect(Date.now() - start).toBeLessThan(2000);
  }, 8000);

  it("keeps notify after close a silent no-op", async () => {
    const h = makeClientHarness();
    await h.client.close();
    await expect(h.client.notify("ping", {})).resolves.toBeUndefined();
  });
});

describe("client: listener hygiene (defect 4)", () => {
  it("keeps proc close-listener count stable across 50 requests", async () => {
    const client = await AdapterClient.spawn({
      command: process.execPath,
      args: ["-e", ECHO_ADAPTER],
    });
    try {
      for (let i = 1; i <= 50; i++) {
        const res = (await client.request("health", { n: i }, 5000)) as { reqId: number };
        expect(res.reqId).toBe(i);
      }
      const proc = (client as unknown as { proc: ChildProcess | null }).proc;
      expect(proc).not.toBeNull();
      expect(proc!.listenerCount("close")).toBeLessThanOrEqual(2);
    } finally {
      await client.close();
    }
  }, 20000);

  it("maps concurrent request ids correctly through the echo adapter", async () => {
    const client = await AdapterClient.spawn({
      command: process.execPath,
      args: ["-e", ECHO_ADAPTER],
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          client.request<{ reqId: number }>("health", { n: i }, 5000),
        ),
      );
      results.forEach((r, i) => expect(r.reqId).toBe(i + 1));
    } finally {
      await client.close();
    }
  }, 15000);
});

describe("client: deadlines and cancellation (defect 9)", () => {
  it("enforces the deadline and silently drops the stale late response", async () => {
    const h = makeClientHarness();
    const p = h.client.request("health", {}, 120);
    // Late response arrives well after the deadline.
    setTimeout(() => h.respond({ jsonrpc: "2.0", id: 1, result: { ok: true } }), 400);
    await expect(p).rejects.toThrow(/deadline-exceeded/);
    // Client remains usable: a fresh request round-trips normally.
    const p2 = h.client.request("health", {}, 2000);
    h.respond({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    await expect(p2).resolves.toMatchObject({ ok: true });
  }, 8000);

  it("sends a cancel notification when an act request hits its deadline", async () => {
    const h = makeClientHarness();
    await expect(
      h.client.request("act", { action: { ...validAction, id: "act_deadline" } }, 100),
    ).rejects.toThrow(/deadline-exceeded/);
    const cancelFrame = h.frames.find((f) => f.method === "cancel");
    expect(cancelFrame).toBeDefined();
    expect((cancelFrame!.params as { actionId: string }).actionId).toBe("act_deadline");
    await h.client.close();
  }, 8000);

  it("does not send cancel for non-act deadline expiries", async () => {
    const h = makeClientHarness();
    await expect(h.client.request("health", {}, 100)).rejects.toThrow(/deadline-exceeded/);
    expect(h.frames.find((f) => f.method === "cancel")).toBeUndefined();
    await h.client.close();
  }, 8000);
});

describe("client: response correlation edge cases", () => {
  it("ignores a duplicate response for an already-settled id", async () => {
    const h = makeClientHarness();
    const p = h.client.request<string>("health", {}, 2000);
    await waitForFrame(h.frames, (f) => f.method === "health");
    h.respond({ jsonrpc: "2.0", id: 1, result: "first" });
    h.respond({ jsonrpc: "2.0", id: 1, result: "second" });
    await expect(p).resolves.toBe("first");
    // The client stays fully functional afterwards.
    const p2 = h.client.request<string>("health", {}, 2000);
    h.respond({ jsonrpc: "2.0", id: 2, result: "ok" });
    await expect(p2).resolves.toBe("ok");
  }, 8000);

  it("ignores a response for an unknown id without corrupting state", async () => {
    const h = makeClientHarness();
    h.respond({ jsonrpc: "2.0", id: "zzz-unknown", result: 42 });
    const p = h.client.request<string>("health", {}, 2000);
    h.respond({ jsonrpc: "2.0", id: 1, result: "fine" });
    await expect(p).resolves.toBe("fine");
  }, 8000);

  it("delivers adapter notifications to the event handler", async () => {
    const h = makeClientHarness();
    const events: Array<{ method: string; params: unknown }> = [];
    h.client.onEvent((method, params) => events.push({ method, params }));
    h.respond({ jsonrpc: "2.0", method: "observation", params: { sequence: 1 } });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ method: "observation", params: { sequence: 1 } });
  }, 8000);
});

describe("client: close semantics (defect 7)", () => {
  it("awaits child exit on close and stays idempotent", async () => {
    const client = await AdapterClient.spawn({
      command: process.execPath,
      args: ["-e", ECHO_ADAPTER],
    });
    await client.request("health", {}, 5000);
    const start = Date.now();
    await client.close();
    expect(Date.now() - start).toBeLessThan(8000);
    const proc = (client as unknown as { proc: ChildProcess | null }).proc;
    expect(proc).toBeNull();
    await expect(client.close()).resolves.toBeUndefined();
  }, 15000);

  it("escalates to SIGKILL when the child ignores termination", async () => {
    const STUBBORN =
      "process.on('SIGTERM',function(){});process.on('SIGINT',function(){});setInterval(function(){},1000);";
    const client = await AdapterClient.spawn({
      command: process.execPath,
      args: ["-e", STUBBORN],
    });
    const start = Date.now();
    await client.close();
    // Bounded: grace window plus SIGKILL fallback, far below the old zombie risk.
    expect(Date.now() - start).toBeLessThan(10000);
    expect(client.isClosed).toBe(true);
  }, 20000);
});
