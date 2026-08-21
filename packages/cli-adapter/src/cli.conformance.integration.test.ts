import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient, runCommonConformance } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";

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

async function startCli(): Promise<AdapterClient> {
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

describe("cli adapter conformance (M6 C1)", () => {
  it("passes the common conformance contract", async () => {
    await runCommonConformance({
      start: startCli,
      stop: async (c) => {
        await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
        await c.close();
      },
      traverseSteps: [act("t1", "fill", { value: "login admin admin" })],
      crashStep: act("crash", "fill", { value: "boom" }),
      missStep: act("miss", "fill", { value: "definitely-not-a-command" }),
      expectedIdsAfterTraverse: ["mode-auth"],
    });
  });

  it("counter overflow defect aborts the process at the boundary", async () => {
    client = await startCli();
    await client.request("lifecycle", { op: "create" }, 30000);
    await client.request("act", { action: act("e1", "fill", { value: "login admin admin" }) }, 15000);
    let outcome = { status: "success" } as { status: string; error?: { code: string; message?: string } };
    for (let i = 0; i < 8; i++) {
      const r = (await client.request("act", { action: act(`inc${i}`, "fill", { value: "inc" }) }, 15000)) as typeof outcome;
      outcome = r;
      if (r.status === "target-failure") break;
    }
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    expect(outcome.error?.message).toContain("IncrementOverflowCrash");
  });
});
