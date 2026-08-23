/**
 * SPEC-009 W6/W8: Windows replay resolution + failure-class discipline.
 *
 *  - RuntimeId fast path within a live session
 *  - AutomationId / controlType+name semantic fallback after rehost/restart
 *  - unresolvable locator -> ACTION_FAILED automation failure (NEVER a
 *    TARGET_FAILURE product-defect signal)
 *  - genuine backend failure -> TARGET_FAILURE signal (enters pipeline)
 */
import { describe, it, expect } from "vitest";
import type { Action } from "@inspector/protocol";
import type { UiaRichNode } from "./real-uia.js";
import { resolveRid, WindowsUiaReplayDriver, WindowsReplayUnresolvableError } from "./replay.js";

function node(over: Partial<UiaRichNode> & { id: string }): UiaRichNode {
  return {
    id: over.id,
    type: over.type ?? "Button",
    name: over.name ?? over.id,
    automationId: over.automationId ?? "",
    enabled: over.enabled ?? true,
    offscreen: false,
    rect: null,
    patterns: over.patterns ?? ["InvokePatternIdentifiers.Pattern"],
  };
}

function click(input: Record<string, unknown>): Action {
  return {
    id: "a1",
    runId: "run_w",
    environmentId: "env",
    kind: "click",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input,
  };
}

describe("W6 windows replay resolution", () => {
  const freshTree = [
    node({ id: "42-OLD-1", name: "Gone", automationId: "" }),
    node({ id: "42-NEW-7", name: "Add", automationId: "addButton" }),
    node({ id: "42-NEW-8", name: "Memory add", automationId: "" }),
  ];

  it("rid fast path when the captured id is still live", () => {
    expect(
      resolveRid(freshTree, { ridSelector: "#42-NEW-7" }),
    ).toBe("42-NEW-7");
  });

  it("falls back to AutomationId when the rid died across a restart", () => {
    expect(
      resolveRid(freshTree, {
        ridSelector: "#42-STALE",
        automationId: "addButton",
      }),
    ).toBe("42-NEW-7");
  });

  it("falls back to controlType + exact accessible name last", () => {
    expect(
      resolveRid(freshTree, {
        ridSelector: "#42-STALE",
        controlType: "Button",
        controlName: "Memory add",
      }),
    ).toBe("42-NEW-8");
  });

  it("unresolvable locator -> null (automation failure, honestly)", () => {
    expect(resolveRid(freshTree, { ridSelector: "#42-STALE" })).toBeNull();
  });
});

describe("W6 windows replay driver failure classes", () => {
  function backendWith(invokeError?: Error) {
    let attached = 0;
    return {
      attached: () => attached,
      listWindows: async () => [{ pid: 4242, title: "Calculator" }],
      attach: async () => {
        attached++;
      },
      richTree: async () => ({
        pid: 4242,
        nodes: [node({ id: "r1", name: "Ok", automationId: "okBtn" })],
      }),
      invoke: async (_rid: string) => {
        if (invokeError) throw invokeError;
      },
      setValue: async () => {},
      closeWindow: async () => {},
    };
  }

  it("resolvable action succeeds through the fresh tree", async () => {
    const driver = new WindowsUiaReplayDriver({
      targetTitle: "Calculator",
      backend: backendWith(),
    });
    const r = await driver.replay([click({ selector: "#whatever", automationId: "okBtn" })]);
    expect(r.outcomes[0]?.status).toBe("success");
    expect(r.signals).toHaveLength(0);
  });

  it("unresolvable locator -> ACTION_FAILED automation miss, no defect signal", async () => {
    const driver = new WindowsUiaReplayDriver({
      targetTitle: "Calculator",
      backend: backendWith(),
    });
    const r = await driver.replay([click({ selector: "#stale-rid" })]);
    expect(r.outcomes[0]?.status).toBe("target-failure");
    if (r.outcomes[0] && "error" in r.outcomes[0]) {
      expect(r.outcomes[0].error?.code).toBe("ACTION_FAILED");
    }
    expect(r.signals).toHaveLength(0);
  });

  it("genuine backend failure -> TARGET_FAILURE signal for the pipeline", async () => {
    const driver = new WindowsUiaReplayDriver({
      targetTitle: "Calculator",
      backend: backendWith(new Error("IntentionalAppCrash")),
    });
    const r = await driver.replay([click({ selector: "#r1", automationId: "okBtn" })]);
    expect(r.outcomes[0]?.status).toBe("target-failure");
    expect(r.signals.some((s) => s.kind === "PAGE_ERROR")).toBe(true);
  });

  it("missing window -> unresolvable error before replay", async () => {
    const b = backendWith();
    b.listWindows = async () => [];
    const driver = new WindowsUiaReplayDriver({ targetTitle: "Ghost", backend: b });
    await expect(driver.replay([])).rejects.toBeInstanceOf(
      WindowsReplayUnresolvableError,
    );
  });
});
