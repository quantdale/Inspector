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

async function startElectron(): Promise<AdapterClient> {
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

describe("electron adapter conformance (M6 C2)", () => {
  it("reports electron identity while reusing browser semantics", async () => {
    client = await startElectron();
    const caps = (await client.request("initialize", {})) as { adapter: string };
    expect(caps.adapter).toBe("electron-chromium");
  });

  it("passes the common conformance contract", async () => {
    await runCommonConformance({
      start: startElectron,
      stop: async (c) => {
        await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
        await c.close();
      },
      traverseSteps: [
        act("t1", "fill", { selector: "#username", value: "admin" }),
        act("t2", "fill", { selector: "#password", value: "admin" }),
        act("t3", "click", { selector: "#loginBtn" }),
      ],
      crashStep: act("crash", "click", { selector: "#boom" }),
      missStep: act("miss", "click", { selector: "#nonexistent" }),
      expectedIdsAfterTraverse: ["increment"],
    });
  });
});
