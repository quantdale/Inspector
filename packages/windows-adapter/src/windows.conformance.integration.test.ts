import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient, runCommonConformance } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";
import { WINDOWS_BACKEND_ENV } from "./selection.js";

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

async function startWindows(): Promise<AdapterClient> {
  return AdapterClient.spawn({
    command: process.execPath,
    args: ["--import", "tsx", bin],
    env: { ...process.env, [WINDOWS_BACKEND_ENV]: "mock" },
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

describe("windows adapter conformance (M6 C3)", () => {
  it("passes the common conformance contract", async () => {
    await runCommonConformance({
      start: startWindows,
      stop: async (c) => {
        await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
        await c.close();
      },
      traverseSteps: [
        act("t1", "fill", { selector: "#username", value: "admin" }),
        act("t2", "fill", { selector: "#password", value: "admin" }),
        act("t3", "click", { selector: "#loginBtn" }),
      ],
      crashStep: act("crash", "click", { selector: "#boomBtn" }),
      missStep: act("miss", "click", { selector: "#nonexistent" }),
      expectedIdsAfterTraverse: ["incrementBtn"],
    });
  });

  it("counter overflow defect surfaces through the UIA boundary", async () => {
    client = await startWindows();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("w1", "fill", { selector: "#username", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w2", "fill", { selector: "#password", value: "admin" }) }, 15000);
    await client.request("act", { action: act("w3", "click", { selector: "#loginBtn" }) }, 15000);
    let outcome = { status: "success" } as { status: string; error?: { code: string; message?: string } };
    for (let i = 0; i < 8; i++) {
      const r = (await client.request(
        "act",
        { action: act(`inc${i}`, "click", { selector: "#incrementBtn" }) },
        15000,
      )) as typeof outcome;
      outcome = r;
      if (r.status === "target-failure") break;
    }
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    expect(outcome.error?.message).toContain("IncrementOverflowCrash");
  });
});
