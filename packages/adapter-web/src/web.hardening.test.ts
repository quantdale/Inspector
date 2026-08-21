import { describe, it, expect } from "vitest";
import { WEB_CAPABILITIES, actionTimeout } from "./web-adapter.js";
import { startSeedServer } from "./seeded-app.js";

describe("web hardening: playwright timeout stays under the wire deadline (D3)", () => {
  it("keeps the normal headroom for generous deadlines", () => {
    expect(actionTimeout(10000)).toBe(8500);
    expect(actionTimeout(30000)).toBe(28500);
  });

  it("clamps to strictly below the deadline for short deadlines", () => {
    for (const deadline of [100, 250, 500, 1000, 1500, 2500]) {
      const t = actionTimeout(deadline);
      expect(t, `deadline ${deadline}`).toBeLessThan(deadline);
      expect(t, `deadline ${deadline}`).toBeGreaterThan(0);
    }
  });

  it("never returns zero or negative even for absurd deadlines", () => {
    expect(actionTimeout(50)).toBeGreaterThan(0);
    expect(actionTimeout(0)).toBeGreaterThan(0);
  });
});

describe("web hardening: advertised faults are implemented (D8)", () => {
  it("does not advertise a 'timeout' fault that act() cannot perform", () => {
    const faults = WEB_CAPABILITIES.capabilities.faults ?? [];
    expect(faults).not.toContain("timeout");
    expect(faults).toContain("crash");
  });
});

describe("web hardening: seed server binds loopback only (D8)", () => {
  it("listens on 127.0.0.1, not all interfaces", async () => {
    const seed = startSeedServer();
    await seed.ready;
    try {
      expect(seed.localAddress).toBe("127.0.0.1");
      const res = await fetch(seed.url);
      expect(res.ok).toBe(true);
    } finally {
      seed.close();
    }
  });
});
