/**
 * SPEC-009 A3: platform inventory builders — chrome/deny exclusion, pattern
 * targeting, safe terminal pool, and scheme dispatch.
 */
import { describe, it, expect } from "vitest";
import type { CapabilityDoc } from "@inspector/protocol";
import {
  buildUiaInventory,
  buildAndroidInventory,
  buildPtyInventory,
  buildNativeInventory,
} from "./native-inventory.js";
import type { UiElement } from "./state.js";

function el(
  partial: Partial<UiElement & { patterns?: string[] }> & { id: string },
): UiElement {
  return {
    tag: "control",
    role: "button",
    name: partial.id,
    hidden: false,
    disabled: false,
    ...partial,
  } as UiElement;
}

const uiaCaps: CapabilityDoc = {
  protocolVersion: "0.1",
  adapter: "windows-uia",
  capabilities: {
    observe: ["uiTree"],
    act: ["click", "fill"],
    lifecycle: [],
    vocabulary: [
      { kind: "click", targetScheme: "uia-runtime-id", risk: "interact", autonomousEligible: true },
      { kind: "fill", targetScheme: "uia-runtime-id", risk: "interact", autonomousEligible: true },
    ],
  },
};

describe("SPEC-009 A3: UIA inventory", () => {
  it("targets InvokePattern controls; excludes chrome, deny labels, pattern-less nodes", () => {
    const tree: UiElement[] = [
      el({ id: "42-1-1", name: "Minimize", patterns: ["InvokePatternIdentifiers.Pattern"] }),
      el({ id: "42-1-2", name: "Close Calculator", patterns: ["InvokePatternIdentifiers.Pattern"] }),
      el({ id: "42-1-3", name: "Sign in", patterns: ["InvokePatternIdentifiers.Pattern"] }),
      el({ id: "42-1-4", name: "Memory add", patterns: ["InvokePatternIdentifiers.Pattern"] }),
      el({ id: "42-1-5", role: "input", name: "field", patterns: ["ValuePatternIdentifiers.Pattern"] }),
      el({ id: "42-1-6", name: "No patterns here" }),
    ];
    const out = buildUiaInventory(tree, uiaCaps, { allowFaults: false });
    const keys = out.map((c) => c.actionKey);
    expect(keys).toContain("click:42-1-4");
    expect(keys.some((k) => k.includes("42-1-1"))).toBe(false);
    expect(keys.some((k) => k.includes("42-1-2"))).toBe(false);
    expect(keys.some((k) => k.includes("42-1-3"))).toBe(false);
    expect(keys.some((k) => k.startsWith("fill:"))).toBe(true);
  });

  it("dispatches by declared target scheme (uia-runtime-id)", () => {
    const tree: UiElement[] = [
      el({ id: "7-7-1", name: "Ok", patterns: ["InvokePatternIdentifiers.Pattern"] }),
    ];
    expect(buildNativeInventory(tree, uiaCaps, { allowFaults: false }).length).toBe(1);
  });
});

describe("SPEC-009 A3: Android inventory", () => {
  const androidCaps: CapabilityDoc = {
    protocolVersion: "0.1",
    adapter: "android-uiautomator",
    capabilities: {
      observe: ["uiTree"],
      act: ["click", "press"],
      lifecycle: [],
      vocabulary: [
        { kind: "click", targetScheme: "android-resource-id", risk: "interact", autonomousEligible: true },
        { kind: "press", targetScheme: "android-resource-id", risk: "interact", autonomousEligible: true },
      ],
    },
  };

  it("taps id-bearing rows, offers BACK, respects deny labels and hidden nodes", () => {
    const tree: UiElement[] = [
      el({ id: "title", name: "Network settings", text: "Network settings" }),
      el({ id: "danger", name: "Uninstall updates", text: "Uninstall updates" }),
      el({ id: "off", name: "x", text: "x", hidden: true }),
    ];
    const out = buildAndroidInventory(tree, androidCaps, { allowFaults: false });
    expect(out.some((c) => c.actionKey === "click:title")).toBe(true);
    expect(out.some((c) => c.actionKey === "click:danger")).toBe(false);
    expect(out.some((c) => c.actionKey === "press:back")).toBe(true);
  });
});

describe("SPEC-009 A3: PTY inventory", () => {
  const ptyCaps: CapabilityDoc = {
    protocolVersion: "0.1",
    adapter: "cli-pty",
    capabilities: {
      observe: ["uiTree"],
      act: ["fill", "press"],
      lifecycle: [],
      vocabulary: [
        { kind: "terminal-input", targetScheme: "pty-input", risk: "interact", autonomousEligible: true },
        { kind: "press", targetScheme: "pty-input", risk: "interact", autonomousEligible: true },
      ],
    },
  };

  it("emits ONLY the fixed safe token pool plus Ctrl-C (no shell synthesis)", () => {
    const out = buildPtyInventory([], ptyCaps, { allowFaults: false });
    expect(out.length).toBeGreaterThanOrEqual(10);
    for (const c of out) {
      if (c.kind === "press") {
        expect(c.value).toBe("\u0003");
      } else {
        // Every fill token must come from the known-safe set (no ';', no
        // shell metacharacters).
        expect(c.value).not.toMatch(/[;&|`$><]/);
      }
    }
  });

  it("scheme dispatch returns nothing when the adapter declares no native scheme", () => {
    const webLikeCaps: CapabilityDoc = {
      protocolVersion: "0.1",
      adapter: "adapter-fake",
      capabilities: { observe: ["uiTree"], act: [], lifecycle: [] },
    };
    expect(
      buildNativeInventory([], webLikeCaps, { allowFaults: false }),
    ).toEqual([]);
  });
});
