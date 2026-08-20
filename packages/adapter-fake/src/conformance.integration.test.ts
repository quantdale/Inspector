import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient } from "@inspector/adapter-sdk";
import { FAKE_CAPABILITIES } from "./handler.js";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "bin.ts");

async function startFake(faults: Record<string, unknown> = {}): Promise<AdapterClient> {
  return AdapterClient.spawn({
    command: process.execPath,
    args: ["--import", "tsx", binPath],
    env: { ...process.env, FAKE_FAULTS: JSON.stringify(faults) },
  });
}

let client: AdapterClient | null = null;
afterEach(async () => {
  if (client) {
    await client.close().catch(() => {});
    client = null;
  }
});

describe("fake adapter conformance", () => {
  it("negotiates capabilities at protocol version 0.1", async () => {
    client = await startFake();
    const caps = (await client.request("initialize", {})) as typeof FAKE_CAPABILITIES;
    expect(caps.protocolVersion).toBe("0.1");
    expect(caps.adapter).toBe("adapter-fake");
    expect(caps.capabilities.act).toHaveLength(8);
  });

  it("transitions state through semantic actions and observes", async () => {
    client = await startFake();
    await client.request("initialize", {});
    const open = (await client.request("act", {
      action: {
        id: "a1",
        runId: "run",
        environmentId: "env",
        kind: "openForm",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
      },
    })) as { status: string; stateAfter: string };
    expect(open.status).toBe("success");
    expect(open.stateAfter).toBe("form");

    const obs = (await client.request("observe", { observe: ["state"] })) as {
      summary: { state: string };
    };
    expect(obs.summary.state).toBe("form");
  });

  it("signals the deterministic failure oracle as target-failure", async () => {
    client = await startFake();
    await client.request("initialize", {});
    await client.request("act", {
      action: {
        id: "a2",
        runId: "run",
        environmentId: "env",
        kind: "openForm",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
      },
    });
    await client.request("act", {
      action: {
        id: "a3",
        runId: "run",
        environmentId: "env",
        kind: "fillField",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
        input: { name: "default", value: "BAD" },
      },
    });
    const submit = (await client.request("act", {
      action: {
        id: "a4",
        runId: "run",
        environmentId: "env",
        kind: "submit",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "never-retry",
      },
    })) as { status: string; error?: { code: string } };
    expect(submit.status).toBe("target-failure");
    expect(submit.error?.code).toBe("TARGET_FAILURE");
  });

  it("resets the environment to the initial state", async () => {
    client = await startFake();
    await client.request("initialize", {});
    await client.request("act", {
      action: {
        id: "a5",
        runId: "run",
        environmentId: "env",
        kind: "openForm",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
      },
    });
    const reset = (await client.request("lifecycle", { op: "reset" })) as { ok: boolean };
    expect(reset.ok).toBe(true);
    const obs = (await client.request("observe", { observe: ["state"] })) as {
      summary: { state: string };
    };
    expect(obs.summary.state).toBe("home");
  });

  it("creates an artifact stub with a valid sha256", async () => {
    client = await startFake();
    await client.request("initialize", {});
    const res = (await client.request("act", {
      action: {
        id: "a6",
        runId: "run",
        environmentId: "env",
        kind: "createArtifact",
        risk: "interact",
        deadlineMs: 5000,
        idempotency: "safe-retry",
      },
    })) as { status: string; artifactRefs: string[] };
    expect(res.status).toBe("success");
    expect(res.artifactRefs[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("classifies an injected adapter crash separately from target failure", async () => {
    client = await startFake({ crashActionId: "crash1" });
    await client.request("initialize", {});
    await expect(
      client.request(
        "act",
        {
          action: {
            id: "crash1",
            runId: "run",
            environmentId: "env",
            kind: "openForm",
            risk: "interact",
            deadlineMs: 5000,
            idempotency: "safe-retry",
          },
        },
        8000,
      ),
    ).rejects.toThrow(/adapter-crash/);
  });

  it("classifies an injected timeout as deadline-exceeded", async () => {
    client = await startFake({ timeoutActionIds: ["slow1"], timeoutMs: 5000 });
    await client.request("initialize", {});
    await expect(
      client.request(
        "act",
        {
          action: {
            id: "slow1",
            runId: "run",
            environmentId: "env",
            kind: "openForm",
            risk: "interact",
            deadlineMs: 8000,
            idempotency: "safe-retry",
          },
        },
        300,
      ),
    ).rejects.toThrow(/deadline-exceeded/);
  });

  it("responds to health/heartbeat", async () => {
    client = await startFake();
    const health = (await client.request("health", { echo: "ping" })) as {
      ok: boolean;
      echo?: string;
    };
    expect(health.ok).toBe(true);
    expect(health.echo).toBe("ping");
  });
});
