import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterCrashError } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";
import { SEED_HTML } from "@inspector/adapter-web";
import { ElectronAdapterHandler } from "./electron-adapter.js";

const ART_BASE = join(tmpdir(), "inspector-electron-hardening");

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

describe("electron hardening: one-shot crash fault (D8)", () => {
  it("the injected crash fault fires once; later acts are no longer hijacked", async () => {
    const handler = new ElectronAdapterHandler({ crashApp: true }, ART_BASE);
    await expect(handler.act({ action: act("c1", "click", { selector: "#loginBtn" }) })).rejects.toThrow(
      /adapter-crash/,
    );
    // Second act must reach the underlying web adapter (which fails with
    // VALIDATION because no environment was created) instead of the crash fault.
    await expect(handler.act({ action: act("c2", "click", { selector: "#loginBtn" }) })).rejects.toThrow(
      /environment not created/,
    );
  });

  it("a handler without the fault never throws AdapterCrashError from act", async () => {
    const handler = new ElectronAdapterHandler({}, ART_BASE, SEED_HTML, "injectable");
    await expect(handler.act({ action: act("n", "click", { selector: "#loginBtn" }) })).rejects.toThrow(
      /environment not created/,
    );
  });
});

describe("electron hardening: unique artifact dirs (D4)", () => {
  it("concurrent instances get distinct artifact directories under the shared base", () => {
    const a = new ElectronAdapterHandler({}, ART_BASE, SEED_HTML, "injectable");
    const b = new ElectronAdapterHandler({}, ART_BASE, SEED_HTML, "injectable");
    // artifactDir is the mkdtemp directory the underlying web handler derived
    // for this instance (owned by the adapter-web package).
    const dirOf = (h: ElectronAdapterHandler) =>
      (h as unknown as { web: { artifactDir: string } }).web.artifactDir;
    const da = dirOf(a);
    const db = dirOf(b);
    expect(da).not.toBe(ART_BASE);
    expect(db).not.toBe(ART_BASE);
    expect(da).not.toBe(db);
    expect(da.startsWith(ART_BASE)).toBe(true);
    expect(db.startsWith(ART_BASE)).toBe(true);
  });
});

describe("electron hardening: attribution threading (D8)", () => {
  it("threads real run/environment ids from lifecycle options into the underlying handler", async () => {
    const handler = new ElectronAdapterHandler({}, ART_BASE, SEED_HTML, "injectable");
    try {
      // Attribution is applied BEFORE any browser launch inside create, so
      // this wiring proof holds whether or not a Chromium executable is
      // available to complete environment creation (hermetic unit lane).
      await handler
        .lifecycle({ op: "create", options: { runId: "r42", environmentId: "e7" } })
        .catch(() => {});
      const web = handler as unknown as { web: { runId?: string; environmentId?: string } };
      expect(web.web.runId).toBe("r42");
      expect(web.web.environmentId).toBe("e7");
    } finally {
      await handler.shutdown().catch(() => {});
    }
  });
});

describe("electron hardening: crash error identity", () => {
  it("crash faults surface as AdapterCrashError instances", async () => {
    const handler = new ElectronAdapterHandler({ crashApp: true }, ART_BASE);
    try {
      await handler.act({ action: act("x", "click", {}) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterCrashError);
    }
  });
});
