/**
 * M20 Visual Oracle — deterministic perceptual hash (average hash).
 * Pure TypeScript, no native deps, no network, no vision model.
 *
 * Algorithm:
 *  - Downscale arbitrary Uint8Array (mocked grayscale / raw bytes) to 8x8
 *    via fixed-grid box averaging (deterministic, bounded CPU/memory).
 *  - Compute mean of the 64 pixels.
 *  - Set bit=1 where pixel > mean, else 0 → 64-bit hash → 16-char hex.
 *  - Hamming distance = popcount(a xor b) over hex nibbles.
 *  - visualDiff / isNearDuplicate are threshold wrappers.
 *  - VisualOracle is a soft-only oracle (strength soft, confidence ≤0.5)
 *    that never confirms alone — caller must corroborate via hard oracle
 *    and classifySuspicion (see suspicion.ts).
 */

const HASH_GRID = 8;
const HASH_BITS = HASH_GRID * HASH_GRID; // 64
const HEX_CHARS = HASH_BITS / 4; // 16

/** Default perceptual threshold: ≤8 near-duplicate, >12 distinct. */
export const DEFAULT_VISUAL_THRESHOLD = 8;

/** Alias per SPEC-020 naming. */
export const DEFAULT_THRESHOLD = DEFAULT_VISUAL_THRESHOLD;

// 4-bit popcount table (0..15) — avoids branching and is fully deterministic.
const POPCOUNT4: readonly number[] = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Downscale arbitrary byte buffer to 8×8 grayscale averages.
 * Deterministic, O(n) bounded by input length, no floating-point tolerancing
 * beyond integer division. For len ≥64 we box-average; for len <64 we
 * nearest-neighbor upsample.
 */
function downscaleTo64(data: Uint8Array): number[] {
  const out = new Array<number>(HASH_BITS).fill(0);
  const len = data.length;

  if (len >= HASH_BITS) {
    for (let i = 0; i < HASH_BITS; i++) {
      const start = Math.floor((i * len) / HASH_BITS);
      const end = Math.floor(((i + 1) * len) / HASH_BITS);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += data[j]!;
      }
      const count = end - start;
      // count is always ≥1 when len ≥64 because window ≥1, but guard anyway.
      out[i] = count > 0 ? sum / count : (data[start] ?? 0);
    }
  } else {
    // Upsample: each output pixel maps to nearest input byte.
    for (let i = 0; i < HASH_BITS; i++) {
      const src = Math.floor((i * len) / HASH_BITS);
      out[i] = data[src]!;
    }
  }
  return out;
}

/**
 * Deterministic average hash over 8×8 grayscale of screenshot buffer.
 * Mocked as Uint8Array — in production this would be raw RGBA / PNG bytes
 * decoded to grayscale; the mocked path treats bytes as grayscale directly,
 * which is sufficient for unit-deterministic oracle tests.
 * @param data - non-empty Uint8Array of image bytes (grayscale or raw)
 * @returns 16-char lowercase hex string (64-bit hash, zero-padded)
 */
export function hashImage(data: Uint8Array): string {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("hashImage expects a Uint8Array");
  }
  if (data.length === 0) {
    throw new Error("hashImage: empty image buffer");
  }

  const pixels = downscaleTo64(data);
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) sum += pixels[i]!;
  const avg = sum / pixels.length;

  // Pack 64 bits MSB-first: pixel 0 = most significant bit.
  let hex = "";
  for (let nibble = 0; nibble < HEX_CHARS; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      const idx = nibble * 4 + bit;
      const bitVal = pixels[idx]! > avg ? 1 : 0;
      value = (value << 1) | bitVal;
    }
    hex += value.toString(16);
  }
  // Deterministic lowercase, zero-padded (should already be 16 chars).
  return hex.toLowerCase().padStart(HEX_CHARS, "0");
}

/** SPEC-020 alias: perceptualHash is hashImage. */
export const perceptualHash = hashImage;

/**
 * Hamming distance between two equal-length hex hashes.
 * Counts differing bits (popcount of xor). Deterministic integer 0..64.
 */
export function hammingDistance(a: string, b: string): number {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new TypeError("hammingDistance expects two hex strings");
  }
  if (a.length !== b.length) {
    throw new Error(`hammingDistance: mismatched hash lengths ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) {
    throw new Error("hammingDistance: empty hash");
  }
  // Validate hex — keep deterministic error path.
  const hexRe = /^[0-9a-fA-F]+$/;
  if (!hexRe.test(a) || !hexRe.test(b)) {
    throw new Error("hammingDistance: hashes must be hex strings");
  }

  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  let dist = 0;
  for (let i = 0; i < al.length; i++) {
    const av = parseInt(al[i]!, 16);
    const bv = parseInt(bl[i]!, 16);
    const xor = av ^ bv;
    dist += POPCOUNT4[xor]!;
  }
  return dist;
}

/**
 * True when hashes are visually different: distance strictly greater than threshold.
 * @param threshold - inclusive tolerance; distance > threshold => different
 */
export function visualDiff(a: string, b: string, threshold: number): boolean {
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    throw new TypeError("visualDiff: threshold must be a finite number");
  }
  const distance = hammingDistance(a, b);
  // Advisory threshold — caller decides sensitivity; oracle never confirms anyway.
  const isDifferent = distance > threshold;
  return isDifferent;
}

/**
 * True when hashes are near-duplicates: distance ≤ threshold.
 * SPEC-020 exported helper alias.
 */
export function isNearDuplicate(a: string, b: string, threshold: number): boolean {
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    throw new TypeError("isNearDuplicate: threshold must be a finite number");
  }
  const distance = hammingDistance(a, b);
  const near = distance <= threshold;
  return near;
}

// ---------------------------------------------------------------------------
// Soft visual oracle — never confirms alone
// ---------------------------------------------------------------------------

export interface VisualOracleVerdict {
  /** Always soft per weak-oracle invariant. */
  strength: "soft";
  kind: "visual-diff";
  /** Capped ≤0.5 even when distance is large. */
  confidence: number;
  distance: number;
  threshold: number;
  hashA: string;
  hashB: string;
  reason: string;
  /** True when inputs missing/invalid; verdict is not a detection. */
  skipped: boolean;
}

function cappedConfidence(distance: number): number {
  if (distance === 0) return 0;
  // Linear map 1..64 → ~0.05..0.5, capped. Deterministic, no randomness.
  const raw = 0.05 + (distance / HASH_BITS) * 0.45;
  return Math.min(0.5, Number(raw.toFixed(4)));
}

/**
 * Minimal deterministic VisualOracle.
 * - Accepts baseline/current as Uint8Array or precomputed hex hash.
 * - Returns soft verdict with provenance (hashA/hashB/distance/threshold).
 * - Never returns hard/confirmed; confidence ≤0.5.
 * - Missing baseline or empty input ⇒ skipped verdict (never a false confirm).
 */
export class VisualOracle {
  readonly threshold: number;

  constructor(threshold: number = DEFAULT_VISUAL_THRESHOLD) {
    this.threshold = threshold;
  }

  evaluate(
    baseline: Uint8Array | string | null | undefined,
    current: Uint8Array | string | null | undefined,
    thresholdOverride?: number,
  ): VisualOracleVerdict {
    const threshold = thresholdOverride ?? this.threshold;

    // Missing baseline/current → skipped, not a detection.
    if (baseline == null || current == null) {
      return {
        strength: "soft",
        kind: "visual-diff",
        confidence: 0,
        distance: 0,
        threshold,
        hashA: "",
        hashB: "",
        reason: "visual oracle skipped: missing baseline or current image",
        skipped: true,
      };
    }

    let hashA: string;
    let hashB: string;

    try {
      hashA = typeof baseline === "string" ? baseline.toLowerCase() : hashImage(baseline);
      hashB = typeof current === "string" ? current.toLowerCase() : hashImage(current);
    } catch {
      return {
        strength: "soft",
        kind: "visual-diff",
        confidence: 0,
        distance: 0,
        threshold,
        hashA: "",
        hashB: "",
        reason: "visual oracle skipped: corrupt or empty image",
        skipped: true,
      };
    }

    // Validate hex length sanity when strings were supplied directly.
    if (hashA.length !== HEX_CHARS || hashB.length !== HEX_CHARS) {
      return {
        strength: "soft",
        kind: "visual-diff",
        confidence: 0,
        distance: 0,
        threshold,
        hashA,
        hashB,
        reason: "visual oracle skipped: invalid hash format",
        skipped: true,
      };
    }

    const distance = hammingDistance(hashA, hashB);
    const confidence = cappedConfidence(distance);
    const isDiff = distance > threshold;

    return {
      strength: "soft",
      kind: "visual-diff",
      confidence,
      distance,
      threshold,
      hashA,
      hashB,
      reason: isDiff
        ? `visual diff detected: distance ${distance} > threshold ${threshold} (hashA=${hashA} hashB=${hashB})`
        : `visual diff not detected: distance ${distance} ≤ threshold ${threshold} (hashA=${hashA} hashB=${hashB})`,
      skipped: false,
    };
  }
}
