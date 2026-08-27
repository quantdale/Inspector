import { describe, it, expect } from "vitest";
import {
  hashImage,
  perceptualHash,
  hammingDistance,
  visualDiff,
  isNearDuplicate,
  VisualOracle,
  DEFAULT_VISUAL_THRESHOLD,
} from "./visual-hash.js";
import { classifySuspicion } from "./suspicion.js";

/**
 * Helpers to build deterministic mocked screenshot buffers.
 * We treat Uint8Array as grayscale bytes; helpers create
 * uniform or perturbed buffers for hash-behavior validation.
 */
function uniformBuffer(value: number, length = 256): Uint8Array {
  return new Uint8Array(length).fill(value & 0xff);
}

function gradientBuffer(length = 256): Uint8Array {
  const buf = new Uint8Array(length);
  for (let i = 0; i < length; i++) buf[i] = i % 256;
  return buf;
}

describe("visual-hash — deterministic average hash", () => {
  it("identical images hash identically (determinism)", () => {
    const a = gradientBuffer(256);
    const b = new Uint8Array(a); // copy
    const ha = hashImage(a);
    const hb = hashImage(b);
    expect(ha).toBe(hb);
    expect(ha).toMatch(/^[0-9a-f]{16}$/);
    // perceptualHash alias must be deterministic and equal
    expect(perceptualHash(a)).toBe(ha);
    // calling twice on same instance yields same hash
    expect(hashImage(a)).toBe(ha);
    expect(hammingDistance(ha, hb)).toBe(0);
    expect(visualDiff(ha, hb, DEFAULT_VISUAL_THRESHOLD)).toBe(false);
    expect(isNearDuplicate(ha, hb, DEFAULT_VISUAL_THRESHOLD)).toBe(true);
  });

  it("one-pixel diff produces small hamming distance (not identical, not distant)", () => {
    // Use a buffer where average-hash bit pattern is sensitive:
    // Build a 64-length buffer with values around the mean so flipping
    // one pixel crosses the threshold. Use 256 length which downscales via
    // averaging, but a single extreme byte still perturbs its box.
    const base = uniformBuffer(100, 256);
    // To create a non-trivial hash (not all 0s/1s) we need variance:
    // Mix in a gradient prefix so average is mid-range.
    for (let i = 0; i < 32; i++) base[i] = i * 8;

    const mutated = new Uint8Array(base);
    // Flip one byte in a distinct box — choose index 128 which maps to its own bucket
    mutated[128] = 0xff;

    const ha = hashImage(base);
    const hb = hashImage(mutated);
    const dist = hammingDistance(ha, hb);

    // One-pixel diff should not produce identical hash, but distance should be small.
    expect(ha).not.toBe(hb);
    expect(dist).toBeGreaterThan(0);
    // With average hash a single pixel rarely flips many bits; bound small.
    // Allow up to 12 — average-hash property for tiny change.
    expect(dist).toBeLessThanOrEqual(12);
    // Hamming symmetry
    expect(hammingDistance(hb, ha)).toBe(dist);
  });

  it("distinct images produce larger distance", () => {
    // Half-black / half-white vs inverted — survives 256→64 box averaging (4 bytes per bucket).
    const halfSplitA = new Uint8Array(256);
    const halfSplitB = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      halfSplitA[i] = i < 128 ? 0 : 255;
      halfSplitB[i] = i < 128 ? 255 : 0;
    }
    const ha = hashImage(halfSplitA);
    const hb = hashImage(halfSplitB);
    const dist = hammingDistance(ha, hb);
    // Opposite halves should be far apart — substantially larger than one-pixel diff
    expect(dist).toBeGreaterThan(12);
    expect(visualDiff(ha, hb, DEFAULT_VISUAL_THRESHOLD)).toBe(true);
    expect(isNearDuplicate(ha, hb, DEFAULT_VISUAL_THRESHOLD)).toBe(false);
  });

  it("hammingDistance metric is correct (popcount, symmetry, triangle inequality spot-check)", () => {
    // Known values
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0000000000000000", "ffffffff00000000")).toBe(32);
    expect(hammingDistance("aaaaaaaaaaaaaaaa", "5555555555555555")).toBe(64);
    // Single hex digit difference: 0x0 (0000) vs 0x1 (0001) => 1 bit
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    // f (1111) vs 0 (0000) => 4 bits
    expect(hammingDistance("f000000000000000", "0000000000000000")).toBe(4);

    // Symmetry
    const a = hashImage(gradientBuffer(256));
    const b = hashImage(uniformBuffer(42, 256));
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));

    // visualDiff / isNearDuplicate are complementary for same threshold
    const threshold = 8;
    const d = hammingDistance(a, b);
    expect(visualDiff(a, b, threshold)).toBe(d > threshold);
    expect(isNearDuplicate(a, b, threshold)).toBe(d <= threshold);
    expect(visualDiff(a, b, threshold)).toBe(!isNearDuplicate(a, b, threshold));
  });

  it("handles empty and corrupt inputs deterministically (throws / skipped, never random)", () => {
    expect(() => hashImage(new Uint8Array(0))).toThrow();
    expect(() => hashImage(null as unknown as Uint8Array)).toThrow();
    expect(() => hammingDistance("zzzz", "0000")).toThrow();
    expect(() => hammingDistance("00", "0000")).toThrow();
    expect(() => hammingDistance("", "")).toThrow();

    // VisualOracle must never throw on bad input — returns skipped soft verdict
    const oracle = new VisualOracle();
    const skipped1 = oracle.evaluate(null, gradientBuffer(256));
    expect(skipped1.skipped).toBe(true);
    expect(skipped1.strength).toBe("soft");
    expect(skipped1.confidence).toBe(0);

    const skipped2 = oracle.evaluate(new Uint8Array(0), gradientBuffer(256));
    expect(skipped2.skipped).toBe(true);

    const skipped3 = oracle.evaluate("not-hex", "ffffffffffffffff");
    expect(skipped3.skipped).toBe(true);
  });

  it("visual oracle never confirms alone — needs hard oracle corroboration", () => {
    const oracle = new VisualOracle(DEFAULT_VISUAL_THRESHOLD);
    const baseline = gradientBuffer(256);
    const mutated = new Uint8Array(baseline);
    mutated[200] = 255;

    const verdict = oracle.evaluate(baseline, mutated);
    // Soft oracle invariant
    expect(verdict.strength).toBe("soft");
    expect(verdict.confidence).toBeLessThanOrEqual(0.5);
    expect(verdict.kind).toBe("visual-diff");
    expect(verdict.skipped).toBe(false);
    expect(verdict.hashA).toMatch(/^[0-9a-f]{16}$/);
    expect(verdict.hashB).toMatch(/^[0-9a-f]{16}$/);
    expect(verdict.distance).toBe(hammingDistance(verdict.hashA, verdict.hashB));
    expect(verdict.threshold).toBe(DEFAULT_VISUAL_THRESHOLD);
    expect(verdict.reason).toContain("distance");

    // Even when visual diff is detected, suspicion stays NEEDS_HUMAN_ORACLE without hard corroboration.
    const signal = {
      source: "vision" as const,
      confidence: verdict.confidence,
      summary: verdict.reason,
    };
    expect(classifySuspicion(signal, false)).toBe("NEEDS_HUMAN_ORACLE");
    // Only hard-oracle corroboration could promote to CANDIDATE.
    expect(classifySuspicion(signal, true)).toBe("CANDIDATE");

    // Identical images: distance 0, confidence 0, no diff.
    const identical = oracle.evaluate(baseline, new Uint8Array(baseline));
    expect(identical.distance).toBe(0);
    expect(identical.confidence).toBe(0);
    expect(identical.skipped).toBe(false);
    const identicalSignal = {
      source: "vision" as const,
      confidence: identical.confidence,
      summary: identical.reason,
    };
    expect(classifySuspicion(identicalSignal, false)).toBe("NEEDS_HUMAN_ORACLE");
  });

  it("threshold boundaries are advisory — large distance never auto-confirms", () => {
    const oracle = new VisualOracle(8);
    // Create maximally distant pair via the metric directly (not image-dependent):
    const farA = "0000000000000000";
    const farB = "ffffffffffffffff";
    const farDist = hammingDistance(farA, farB);
    expect(farDist).toBe(64);
    expect(visualDiff(farA, farB, 8)).toBe(true);
    expect(isNearDuplicate(farA, farB, 8)).toBe(false);

    // Even this maximal distance via oracle must stay soft/capped
    // Uniform images are degenerate (mean equals pixels ⇒ hash 0), so synthesize
    // verified far hashes via direct oracle on hex strings
    const farVerdict = oracle.evaluate(farA, farB);
    expect(farVerdict.strength).toBe("soft");
    expect(farVerdict.confidence).toBeLessThanOrEqual(0.5);
    expect(classifySuspicion({ source: "vision", confidence: farVerdict.confidence, summary: farVerdict.reason }, false)).toBe(
      "NEEDS_HUMAN_ORACLE",
    );

    // Boundary: distance == threshold => not diff, is near-duplicate
    const a = "0000000000000000";
    // Need hash with distance exactly 8 from a => set 8 bits (two hex Fs = 8 bits)
    const bAtThreshold = "ff00000000000000"; // 8 bits
    expect(hammingDistance(a, bAtThreshold)).toBe(8);
    expect(visualDiff(a, bAtThreshold, 8)).toBe(false);
    expect(isNearDuplicate(a, bAtThreshold, 8)).toBe(true);
    expect(visualDiff(a, bAtThreshold, 7)).toBe(true);
  });
});
