import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { AndroidReplayDriver } from "./replay.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "bin.ts");

let client: AdapterClient | null = null;
afterEach(async () => {
  if (client) {
    await client.request("lifecycle", { op: "close" }, 5000).catch(() => {});
    await client.close().catch(() => {});
    client = null;
  }
});

async function startAndroid(): Promise<AdapterClient> {
  return AdapterClient.spawn({
    command: process.execPath,
    args: ["--import", "tsx", bin],
    env: { ...process.env },
  });
}

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

describe("android adapter conformance (M5)", () => {
  it("1: passes initialize/version/capability negotiation", async () => {
    client = await startAndroid();
    const caps = (await client.request("initialize", {})) as {
      protocolVersion: string;
      adapter: string;
      capabilities: { act: string[] };
    };
    expect(caps.protocolVersion).toBe("0.1");
    expect(caps.adapter).toBe("android-uiautomator");
    expect(caps.capabilities.act).toContain("click");
    expect(caps.capabilities.act).toContain("fill");
  });

  it("2/3: lifecycle create + observe returns semantic UI tree", async () => {
    client = await startAndroid();
    await client.request("lifecycle", { op: "create" }, 30000);
    const obs = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string; role: string }> };
    };
    const ids = obs.summary.uiTree.map((e) => e.id);
    expect(ids).toContain("username");
    expect(ids).toContain("password");
    expect(ids).toContain("login");
  });

  it("4: semantic traversal reaches the dashboard", async () => {
    client = await startAndroid();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("a1", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("a2", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("a3", "click", { selector: "#login" }) }, 15000);
    const obs = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string }> };
    };
    expect(obs.summary.uiTree.map((e) => e.id)).toContain("increment");
  });

  it("5: application crash is a target-failure, not an adapter crash", async () => {
    client = await startAndroid();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("b1", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("b2", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("b3", "click", { selector: "#login" }) }, 15000);
    const outcome = (await client.request("act", { action: act("b4", "click", { selector: "#boom" }) }, 15000)) as {
      status: string;
      error?: { code: string };
    };
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
  });

  it("6: automation miss is ACTION_FAILED, not a defect", async () => {
    client = await startAndroid();
    await client.request("lifecycle", { op: "create" }, 30000);
    const outcome = (await client.request(
      "act",
      { action: act("c1", "click", { selector: "#doesNotExist" }) },
      15000,
    )) as { status: string; error?: { code: string } };
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
  });

  it("7: reset returns to identical seeded state", async () => {
    client = await startAndroid();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("d1", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("d2", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("d3", "click", { selector: "#login" }) }, 15000);
    await client.request("lifecycle", { op: "reset" }, 15000);
    const obs = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string }> };
    };
    const ids = obs.summary.uiTree.map((e) => e.id);
    expect(ids).toContain("login");
    expect(ids).not.toContain("increment");
  });
});

describe("M5 exit gate: core finding pipeline confirms seeded android defects", () => {
  it("confirms the boom crash through the standard reproduction policy", async () => {
    const engine = new FindingEngine(OracleEngine.defaults());
    const finding = engine.ingest({ kind: "PAGE_ERROR", detail: "IntentionalAppCrash" }, {
      title: "SeedDroid boom crash",
    });
    const path = [
      { id: "s1", kind: "fill", risk: "interact", input: { selector: "#username", value: "admin" } },
      { id: "s2", kind: "fill", risk: "interact", input: { selector: "#password", value: "admin" } },
      { id: "s3", kind: "click", risk: "interact", input: { selector: "#login" } },
      { id: "s4", kind: "click", risk: "interact", input: { selector: "#boom" } },
    ] as unknown as Parameters<FindingEngine["reproduce"]>[1];

    const driver = new AndroidReplayDriver();
    const rep = await engine.reproduce(finding, path, driver, { attempts: 1, minSuccesses: 1 });
    expect(rep.finding.status).toBe("CONFIRMED");
    expect(rep.lastSignals.some((s) => s.kind === "PAGE_ERROR")).toBe(true);
  }, 120000);

  it("confirms the increment overflow defect at the count boundary", async () => {
    const engine = new FindingEngine(OracleEngine.defaults());
    const finding = engine.ingest({ kind: "PAGE_ERROR", detail: "IncrementOverflowCrash" }, {
      title: "SeedDroid counter overflow",
    });
    const path = [
      { id: "t1", kind: "fill", risk: "interact", input: { selector: "#username", value: "admin" } },
      { id: "t2", kind: "fill", risk: "interact", input: { selector: "#password", value: "admin" } },
      { id: "t3", kind: "click", risk: "interact", input: { selector: "#login" } },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `inc${i}`,
        kind: "click",
        risk: "interact",
        input: { selector: "#increment" },
      })),
    ] as unknown as Parameters<FindingEngine["reproduce"]>[1];

    const driver = new AndroidReplayDriver();
    const rep = await engine.reproduce(finding, path, driver, { attempts: 1, minSuccesses: 1 });
    expect(rep.finding.status).toBe("CONFIRMED");
  }, 120000);
});
