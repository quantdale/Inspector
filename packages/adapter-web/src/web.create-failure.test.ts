import { describe, it, expect, vi } from "vitest";

// Deterministic launch failure: chromium.launch always throws. This isolates
// the create() failure path (partial teardown) from real browser behavior.
vi.mock("playwright", () => ({
  chromium: {
    launch: async () => {
      throw new Error("boom-launch");
    },
  },
}));

import { WebAdapterHandler } from "./web-adapter.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ART_BASE = join(tmpdir(), "inspector-web-create-failure");

interface Internals {
  seed?: { url: string; close(): void };
  browser?: unknown;
  context?: unknown;
  page?: unknown;
}

describe("web hardening: create failure tears down partial state (D2)", () => {
  it("rejects and leaves no leaked seed server or browser handles", async () => {
    const handler = new WebAdapterHandler({}, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/boom-launch/);
    const s = handler as unknown as Internals;
    expect(s.seed).toBeUndefined();
    expect(s.browser).toBeUndefined();
    expect(s.context).toBeUndefined();
    expect(s.page).toBeUndefined();
    const health = await handler.health();
    expect(health.ok).toBe(false);
  });

  it("a failed create can be retried without double leaks", async () => {
    const handler = new WebAdapterHandler({}, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/boom-launch/);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/boom-launch/);
    const s = handler as unknown as Internals;
    expect(s.seed).toBeUndefined();
  });
});
