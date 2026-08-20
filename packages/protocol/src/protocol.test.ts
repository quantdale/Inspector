import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  validateAction,
  validateObservation,
  validateCapabilityDoc,
  validateEnvelope,
  validateAdapterEvent,
  makeEnvelope,
  newId,
} from "./index.js";

describe("protocol version", () => {
  it("pins version 0.1", () => {
    expect(PROTOCOL_VERSION).toBe("0.1");
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
