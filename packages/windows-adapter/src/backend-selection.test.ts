import { describe, it, expect, vi } from "vitest";
import { selectWindowsBackend, WINDOWS_BACKEND_ENV } from "./selection.js";
import { MockUiaBackend } from "./mock-uia.js";
import { RealUiaBackend } from "./real-uia.js";

function fakeReal(): RealUiaBackend {
  // Identity-only stub for selection tests; the bridge is never invoked.
  return new RealUiaBackend(undefined as never);
}

describe("windows backend selection", () => {
  it("mock mode always selects the mock backend", async () => {
    const sel = await selectWindowsBackend(
      { [WINDOWS_BACKEND_ENV]: "mock" },
      { probe: async () => true },
    );
    expect(sel.kind).toBe("mock");
    expect(sel.backend).toBeInstanceOf(MockUiaBackend);
    expect(sel.warning).toBeUndefined();
  });

  it("real mode selects the real backend without probing", async () => {
    const probe = vi.fn(async () => {
      throw new Error("probe must not run in real mode");
    });
    const real = fakeReal();
    const sel = await selectWindowsBackend(
      { [WINDOWS_BACKEND_ENV]: "real" },
      { probe, makeReal: () => real },
    );
    expect(probe).not.toHaveBeenCalled();
    expect(sel.kind).toBe("real");
    expect(sel.backend).toBe(real);
  });

  it("auto mode selects real when the probe succeeds", async () => {
    const sel = await selectWindowsBackend({}, { probe: async () => true, makeReal: fakeReal });
    expect(sel.kind).toBe("real");
    expect(sel.warning).toBeUndefined();
  });

  it("auto mode degrades to mock with a warning when the probe fails", async () => {
    const log = vi.fn();
    const sel = await selectWindowsBackend({}, { probe: async () => false, log });
    expect(sel.kind).toBe("mock");
    expect(sel.backend).toBeInstanceOf(MockUiaBackend);
    expect(sel.warning).toContain(WINDOWS_BACKEND_ENV);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("an unknown mode is an error, never a silent fallback", async () => {
    await expect(
      selectWindowsBackend({ [WINDOWS_BACKEND_ENV]: "yes" }, { probe: async () => true }),
    ).rejects.toThrow(/invalid/);
  });

  it("the mock backend stays default-usable without any environment setup", async () => {
    const sel = await selectWindowsBackend({}, { probe: async () => false });
    await sel.backend.reset();
    const tree = await sel.backend.tree();
    expect(tree.length).toBeGreaterThan(0);
  });
});
