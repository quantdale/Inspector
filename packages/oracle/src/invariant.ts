import type { ReplayResult } from "@inspector/finding";
import type { CandidateOracle, MetamorphicRelation, OracleKind } from "./types.js";

/**
 * Invariant oracle: fires when a predicate over the replay result holds
 * (e.g. "some observation contains an impossible value").
 */
export class InvariantOracle implements CandidateOracle {
  readonly id: string;
  readonly kind: OracleKind = "invariant";
  readonly strength: "hard" | "soft";
  readonly confidence: number;
  readonly description?: string;

  constructor(
    id: string,
    private readonly predicate: (result: ReplayResult) => boolean,
    opts: { strength?: "hard" | "soft"; confidence?: number; description?: string } = {},
  ) {
    this.id = id;
    this.strength = opts.strength ?? "hard";
    this.confidence = opts.confidence ?? 1;
    this.description = opts.description;
  }

  detect(result: ReplayResult): boolean {
    return this.predicate(result);
  }
}

/**
 * Persistence oracle: fires when storage/state captured in the replay result
 * violates an expected invariant (e.g. a preference key disappeared).
 */
export class PersistenceOracle extends InvariantOracle {
  constructor(
    id: string,
    predicate: (result: ReplayResult) => boolean,
    opts: { confidence?: number; description?: string } = {},
  ) {
    super(id, predicate, { strength: "hard", confidence: opts.confidence ?? 0.9, description: opts.description });
  }
}

/**
 * Metamorphic relation: `expected` must hold between baseline and variant.
 * A violation means the variant behaved differently in a way the relation
 * forbids (e.g. reloading must not change the counter value).
 */
export function metamorphicRelation(
  id: string,
  expected: (baseline: ReplayResult, variant: ReplayResult) => boolean,
  opts: { strength?: "hard" | "soft"; confidence?: number; description?: string } = {},
): MetamorphicRelation {
  return {
    id,
    kind: "metamorphic",
    strength: opts.strength ?? "hard",
    confidence: opts.confidence ?? 0.9,
    description: opts.description,
    violated: (baseline, variant) => !expected(baseline, variant),
  };
}
