import { createHash } from "node:crypto";

/** Serializable continuation point for the Mulberry32 stream. */
export interface RngSnapshot {
  algorithm: "mulberry32";
  seed: number;
  state: number;
  draws: number;
}

/**
 * Deterministic PRNG (mulberry32) so exploration paths are reproducible from a
 * seed and can continue after a process restart without replaying old draws.
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(salt: number): Rng;
  snapshot(): RngSnapshot;
}

/** Raised by Rng.pick when the candidate list is empty. */
export class EmptyPickError extends Error {
  constructor() {
    super("Rng.pick called with an empty array");
    this.name = "EmptyPickError";
  }
}

export function mulberry32(
  seed: number,
  continuation?: Pick<RngSnapshot, "state" | "draws">,
): Rng {
  const initialSeed = seed >>> 0;
  let a = (continuation?.state ?? initialSeed) >>> 0;
  let draws = continuation?.draws ?? 0;
  if (!Number.isSafeInteger(draws) || draws < 0) {
    throw new Error(`invalid Mulberry32 draw count: ${draws}`);
  }
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    draws += 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => {
      if (items.length === 0) throw new EmptyPickError();
      return items[Math.floor(next() * items.length)]!;
    },
    fork: (salt) =>
      mulberry32((initialSeed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0),
    snapshot: () => ({
      algorithm: "mulberry32",
      seed: initialSeed,
      state: a >>> 0,
      draws,
    }),
  };
  return rng;
}

/** Restore a validated serialized RNG continuation point. */
export function restoreRng(snapshot: unknown): Rng {
  if (!isRecord(snapshot) || snapshot.algorithm !== "mulberry32") {
    throw new Error("unsupported or missing exploration RNG algorithm");
  }
  const seed = finiteUint32(snapshot.seed, "seed");
  const state = finiteUint32(snapshot.state, "state");
  if (!Number.isSafeInteger(snapshot.draws) || (snapshot.draws as number) < 0) {
    throw new Error("invalid exploration RNG draw count");
  }
  return mulberry32(seed, { state, draws: snapshot.draws as number });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteUint32(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) {
    throw new Error(`invalid exploration RNG ${name}`);
  }
  return value as number;
}

/** Small stable string hash (FNV-1a 32-bit) used for cheap dedup keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Strong deterministic hash (sha256, truncated hex) for identity and dedup
 * keys where 32-bit FNV-1a collisions are unacceptable. Fully deterministic:
 * no timestamps or randomness.
 */
export function strongHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}
