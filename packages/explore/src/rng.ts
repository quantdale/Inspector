/**
 * Deterministic PRNG (mulberry32) so exploration paths are reproducible from a seed.
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(salt: number): Rng;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    fork: (salt) => mulberry32((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0),
  };
  return rng;
}

/** Small stable string hash (FNV-1a 32-bit) used for dedup keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
