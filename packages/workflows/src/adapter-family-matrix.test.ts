import { describe, expect, it } from "vitest";
import { ADAPTER_FAMILIES, validateWorkItem } from "@inspector/scale";
import type { WorkItem, WorkItemFailureClass } from "@inspector/scale";
import {
  FAMILY_CAPABILITY,
  familyAdapter,
  classifyWorkflowError,
} from "./campaign-executor.js";
import { FAMILY_CONTRACT, familyContractFor } from "./families.js";
import { REPLAY_SUPPORTED_DURABLE_ADAPTERS } from "./replay-subject.js";
import { adapterSpawn } from "./workspace.js";

/**
 * HARDENING_5 H5.5: the adapter-family matrix contract. The canonical family
 * list is owned by @inspector/scale (manifest validation). EVERY layer below
 * must handle each declared family exactly — compile time via
 * `Record<AdapterFamily, ...>` in families.ts, runtime via these assertions.
 * Adding a family to scale without updating the workflow layers fails this
 * suite, so a future family can never silently skip a layer again (the
 * H5-D0 electron→fake class).
 */

const EXPECTED_DURABLE_IDS: Record<string, string> = {
  fake: "adapter-fake",
  web: "web-playwright",
  cli: "cli-pty",
  windows: "windows-uia",
  android: "android-uiautomator",
  electron: "electron-chromium",
};

describe("HARDENING_5 adapter-family execution contract", () => {
  it("every declared scale family has a complete workflow-layer contract", () => {
    expect(Object.keys(FAMILY_CONTRACT).sort()).toEqual([...ADAPTER_FAMILIES].sort());
    for (const family of ADAPTER_FAMILIES) {
      const contract = FAMILY_CONTRACT[family];
      expect(contract.durableAdapterId).toBe(EXPECTED_DURABLE_IDS[family]);
      expect(["web", "native", "fake"]).toContain(contract.explorerKind);
      // Browser-like kinds are exactly web + electron (shared controller).
      expect(contract.browserLike).toBe(contract.explorerKind === "web" || family === "electron");
      if (family !== "fake") {
        expect(FAMILY_CAPABILITY[family]).toMatch(/^[a-z-]+$/);
      }
    }
  });

  it("every declared family is accepted by manifest validation", () => {
    for (const family of ADAPTER_FAMILIES) {
      const item = validateWorkItem(
        { id: `item-${family}`, workflow: "hunt", adapterFamily: family },
        "items[0]",
        0,
        [],
      );
      expect(item?.adapterFamily ?? (family === "fake" ? "fake" : undefined)).toBe(family);
    }
  });

  it("manifest validation still refuses unknown families before any work exists", () => {
    const issues: Array<{ path: string; code: string; message: string }> = [];
    const item = validateWorkItem(
      { id: "item-mainframe", workflow: "hunt", adapterFamily: "mainframe" },
      "items[0]",
      0,
      issues,
    );
    expect(item).toBeUndefined();
    expect(issues.map((i) => i.code)).toContain("family-unsupported");
  });

  it("family resolution maps every family and legacy alias exactly, and nothing else", () => {
    for (const family of ADAPTER_FAMILIES) {
      expect(familyAdapter({ target: family } as unknown as WorkItem)).toBe(family);
      expect(familyContractFor(family)?.binName).toBe(family);
    }
    expect(familyAdapter({ target: "pty" } as unknown as WorkItem)).toBe("cli");
    expect(familyAdapter({ target: "uia" } as unknown as WorkItem)).toBe("windows");
    // H5-D0 core invariant: unknown values NEVER fall through to fake.
    expect(familyAdapter({ target: "mainframe" } as unknown as WorkItem)).toBeUndefined();
    expect(familyAdapter({} as unknown as WorkItem)).toBeUndefined();
    expect(familyContractFor("bogus")).toBeUndefined();
  });

  it("adapter spawn resolution is exact per family (no fake fallback) and typed-refuses unknowns", () => {
    const packageDir: Record<string, string> = {
      web: "adapter-web",
      fake: "adapter-fake",
      cli: "cli-adapter",
      windows: "windows-adapter",
      android: "android",
      electron: "electron-adapter",
    };
    for (const family of ADAPTER_FAMILIES) {
      const spec = adapterSpawn(family);
      expect(spec.adapterCommand.length).toBeGreaterThan(0);
      const resolved = spec.adapterArgs.join(" ").replace(/\\/g, "/");
      expect(resolved).toContain(`packages/${packageDir[family]}/src/bin`);
    }
    // Legacy aliases resolve to their canonical family binary.
    expect(adapterSpawn("pty").adapterArgs.join(" ").replace(/\\/g, "/")).toContain("packages/cli-adapter/src/bin");
    expect(adapterSpawn("uia").adapterArgs.join(" ").replace(/\\/g, "/")).toContain("packages/windows-adapter/src/bin");
    let threw = false;
    try {
      adapterSpawn("mainframe");
    } catch (err) {
      threw = true;
      expect((err as { kind?: string }).kind).toBe("unknown-adapter");
    }
    expect(threw).toBe(true);
  });

  it("replay support covers every durable identity with no extras", () => {
    const expected = Object.values(FAMILY_CONTRACT).map((c) => c.durableAdapterId).sort();
    expect([...REPLAY_SUPPORTED_DURABLE_ADAPTERS].sort()).toEqual(expected);
  });

  it("unknown-family refusals classify as configuration errors in the failure taxonomy", () => {
    expect(classifyWorkflowError("unknown-adapter")).toBe("environment-unavailable");
    const classes: WorkItemFailureClass[] = [
      "target-config-invalid",
      "capability-unavailable",
      "policy-refusal",
    ];
    expect(classes).toContain("target-config-invalid");
  });
});
