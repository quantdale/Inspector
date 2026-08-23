import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@inspector/protocol";
import { CliAdapterHandler } from "./cli-adapter.js";
import { MockPtyBackend } from "./mock-pty.js";
import type { PtyBackend, PtySession } from "./types.js";

const ART_BASE = join(tmpdir(), "inspector-cli-hardening");

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

/** PTY stub with scripted screen contents (stderr-only / ANSI / UTF-8 noise). */
function stubPty(lines: string[], alive = true): PtyBackend {
  const session: PtySession = { id: "pty-stub" };
  return {
    spawn: async () => session,
    write: async () => {},
    readScreen: async () => lines,
    isAlive: async () => alive,
    kill: async () => {},
  };
}

describe("cli hardening: crash freshness (D1)", () => {
  it("repeated identical automation miss keeps classifying ACTION_FAILED (never reads as success)", async () => {
    const handler = new CliAdapterHandler(new MockPtyBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    const r1 = await handler.act({
      action: act("m1", "fill", { value: "definitely-not-a-command" }),
    });
    expect(r1.status).toBe("target-failure");
    expect(r1.error?.code).toBe("ACTION_FAILED");
    const r2 = await handler.act({
      action: act("m2", "fill", { value: "definitely-not-a-command" }),
    });
    expect(r2.status).toBe("target-failure");
    expect(r2.error?.code).toBe("ACTION_FAILED");
    expect(r2.error?.message).toBe(r1.error?.message);
  });
});

describe("cli hardening: stable classification for dead sessions (D8)", () => {
  it("retrying after an app crash still reports the crash as TARGET_FAILURE", async () => {
    const handler = new CliAdapterHandler(new MockPtyBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await handler.act({ action: act("l", "fill", { value: "login admin admin" }) });
    const boom = await handler.act({ action: act("b1", "fill", { value: "boom" }) });
    expect(boom.status).toBe("target-failure");
    expect(boom.error?.code).toBe("TARGET_FAILURE");
    expect(boom.error?.message).toContain("IntentionalAppCrash");

    // Reproduction policy replays the path: the retry must not flip to a
    // generic ACTION_FAILED "session not alive".
    const retry = await handler.act({ action: act("b2", "fill", { value: "count" }) });
    expect(retry.status).toBe("target-failure");
    expect(retry.error?.code).toBe("TARGET_FAILURE");
    expect(retry.error?.message).toContain("IntentionalAppCrash");
  });

  it("a normally exited session (quit) is not misreported as a target defect", async () => {
    const handler = new CliAdapterHandler(new MockPtyBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await handler.act({ action: act("q1", "fill", { value: "quit" }) });
    const next = await handler.act({ action: act("q2", "fill", { value: "count" }) });
    expect(next.status).toBe("target-failure");
    expect(next.error?.code).toBe("ACTION_FAILED");
  });

  it("an externally killed session is an automation failure, not a defect", async () => {
    const backend = new MockPtyBackend();
    const handler = new CliAdapterHandler(backend, ART_BASE);
    await handler.lifecycle({ op: "create" });
    // Kill out-of-band, as a real PTY supervisor would.
    const spy = backend as unknown as { sessions?: Map<string, { alive: boolean; exitReason?: string }> };
    const s = spy.sessions?.values().next().value;
    if (s) {
      s.alive = false;
      s.exitReason = "killed";
    }
    const next = await handler.act({ action: act("k", "fill", { value: "count" }) });
    expect(next.error?.code).toBe("ACTION_FAILED");
  });
});

describe("cli hardening: screen redaction (D7)", () => {
  it("strips credentials from URLs on PTY screen lines before they persist", async () => {
    const handler = new CliAdapterHandler(
      stubPty(["guest>", "error calling https://user:pass@api.example.com/v1?token=abc"]),
    );
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({});
    const uiTree = (obs.summary as { uiTree: Array<{ text?: string }> }).uiTree;
    const joined = uiTree.map((e) => e.text ?? "").join("\n");
    // Freeform screen text redacts both URL credentials and secret query
    // values before it reaches durable observations.
    expect(joined).not.toContain("user:pass");
    expect(joined).not.toContain("token=abc");
    expect(joined).toContain("api.example.com");
  });
});

describe("cli hardening: attribution threading (D8)", () => {
  it("threads real run/environment ids from lifecycle options into observations", async () => {
    const handler = new CliAdapterHandler(new MockPtyBackend(), ART_BASE);
    await handler.lifecycle({ op: "create", options: { runId: "r42", environmentId: "e7" } });
    const obs = await handler.observe({});
    expect(obs.runId).toBe("r42");
    expect(obs.environmentId).toBe("e7");
  });
});

describe("cli torture (mock-driven)", () => {
  it("huge scrollback output is bounded to the visible screen window", async () => {
    const backend = new MockPtyBackend();
    const handler = new CliAdapterHandler(backend, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const spy = backend as unknown as { sessions?: Map<string, { lines: string[] }> };
    const s = spy.sessions?.values().next().value;
    for (let i = 0; i < 5000; i++) s?.lines.push(`noise line ${i}`);
    const obs = await handler.observe({});
    const uiTree = (obs.summary as { uiTree: unknown[] }).uiTree;
    expect(uiTree.length).toBeLessThanOrEqual(13);
  });

  it("ANSI escape sequences and invalid UTF-8 bytes do not crash observation", async () => {
    const handler = new CliAdapterHandler(
      stubPty(["guest>", "\x1b[31mERR\x1b[0m failed", "binary: \uFFFD\uFFFD data"]),
    );
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({});
    const texts = (obs.summary as { uiTree: Array<{ text?: string }> }).uiTree.map((e) => e.text ?? "");
    expect(texts.some((t) => t.includes("ERR"))).toBe(true);
    expect(texts.some((t) => t.includes("\uFFFD"))).toBe(true);
  });

  it("EOF mid-session (process exited) surfaces through the screen model without crashing", async () => {
    const handler = new CliAdapterHandler(stubPty(["[process exited]", "FATAL IncrementOverflowCrash"], false));
    await handler.lifecycle({ op: "create" });
    const outcome = await handler.act({ action: act("e", "fill", { value: "count" }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    expect(outcome.error?.message).toContain("IncrementOverflowCrash");
  });

  it("counter overflow aborts at the boundary and stays classified on replay", async () => {
    const handler = new CliAdapterHandler(new MockPtyBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await handler.act({ action: act("l", "fill", { value: "login admin admin" }) });
    let last;
    for (let i = 0; i < 9; i++) {
      last = await handler.act({ action: act(`inc${i}`, "fill", { value: "inc" }) });
      if (last.status === "target-failure") break;
    }
    expect(last?.status).toBe("target-failure");
    expect(last?.error?.code).toBe("TARGET_FAILURE");
    const replay = await handler.act({ action: act("again", "fill", { value: "inc" }) });
    expect(replay.error?.code).toBe("TARGET_FAILURE");
  });
});
