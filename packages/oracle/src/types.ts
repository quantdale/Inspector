import type { ReplayResult, OracleSignal } from "@inspector/finding";

/**
 * Oracle strength. Hard oracles are deterministic and may authorize
 * destructive follow-up work (e.g. source repair). Soft oracles only ever
 * enrich candidates.
 */
export type OracleStrength = "hard" | "soft";

export type OracleKind =
  | "invariant"
  | "metamorphic"
  | "structural"
  | "persistence"
  | "semantic-suspicion";

/** Metadata every oracle carries so verdicts are auditable. */
export interface OracleDescriptor {
  id: string;
  kind: OracleKind;
  strength: OracleStrength;
  /** 0..1 — how much a match from this oracle is trusted. */
  confidence: number;
  description?: string;
}

/** Result of evaluating a suite of oracles against evidence. */
export interface OracleVerdict {
  reproduced: boolean;
  /** Max confidence among matched oracles (0 when nothing matched). */
  confidence: number;
  matched: OracleDescriptor[];
  /**
   * True when only soft-strength oracles matched: the evidence is weak
   * suspicion, never proof, and must not authorize repair on its own.
   */
  weakSuspicion?: boolean;
}

/**
 * A single-result oracle: fires on the outcome/signals of one replay.
 * Invariant, structural, and persistence checks fit this shape.
 */
export interface CandidateOracle extends OracleDescriptor {
  detect(result: ReplayResult): boolean;
}

/**
 * A metamorphic oracle: fires when a relation that must hold between a
 * baseline run and a variant run is violated.
 */
export interface MetamorphicRelation extends OracleDescriptor {
  violated(baseline: ReplayResult, variant: ReplayResult): boolean;
}

export type { ReplayResult, OracleSignal };
