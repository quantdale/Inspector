import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@inspector/protocol";
import {
  electronExecutablePath,
  RealElectronHandler,
  resolveElectronBackendMode,
} from "./real-electron.js";

let handler: RealElectronHandler | undefined;

const hasInteractiveDisplay =
  process.platform !== "linux" || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

function action(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "electron-real-run",
    environmentId: "electron-real-env",
    kind,
    risk: "interact",
    deadlineMs: 15_000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

afterEach(async () => {
  await handler?.shutdown().catch(() => {});
  handler = undefined;
});

describe("Electron production binding", () => {
  it("does not claim a real backend when the executable is unavailable", () => {
    const executable = electronExecutablePath();
    expect(resolveElectronBackendMode()).toBe(executable ? "real" : "injectable");
  });

  it.skipIf(!!electronExecutablePath())("refuses explicit real mode instead of falling back", async () => {
    handler = new RealElectronHandler(mkdtempSync(join(tmpdir(), "inspector-electron-real-refusal-")));
    await expect(handler.lifecycle({ op: "create" })).rejects.toThrow(/production Electron runtime unavailable/);
  });

  describe.skipIf(!electronExecutablePath() || !hasInteractiveDisplay)("with the installed Electron executable", () => {
    it("proves lifecycle, renderer actions, evidence, errors, and reset", async () => {
      handler = new RealElectronHandler(mkdtempSync(join(tmpdir(), "inspector-electron-real-test-")));
      await handler.initialize();
      expect((await handler.lifecycle({ op: "create" })).ok).toBe(true);

      const initial = await handler.observe({ observe: ["uiTree", "screenshot", "trace"] });
      const initialTree = initial.summary as { uiTree: Array<{ id?: string }> };
      expect(initialTree.uiTree.some((item) => item.id === "loginBtn")).toBe(true);
      expect((initial.artifacts ?? []).length).toBeGreaterThanOrEqual(2);

      expect((await handler.act({ action: action("u", "fill", { selector: "#username", value: "admin" }) })).status).toBe("success");
      expect((await handler.act({ action: action("p", "fill", { selector: "#password", value: "admin" }) })).status).toBe("success");
      expect((await handler.act({ action: action("l", "click", { selector: "#loginBtn" }) })).status).toBe("success");

      const dashboard = await handler.observe({ observe: ["uiTree"] });
      const dashboardTree = dashboard.summary as { uiTree: Array<{ id?: string; hidden?: boolean }> };
      expect(dashboardTree.uiTree.some((item) => item.id === "increment" && item.hidden === false)).toBe(true);

      expect((await handler.act({ action: action("s", "click", { selector: "#save" }) })).status).toBe("success");
      const evidence = await handler.observe({ observe: ["storage"] });
      expect((evidence.summary as { storage: Record<string, string> }).storage.pref).toBe("saved-0");

      const failure = await handler.act({ action: action("b", "click", { selector: "#boom" }) });
      expect(failure.status).toBe("target-failure");
      expect(failure.error?.code).toBe("TARGET_FAILURE");

      expect((await handler.lifecycle({ op: "reset" })).ok).toBe(true);
      const reset = await handler.observe({ observe: ["uiTree"] });
      expect((reset.summary as { uiTree: Array<{ id?: string }> }).uiTree.some((item) => item.id === "loginBtn")).toBe(true);
      expect((await handler.lifecycle({ op: "close" })).ok).toBe(true);
    });
  });
});
