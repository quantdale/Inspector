/**
 * SPEC-009 unit coverage: action vocabulary validation + negotiation
 * passthrough (A1) and external-side-effect classification layers (A2).
 */
import { describe, it, expect } from "vitest";
import {
  negotiateCapabilities,
  validateCapabilityDoc,
  type ActionKindSpec,
  type CapabilityDoc,
} from "@inspector/protocol";
import { classifyAutonomy, labelDeniesAutonomy } from "./autonomy.js";

const baseCaps: CapabilityDoc = {
  protocolVersion: "0.1",
  adapter: "test",
  capabilities: { observe: ["uiTree"], act: ["click"], lifecycle: ["reset"] },
};

describe("SPEC-009 A1: capability vocabulary", () => {
  const vocab: ActionKindSpec[] = [
    { kind: "click", targetScheme: "uia-runtime-id", risk: "interact", autonomousEligible: true },
    { kind: "lifecycle-restart", risk: "external-side-effect", autonomousEligible: false },
  ];

  it("validates a capability doc carrying a well-formed vocabulary", () => {
    const res = validateCapabilityDoc({
      ...baseCaps,
      capabilities: { ...baseCaps.capabilities, vocabulary: vocab },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a vocabulary entry with an unknown risk class", () => {
    const res = validateCapabilityDoc({
      ...baseCaps,
      capabilities: {
        ...baseCaps.capabilities,
        // Deliberate schema violation via untyped payload.
        vocabulary: [{ kind: "nuke", risk: "cosmic", autonomousEligible: true }] as unknown as ActionKindSpec[],
      },
    });
    expect(res.ok).toBe(false);
  });

  it("still validates docs WITHOUT vocabulary (backward compat)", () => {
    expect(validateCapabilityDoc(baseCaps).ok).toBe(true);
  });

  it("negotiation passes the declared vocabulary through unchanged", () => {
    const granted = negotiateCapabilities(
      { ...baseCaps, capabilities: { ...baseCaps.capabilities, vocabulary: vocab } },
      { requested: { act: ["click"] } },
    );
    expect(granted.capabilities.vocabulary).toEqual(vocab);
  });
});

describe("SPEC-009 A2: external-side-effect classification", () => {
  it("flags side-effectful labels regardless of adapter declaration", () => {
    for (const label of ["Sign in", "Purchase", "Delete item", "Install update", "Grant access"]) {
      expect(labelDeniesAutonomy(label)).toBe(true);
    }
    expect(labelDeniesAutonomy("Add row")).toBe(false);
  });

  function capsWith(vocabEntry: ActionKindSpec): CapabilityDoc {
    return {
      ...baseCaps,
      capabilities: { ...baseCaps.capabilities, vocabulary: [vocabEntry] },
    };
  }

  it("kind-not-autonomous wins even when the label looks harmless", () => {
    const verdict = classifyAutonomy({
      caps: capsWith({ kind: "click", risk: "interact", autonomousEligible: false }),
      kind: "click",
      label: "Add row",
    });
    expect(verdict).toEqual({ eligible: false, reason: "kind-not-autonomous" });
  });

  it("external-side-effect declared risk denies even benign labels", () => {
    const verdict = classifyAutonomy({
      caps: capsWith({ kind: "click", risk: "external-side-effect", autonomousEligible: true }),
      kind: "click",
      label: "Add row",
    });
    expect(verdict).toEqual({ eligible: false, reason: "external-side-effect" });
  });

  it("plain interact kinds with clean labels stay eligible", () => {
    const verdict = classifyAutonomy({
      caps: capsWith({ kind: "click", risk: "interact", autonomousEligible: true }),
      kind: "click",
      label: "Add row",
    });
    expect(verdict.eligible).toBe(true);
  });

  it("absent vocabulary falls back to label-only classification", () => {
    expect(classifyAutonomy({ caps: baseCaps, kind: "click", label: "ok" }).eligible).toBe(true);
    expect(classifyAutonomy({ caps: baseCaps, kind: "click", label: "Send report" }).eligible).toBe(false);
  });
});
