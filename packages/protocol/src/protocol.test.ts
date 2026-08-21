import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  validateAction,
  validateObservation,
  validateObserveRequest,
  validateCapabilityDoc,
  validateEnvelope,
  validateAdapterEvent,
  makeEnvelope,
  newId,
  negotiateCapabilities,
  isCapabilityGranted,
  assertAdapterId,
  type CapabilityDoc,
} from "./index.js";

describe("protocol version", () => {
  it("pins version 0.1", () => {
    expect(PROTOCOL_VERSION).toBe("0.1");
  });
});

describe("id kinds", () => {
  it("emits prefixed ids for every documented kind alias", () => {
    expect(newId("run")).toMatch(/^run_/);
    expect(newId("env")).toMatch(/^env_/);
    expect(newId("step")).toMatch(/^step_/);
    expect(newId("action")).toMatch(/^act_/);
    expect(newId("act")).toMatch(/^act_/);
    expect(newId("obs")).toMatch(/^obs_/);
    expect(newId("artifact")).toMatch(/^art_/);
    expect(newId("finding")).toMatch(/^find_/);
    expect(newId("find")).toMatch(/^find_/);
    expect(newId("checkpoint")).toMatch(/^ckpt_/);
    expect(newId("ckpt")).toMatch(/^ckpt_/);
  });

  it("never emits an undefined prefix (regression: act/find/ckpt aliases)", () => {
    for (const kind of ["act", "find", "ckpt"] as const) {
      const id = newId(kind);
      expect(id.startsWith("undefined_")).toBe(false);
      expect(id.startsWith(`${kind}_`)).toBe(true);
    }
  });

  it("throws a typed error on an unknown kind instead of a malformed id", () => {
    expect(() => newId("bogus" as never)).toThrow(/unknown id kind/);
  });
});

describe("action schema", () => {
  const valid = () => ({
    id: newId("action"),
    runId: newId("run"),
    environmentId: newId("env"),
    kind: "click",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
  });

  it("accepts a well-formed action", () => {
    expect(validateAction(valid()).ok).toBe(true);
  });

  it("rejects a malformed id", () => {
    const r = validateAction({ ...valid(), id: "  bad id " });
    expect(r.ok).toBe(false);
  });

  it("rejects a missing deadline", () => {
    const a = valid() as Record<string, unknown>;
    delete a.deadlineMs;
    const r = validateAction(a);
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid risk class", () => {
    const r = validateAction({ ...valid(), risk: "forbidden" });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid idempotency policy", () => {
    const r = validateAction({ ...valid(), idempotency: "maybe" });
    expect(r.ok).toBe(false);
  });
});

describe("observation schema", () => {
  const valid = () => ({
    id: newId("obs"),
    runId: newId("run"),
    environmentId: newId("env"),
    sequence: 0,
    source: "adapter-fake",
    capturedAt: new Date().toISOString(),
    summary: { state: "s1" },
  });

  it("accepts a well-formed observation", () => {
    expect(validateObservation(valid()).ok).toBe(true);
  });

  it("rejects a negative sequence", () => {
    expect(validateObservation({ ...valid(), sequence: -1 }).ok).toBe(false);
  });

  it("rejects a malformed artifact sha256", () => {
    const r = validateObservation({
      ...valid(),
      artifacts: [{ sha256: "zzz", mime: "text/plain", size: 1, path: "a" }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("capability negotiation schema", () => {
  const valid = (): Record<string, unknown> => ({
    protocolVersion: PROTOCOL_VERSION,
    adapter: "adapter-fake",
    capabilities: { observe: ["uiTree"], act: ["click"], lifecycle: ["reset"] },
  });

  it("accepts a well-formed capability document", () => {
    expect(validateCapabilityDoc(valid()).ok).toBe(true);
  });

  it("rejects an out-of-version capability document", () => {
    const r = validateCapabilityDoc({ ...valid(), protocolVersion: "0.0" });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid (empty) capability name", () => {
    const r = validateCapabilityDoc({
      ...valid(),
      capabilities: { observe: [""], act: ["click"], lifecycle: ["reset"] },
    });
    expect(r.ok).toBe(false);
  });
});

describe("envelope schema", () => {
  it("accepts a well-formed envelope", () => {
    const env = makeEnvelope({ id: newId(), direction: "request", method: "act", payload: { x: 1 } });
    expect(validateEnvelope(env).ok).toBe(true);
  });

  it("rejects an out-of-version envelope", () => {
    const env = makeEnvelope({ id: newId(), direction: "request", payload: {} }) as unknown as Record<
      string,
      unknown
    >;
    env.protocolVersion = "9.9";
    expect(validateEnvelope(env).ok).toBe(false);
  });

  it("rejects a malformed message id", () => {
    const env = makeEnvelope({ id: "##bad##", direction: "event", payload: {} });
    expect(validateEnvelope(env).ok).toBe(false);
  });
});

describe("adapter event schema", () => {
  it("accepts a well-formed ordered event", () => {
    const ev = {
      sequence: 3,
      runId: newId("run"),
      environmentId: newId("env"),
      type: "observation",
      timestamp: new Date().toISOString(),
      payload: { summary: {} },
    };
    expect(validateAdapterEvent(ev).ok).toBe(true);
  });

  it("rejects a non-monotonic (negative) sequence", () => {
    const ev = {
      sequence: -2,
      runId: newId("run"),
      environmentId: newId("env"),
      type: "health",
      timestamp: new Date().toISOString(),
      payload: {},
    };
    expect(validateAdapterEvent(ev).ok).toBe(false);
  });
});

describe("observe request schema", () => {
  it("accepts a well-formed observe request with options", () => {
    expect(validateObserveRequest({ observe: ["uiTree"], options: { full: true } }).ok).toBe(true);
  });

  it("rejects a missing observe list", () => {
    expect(validateObserveRequest({}).ok).toBe(false);
  });

  it("rejects a non-array observe field", () => {
    expect(validateObserveRequest({ observe: "uiTree" }).ok).toBe(false);
  });

  it("rejects non-string and empty-string entries", () => {
    expect(validateObserveRequest({ observe: [42] }).ok).toBe(false);
    expect(validateObserveRequest({ observe: [""] }).ok).toBe(false);
  });
});

describe("capability negotiation", () => {
  const offered = (): CapabilityDoc => ({
    protocolVersion: PROTOCOL_VERSION,
    adapter: "adapter-fake",
    capabilities: {
      observe: ["uiTree", "state"],
      act: ["click", "fill"],
      lifecycle: ["reset"],
      faults: ["timeout"],
    },
  });

  it("returns the offered doc unchanged when nothing is requested", () => {
    expect(negotiateCapabilities(offered())).toEqual(offered());
  });

  it("returns the offered doc unchanged for an empty negotiation request", () => {
    expect(negotiateCapabilities(offered(), {})).toEqual(offered());
  });

  it("intersects requested capabilities with the offered set", () => {
    const granted = negotiateCapabilities(offered(), {
      adapter: "adapter-fake",
      requested: { act: ["click"], observe: ["state"] },
    });
    expect(granted.capabilities.act).toEqual(["click"]);
    expect(granted.capabilities.observe).toEqual(["state"]);
    // Unrequested groups pass through from the offer untouched.
    expect(granted.capabilities.lifecycle).toEqual(["reset"]);
  });

  it("drops requested capabilities the adapter does not offer", () => {
    const granted = negotiateCapabilities(offered(), {
      requested: { act: ["click", "format-disk"], faults: ["timeout", "corrupt"] },
    });
    expect(granted.capabilities.act).toEqual(["click"]);
    expect(granted.capabilities.faults).toEqual(["timeout"]);
  });

  it("pins protocol version and adapter id on the granted document", () => {
    const granted = negotiateCapabilities(offered(), { requested: { act: ["fill"] } });
    expect(granted.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(granted.adapter).toBe("adapter-fake");
  });

  it("handles an offered doc without optional fault/coverage lists", () => {
    const minimal: CapabilityDoc = {
      protocolVersion: PROTOCOL_VERSION,
      adapter: "adapter-x",
      capabilities: { observe: [], act: [], lifecycle: [] },
    };
    const granted = negotiateCapabilities(minimal, { requested: { faults: ["timeout"] } });
    expect(granted.capabilities.faults).toEqual([]);
    expect(granted.capabilities.coverage).toEqual([]);
  });
});

describe("isCapabilityGranted", () => {
  const doc: CapabilityDoc = {
    protocolVersion: PROTOCOL_VERSION,
    adapter: "adapter-fake",
    capabilities: { observe: ["uiTree"], act: [], lifecycle: ["reset"] },
  };

  it("is true for a listed capability", () => {
    expect(isCapabilityGranted(doc, "observe", "uiTree")).toBe(true);
  });

  it("is false for an unlisted capability or empty group", () => {
    expect(isCapabilityGranted(doc, "observe", "screenshot")).toBe(false);
    expect(isCapabilityGranted(doc, "act", "click")).toBe(false);
  });

  it("is false for an absent optional group", () => {
    expect(isCapabilityGranted(doc, "faults", "timeout")).toBe(false);
  });
});

describe("assertAdapterId", () => {
  it("accepts well-formed adapter ids", () => {
    expect(() => assertAdapterId("adapter-fake")).not.toThrow();
    expect(() => assertAdapterId("A_1")).not.toThrow();
  });

  it("throws for non-strings", () => {
    expect(() => assertAdapterId(42)).toThrow(/invalid adapter id/);
    expect(() => assertAdapterId(undefined)).toThrow(/invalid adapter id/);
  });

  it("throws for malformed strings", () => {
    expect(() => assertAdapterId("")).toThrow(/invalid adapter id/);
    expect(() => assertAdapterId("has space")).toThrow(/invalid adapter id/);
    expect(() => assertAdapterId("-leading-dash")).toThrow(/invalid adapter id/);
    expect(() => assertAdapterId(`${"a".repeat(129)}`)).toThrow(/invalid adapter id/);
  });
});
