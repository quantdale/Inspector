import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@inspector/protocol";
import { WindowsAdapterHandler } from "./windows-adapter.js";
import { MockUiaBackend } from "./mock-uia.js";

const ART_BASE = join(tmpdir(), "inspector-windows-hardening");

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

async function loginToDashboard(handler: WindowsAdapterHandler): Promise<void> {
  await handler.act({ action: act("f1", "fill", { selector: "#username", value: "admin" }) });
  await handler.act({ action: act("f2", "fill", { selector: "#password", value: "admin" }) });
  await handler.act({ action: act("f3", "click", { selector: "#loginBtn" }) });
}

describe("windows hardening: crash freshness (D1)", () => {
  it("repeated identical crash keeps classifying TARGET_FAILURE (never reads as success)", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    const r1 = await handler.act({ action: act("b1", "click", { selector: "#boomBtn" }) });
    expect(r1.status).toBe("target-failure");
    expect(r1.error?.code).toBe("TARGET_FAILURE");
    const r2 = await handler.act({ action: act("b2", "click", { selector: "#boomBtn" }) });
    expect(r2.status).toBe("target-failure");
    expect(r2.error?.code).toBe("TARGET_FAILURE");
    expect(r2.error?.message).toContain("IntentionalAppCrash");
  });

  it("repeated identical overflow crash at the boundary stays TARGET_FAILURE", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    let last;
    for (let i = 0; i < 8; i++) {
      last = await handler.act({ action: act(`inc${i}`, "click", { selector: "#incrementBtn" }) });
      if (last.status === "target-failure") break;
    }
    // inc #8 crosses the boundary and must classify as a genuine defect.
    expect(last?.status).toBe("target-failure");
    expect(last?.error?.code).toBe("TARGET_FAILURE");
    expect(last?.error?.message).toContain("IncrementOverflowCrash");
  });
});

describe("windows hardening: secret redaction (D7)", () => {
  it("masks password-field values in the uiTree before they persist", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await handler.act({ action: act("v1", "fill", { selector: "#username", value: "admin" }) });
    await handler.act({ action: act("v2", "fill", { selector: "#password", value: "hunter2" }) });
    const obs = await handler.observe({});
    const uiTree = (obs.summary as { uiTree: Array<{ id?: string; value?: string }> }).uiTree;
    const pw = uiTree.find((e) => e.id === "password");
    expect(pw?.value).toBe("***");
    const user = uiTree.find((e) => e.id === "username");
    expect(user?.value).toBe("admin");
  });
});

describe("windows hardening: dead backend honesty (D8)", () => {
  it("create fails when the UIA backend is dead instead of reporting success", async () => {
    const backend = new MockUiaBackend();
    backend.deviceCrashed = true;
    const handler = new WindowsAdapterHandler(backend, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/disconnected/);
  });

  it("health reflects a backend that died after create", async () => {
    const backend = new MockUiaBackend();
    const handler = new WindowsAdapterHandler(backend, ART_BASE);
    await handler.lifecycle({ op: "create" });
    expect((await handler.health()).ok).toBe(true);
    backend.deviceCrashed = true;
    expect((await handler.health()).ok).toBe(false);
  });
});

describe("windows hardening: attribution threading (D8)", () => {
  it("threads real run/environment ids from lifecycle options into observations", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create", options: { runId: "r42", environmentId: "e7" } });
    const obs = await handler.observe({});
    expect(obs.runId).toBe("r42");
    expect(obs.environmentId).toBe("e7");
  });
});

describe("windows torture (mock-driven)", () => {
  it("automation miss on a nonexistent control is ACTION_FAILED", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    const outcome = await handler.act({ action: act("m", "click", { selector: "#nonexistent" }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
  });

  it("injected fault crash is an AdapterCrashError, distinct from target failures", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await expect(
      handler.act({ action: act("c", "fault", { fault: "crash" }) }),
    ).rejects.toThrow(/adapter-crash/);
  });

  it("reset restores the seeded login baseline", async () => {
    const handler = new WindowsAdapterHandler(new MockUiaBackend(), ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    let obs = await handler.observe({});
    expect((obs.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((e) => e.id)).toContain("boomBtn");
    await handler.lifecycle({ op: "reset" });
    obs = await handler.observe({});
    const ids = (obs.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((e) => e.id);
    expect(ids).toContain("loginBtn");
    expect(ids).not.toContain("boomBtn");
  });
});
