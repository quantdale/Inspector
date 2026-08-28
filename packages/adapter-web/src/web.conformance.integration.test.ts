import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";

const here = dirname(fileURLToPath(import.meta.url));
const webBin = join(here, "bin.ts");

let client: AdapterClient | null = null;
afterEach(async () => {
  if (client) {
    await client.request("lifecycle", { op: "close" }, 5000).catch(() => {});
    await client.close().catch(() => {});
    client = null;
  }
});

async function startWeb(faults: Record<string, unknown> = {}): Promise<AdapterClient> {
  return AdapterClient.spawn({
    command: process.execPath,
    args: ["--import", "tsx", webBin],
    env: { ...process.env, WEB_FAULTS: JSON.stringify(faults) },
  });
}

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 10000, idempotency: "safe-retry", input };
}

describe("web adapter conformance (M1)", () => {
  it("1: passes initialize/version/capability negotiation", async () => {
    client = await startWeb();
    const caps = (await client.request("initialize", {}, 30000)) as { protocolVersion: string; adapter: string; capabilities: { act: string[] } };
    expect(caps.protocolVersion).toBe("0.1");
    expect(caps.adapter).toBe("web-playwright");
    expect(caps.capabilities.act).toContain("click");
    expect(caps.capabilities.act).toContain("navigate");
  });

  it("2/3: lifecycle create + observe returns url/title/semantic tree", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    const obs = (await client.request("observe", { observe: ["url", "title", "uiTree"] }, 20000)) as {
      summary: { url: string; title: string; uiTree: Array<{ id: string }> };
    };
    expect(obs.summary.title).toBe("SeedBank");
    expect(obs.summary.uiTree.some((e) => e.id === "loginBtn")).toBe(true);
  });

  it("4: semantic traversal reaches the dashboard with correlated artifacts", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("w1", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w2", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w3", "click", { selector: "#loginBtn" }) }, 15000);
    const obs = (await client.request("observe", { observe: ["uiTree", "screenshot", "console", "network", "trace"] }, 20000)) as {
      summary: { uiTree: Array<{ id: string; hidden?: boolean }> };
      artifacts: Array<{ sha256: string; mime: string }>;
    };
    const inc = obs.summary.uiTree.find((e) => e.id === "increment");
    expect(inc && inc.hidden === false).toBe(true);
    expect(obs.artifacts.some((a) => a.mime === "image/png")).toBe(true);
    expect(obs.artifacts.some((a) => a.mime === "application/zip")).toBe(true);
  });

  it("5: forbidden origin navigation is rejected", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    await expect(
      client.request("act", { action: act("w7", "navigate", { value: "https://evil.example.com/secret" }) }, 15000),
    ).rejects.toThrow(/CAPABILITY_DENIED/);
  });

  it("6: page/application crash is a target-failure, not an adapter crash", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    // The boom button lives on the dashboard; log in first.
    await client.request("act", { action: act("w4", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w5", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w6a", "click", { selector: "#loginBtn" }) }, 15000);
    const outcome = (await client.request("act", { action: act("w6", "click", { selector: "#boom" }) }, 15000)) as {
      status: string;
      error?: { code: string };
    };
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
  });

  it("3: reset returns to identical seeded state", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("a", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("b", "click", { selector: "#loginBtn" }) }, 15000);
    await client.request("act", { action: act("c", "click", { selector: "#increment" }) }, 15000);
    await client.request("lifecycle", { op: "reset" }, 15000);
    const obs = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id: string; hidden?: boolean }> };
    };
    const inc = obs.summary.uiTree.find((e) => e.id === "increment");
    expect(inc === undefined || inc.hidden === true).toBe(true);
    expect(obs.summary.uiTree.some((e) => e.id === "loginBtn")).toBe(true);
  });

  it("6: injected adapter (browser) crash is classified separately", async () => {
    client = await startWeb({ crashBrowser: true });
    await client.request("lifecycle", { op: "create" }, 30000);
    await expect(
      client.request("act", { action: act("x", "click", { selector: "#loginBtn" }) }, 15000),
    ).rejects.toThrow(/adapter-crash/);
  });
});
