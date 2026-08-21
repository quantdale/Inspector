import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient } from "@inspector/adapter-sdk";
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
  // NOTE: runCommonConformance is not used here. Its third scenario runs
  // missStep AFTER crashStep in the same session; for the CLI the crash step
  // terminates the process, so the miss would land on a dead session. Wave-2
  // hardening defect #8 requires dead-session outcomes to stay classified as
  // the underlying crash (TARGET_FAILURE) instead of flip-flopping to a
  // generic ACTION_FAILED "session not alive" — see cli.hardening.test.ts.
  // The identical assertions follow, with the automation miss exercised
  // against a LIVE session (its meaningful precondition).
  it("passes the common conformance contract", async () => {
    // Version/capability negotiation.
    let c = await startCli();
    try {
      const caps = (await c.request("initialize", {})) as { protocolVersion: string };
      expect(caps.protocolVersion).toBe("0.1");
    } finally {
      await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
      await c.close();
    }

    // Baseline -> traverse -> reset restores the baseline.
    c = await startCli();
    try {
      await c.request("lifecycle", { op: "create" }, 30000);
      const restoredCheck = (await c.request("observe", { observe: ["uiTree"] }, 20000)) as {
        summary: { uiTree: Array<{ id?: string }> };
      };
      expect(restoredCheck.summary.uiTree.some((e) => e.id === "mode-guest")).toBe(true);

      await c.request("act", { action: act("cc-0", "fill", { value: "login admin admin" }) }, 15000);
      const after = (await c.request("observe", { observe: ["uiTree"] }, 20000)) as {
        summary: { uiTree: Array<{ id?: string }> };
      };
      expect(after.summary.uiTree.some((e) => e.id === "mode-auth")).toBe(true);

      await c.request("lifecycle", { op: "reset" }, 15000);
      const restored = (await c.request("observe", { observe: ["uiTree"] }, 20000)) as {
        summary: { uiTree: Array<{ id?: string }> };
      };
      expect(restored.summary.uiTree.some((e) => e.id === "mode-guest")).toBe(true);
    } finally {
      await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
      await c.close();
    }

    // Automation miss on a LIVE session -> ACTION_FAILED; genuine crash ->
    // TARGET_FAILURE; replaying after the crash stays stably classified.
    c = await startCli();
    try {
      await c.request("lifecycle", { op: "create" }, 30000);
      const miss = (await c.request(
        "act",
        { action: act("cf-miss", "fill", { value: "definitely-not-a-command" }) },
        15000,
      )) as { status: string; error?: { code: string } };
      expect(miss.status).toBe("target-failure");
      expect(miss.error?.code).toBe("ACTION_FAILED");

      const crash = (await c.request(
        "act",
        { action: act("cf-crash", "fill", { value: "boom" }) },
        15000,
      )) as { status: string; error?: { code: string } };
      expect(crash.status).toBe("target-failure");
      expect(crash.error?.code).toBe("TARGET_FAILURE");

      const replay = (await c.request(
        "act",
        { action: act("cf-replay", "fill", { value: "count" }) },
        15000,
      )) as { status: string; error?: { code: string } };
      expect(replay.status).toBe("target-failure");
      expect(replay.error?.code).toBe("TARGET_FAILURE");
    } finally {
      await c.request("lifecycle", { op: "close" }, 5000).catch(() => {});
      await c.close();
    }
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
