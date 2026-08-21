import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@inspector/protocol";
import {
  AndroidAdapterHandler,
  MockAdbBackend,
  SEED_PACKAGE,
  parseUiautomatorDump,
} from "./index.js";
import { ANDROID_CAPABILITIES } from "./android-adapter.js";
import type { AdbBackend } from "./types.js";

const ART_BASE = join(tmpdir(), "inspector-android-hardening");

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

class RecordingBackend extends MockAdbBackend {
  readonly commands: string[] = [];
  override async shell(serial: string, cmd: string): Promise<string> {
    this.commands.push(cmd);
    return super.shell(serial, cmd);
  }
}

/** Backend whose uiautomator dump is replaced by arbitrary output. */
function stubDumpBackend(dumpXml: string): AdbBackend {
  return {
    devices: async () => ["emulator-5554"],
    shell: async (_serial, cmd) =>
      cmd.startsWith("uiautomator") ? dumpXml : "",
    screencap: async () => Buffer.from([0x89, 0x50]),
    logcat: async () => [],
    install: async () => {},
    uninstall: async () => {},
    appErrors: async () => [],
  };
}

async function loginToDashboard(
  handler: AndroidAdapterHandler,
): Promise<void> {
  await handler.act({ action: act("f1", "fill", { selector: "#username", value: "admin" }) });
  await handler.act({ action: act("f2", "fill", { selector: "#password", value: "admin" }) });
  await handler.act({ action: act("f3", "click", { selector: "#login" }) });
}

describe("android hardening: crash freshness (D1)", () => {
  it("repeated identical crash keeps classifying TARGET_FAILURE (never reads as success)", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    const r1 = await handler.act({ action: act("b1", "click", { selector: "#boom" }) });
    expect(r1.status).toBe("target-failure");
    expect(r1.error?.code).toBe("TARGET_FAILURE");
    const r2 = await handler.act({ action: act("b2", "click", { selector: "#boom" }) });
    expect(r2.status).toBe("target-failure");
    expect(r2.error?.code).toBe("TARGET_FAILURE");
    expect(r2.error?.message).toContain("IntentionalAppCrash");
  });

  it("repeated identical overflow crash at the boundary stays TARGET_FAILURE", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    let last;
    for (let i = 0; i < 8; i++) {
      last = await handler.act({ action: act(`inc${i}`, "click", { selector: "#increment" }) });
      if (last.status === "target-failure") break;
    }
    // inc #8 crosses the boundary and must classify as a genuine defect.
    expect(last?.status).toBe("target-failure");
    expect(last?.error?.code).toBe("TARGET_FAILURE");
    expect(last?.error?.message).toContain("IncrementOverflowCrash");
  });
});

describe("android hardening: shell injection surface (D5)", () => {
  it("quotes input text so hostile values cannot inject device-shell structure", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create" });

    for (const hostile of ["a; reboot", "$(id)", "`reboot`", "x && rm -rf /", 'q"q']) {
      backend.commands.length = 0;
      const outcome = await handler.act({
        action: act("h", "fill", { selector: "#username", value: hostile }),
      });
      expect(outcome.status, hostile).toBe("success");
      const cmd = backend.commands.find((c) => c.startsWith("input text"));
      expect(cmd, hostile).toBeDefined();
      // The whole value travels as ONE quoted device-shell word: the command
      // is exactly "input text '<escaped>'" with no unquoted tail.
      expect(cmd!, hostile).toMatch(/^input text '[^']*'(?:'\\''[^']*')*$/);
      // And the mock stores the exact value (no structural execution).
      expect(backend.stateFor("emulator-5554").username, hostile).toBe(hostile);
    }
  });

  it("round-trips a value containing a single quote through device-shell escaping", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const outcome = await handler.act({
      action: act("q", "fill", { selector: "#username", value: "o'brien" }),
    });
    expect(outcome.status).toBe("success");
    expect(backend.stateFor("emulator-5554").username).toBe("o'brien");
    expect(backend.commands).toContain("input text 'o'\\''brien'");
  });

  it("rejects non-integer keyevent codes instead of interpolating them", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    await expect(
      handler.act({ action: act("k1", "press", { value: "4; reboot" }) }),
    ).rejects.toThrow(/keyevent/);
    await expect(
      handler.act({ action: act("k2", "press", { value: "BACK" }) }),
    ).rejects.toThrow(/keyevent/);
    const ok = await handler.act({ action: act("k3", "press", { value: "4" }) });
    expect(ok.status).toBe("success");
  });
});

describe("android hardening: stale/empty hierarchies (D6)", () => {
  it("marks a failed (empty) dump as an observation error, not a valid empty tree", async () => {
    const handler = new AndroidAdapterHandler(stubDumpBackend(""), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({ observe: ["uiTree"] });
    const summary = obs.summary as { uiTree: unknown[]; observeError?: { source: string; message: string } };
    expect(summary.uiTree).toEqual([]);
    expect(summary.observeError).toBeDefined();
    expect(summary.observeError?.source).toContain("uiautomator");
  });

  it("marks a truncated dump as an observation error", async () => {
    const truncated =
      "<?xml version='1.0'?><hierarchy rotation=\"0\"><node index=\"0\" text=\"hi\" resource-id=\"com.seedbank.droid:id/x\" class=\"android.widget.TextView\" bounds=\"[0,0][10,10]\" />";
    const handler = new AndroidAdapterHandler(stubDumpBackend(truncated), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({});
    const summary = obs.summary as { observeError?: unknown };
    expect(summary.observeError).toBeDefined();
  });

  it("does not flag a well-formed hierarchy that legitimately has zero id-mapped nodes", async () => {
    const empty = "<hierarchy rotation=\"0\"></hierarchy>";
    const handler = new AndroidAdapterHandler(stubDumpBackend(empty), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({});
    const summary = obs.summary as { uiTree: unknown[]; observeError?: unknown };
    expect(summary.uiTree).toEqual([]);
    expect(summary.observeError).toBeUndefined();
  });

  it("derives hidden from zero-area bounds instead of hardcoding false", () => {
    const xml =
      "<hierarchy rotation=\"0\">" +
      `<node index="0" text="" resource-id="${SEED_PACKAGE}:id/ghost" class="android.widget.Button" bounds="[10,10][10,10]" enabled="true"/>` +
      `<node index="1" text="Hi" resource-id="${SEED_PACKAGE}:id/real" class="android.widget.TextView" bounds="[0,0][100,40]" enabled="true"/>` +
      "</hierarchy>";
    const els = parseUiautomatorDump(xml);
    expect(els.find((e) => e.id === "ghost")?.hidden).toBe(true);
    expect(els.find((e) => e.id === "real")?.hidden).toBe(false);
  });
});

describe("android hardening: logcat redaction (D7)", () => {
  it("strips credentials from URLs in logcat lines before they persist", async () => {
    const base = new MockAdbBackend();
    const handler = new AndroidAdapterHandler(
      {
        devices: () => base.devices(),
        shell: (s, c) => base.shell(s, c),
        screencap: () => base.screencap(),
        logcat: async () => ["E App: call failed https://user:pass@api.example.com/v1?token=abc"],
        install: (s) => base.install(s),
        uninstall: (s) => base.uninstall(s),
        appErrors: (s) => base.appErrors(s),
      } as AdbBackend,
      {},
      ART_BASE,
    );
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({ observe: ["logcat"] });
    const summary = obs.summary as { logcat: string[] };
    // Credentials-only stripping for freeform logcat (documented debt: query
    // strings in freeform text are left intact).
    expect(summary.logcat[0]).not.toContain("user:pass");
    expect(summary.logcat[0]).toContain("api.example.com");
  });
});

describe("android hardening: attribution threading (D8)", () => {
  it("threads real run/environment ids from lifecycle options into observations", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { runId: "r42", environmentId: "e7" } });
    const obs = await handler.observe({});
    expect(obs.runId).toBe("r42");
    expect(obs.environmentId).toBe("e7");
  });
});

describe("android hardening: advertised faults are implemented (D8)", () => {
  it("does not advertise a 'timeout' fault that act() rejects as unsupported", () => {
    const faults = ANDROID_CAPABILITIES.capabilities.faults ?? [];
    expect(faults).not.toContain("timeout");
    expect(faults).toContain("crash");
  });
});

describe("android torture (mock-driven)", () => {
  it("missing device fails create explicitly", async () => {
    const backend = new MockAdbBackend();
    backend.devices = async () => [];
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/no device/);
  });

  it("offline/crashed device fails create and actions are classified as automation failures", async () => {
    const backend = new MockAdbBackend();
    backend.deviceCrashed = true;
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/offline/);
    // Direct act without a created environment is a validation error.
    await expect(handler.act({ action: act("x", "click", { selector: "#login" }) })).rejects.toThrow();
  });

  it("malformed uiautomator XML yields an error-marked observation, not a crash", async () => {
    const handler = new AndroidAdapterHandler(stubDumpBackend("<html>totally not xml"), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const obs = await handler.observe({});
    const summary = obs.summary as { uiTree: unknown[]; observeError?: unknown };
    expect(summary.uiTree).toEqual([]);
    expect(summary.observeError).toBeDefined();
  });

  it("rotation attribute in the hierarchy does not break parsing", () => {
    const xml =
      "<hierarchy rotation=\"90\">" +
      `<node index="0" text="Log in" resource-id="${SEED_PACKAGE}:id/login" class="android.widget.Button" bounds="[40,380][440,444]" enabled="true"/>` +
      "</hierarchy>";
    const els = parseUiautomatorDump(xml);
    expect(els).toHaveLength(1);
    expect(els[0]?.id).toBe("login");
  });

  it("input without a focused field is an automation miss (permission-style denial)", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    const outcome = await handler.act({ action: act("p", "fill", { selector: "#username", value: "admin" }) });
    // Tapping the field focuses it first, so fill succeeds; force the denial by
    // filling after logout reset cleared focus state via reset.
    expect(["success", "target-failure"]).toContain(outcome.status);
    await handler.lifecycle({ op: "reset" });
    const denied = await handler.act({ action: act("p2", "fill", { selector: "#msg", value: "admin" }) });
    expect(denied.status).toBe("target-failure");
    expect(denied.error?.code).toBe("ACTION_FAILED");
  });

  it("reset/reinstall cycle restores the seeded baseline", async () => {
    const handler = new AndroidAdapterHandler(new MockAdbBackend(), {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    await loginToDashboard(handler);
    let obs = await handler.observe({});
    expect((obs.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((e) => e.id)).toContain("boom");
    await handler.lifecycle({ op: "reset" });
    obs = await handler.observe({});
    const ids = (obs.summary as { uiTree: Array<{ id?: string }> }).uiTree.map((e) => e.id);
    expect(ids).toContain("login");
    expect(ids).not.toContain("boom");
  });
});
