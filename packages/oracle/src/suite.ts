import type {
  CandidateOracle,
  MetamorphicRelation,
  OracleDescriptor,
  OracleVerdict,
  ReplayResult,
} from "./types.js";

/**
 * Composable oracle suite (M4 O0). Aggregates single-result oracles and
 * metamorphic relations into weighted verdicts. Every verdict names the
 * oracles that matched so downstream decisions are auditable.
 */
export class OracleSuite {
  private readonly oracles: CandidateOracle[] = [];
  private readonly relations: MetamorphicRelation[] = [];

  register(oracle: CandidateOracle): this {
    this.oracles.push(oracle);
    return this;
  }

  addRelation(relation: MetamorphicRelation): this {
    this.relations.push(relation);
    return this;
  }

  get descriptors(): OracleDescriptor[] {
    return [...this.oracles, ...this.relations].map((o) => ({
      id: o.id,
      kind: o.kind,
      strength: o.strength,
      confidence: o.confidence,
      description: o.description,
    }));
  }

  /** Evaluate all single-result oracles against one replay result. */
  evaluate(result: ReplayResult): OracleVerdict {
    const matched: Array<CandidateOracle | MetamorphicRelation> = this.oracles.filter((o) =>
      o.detect(result),
    );
    return toVerdict(matched);
  }

  /**
   * Strict evaluation: only HARD oracles may authorize reproduction. Soft
   * matches are excluded entirely so repair gates can never be flipped by
   * weak signals.
   */
  evaluateStrict(result: ReplayResult): OracleVerdict {
    return toVerdict(this.oracles.filter((o) => o.strength === "hard" && o.detect(result)));
  }

  /**
   * Evaluate single-result oracles against the variant run plus metamorphic
   * relations between baseline and variant. A relation violation counts as a
   * match of that relation's descriptor.
   */
  evaluatePair(baseline: ReplayResult, variant: ReplayResult): OracleVerdict {
    const matched: Array<CandidateOracle | MetamorphicRelation> = this.oracles.filter((o) =>
      o.detect(variant),
    );
    for (const r of this.relations) {
      if (r.violated(baseline, variant)) matched.push(r);
    }
    return toVerdict(matched);
  }

  /**
   * Strict pair evaluation: only hard oracles and hard relations count.
   * Soft-only violations yield weakSuspicion without reproduction.
   */
  evaluatePairStrict(baseline: ReplayResult, variant: ReplayResult): OracleVerdict {
    const matched: Array<CandidateOracle | MetamorphicRelation> = this.oracles.filter(
      (o) => o.strength === "hard" && o.detect(variant),
    );
    for (const r of this.relations) {
      if (r.strength === "hard" && r.violated(baseline, variant)) matched.push(r);
    }
    return toVerdict(matched);
  }
}

function toVerdict(matched: Array<CandidateOracle | MetamorphicRelation>): OracleVerdict {
  if (matched.length === 0) {
    return { reproduced: false, confidence: 0, matched: [], weakSuspicion: false };
  }
  // Strength contract (docs/ORACLE-SYSTEM.md): soft oracles only ever enrich
  // candidates. A verdict with no hard match is weak suspicion, not proof,
  // because repair gates consume `.reproduced`.
  const hardMatched = matched.some((m) => m.strength === "hard");
  const confidence = Math.max(...matched.map((m) => m.confidence));
  return {
    reproduced: hardMatched,
    confidence,
    weakSuspicion: !hardMatched,
    matched: matched.map((m) => ({
      id: m.id,
      kind: m.kind,
      strength: m.strength,
      confidence: m.confidence,
      description: m.description,
    })),
  };
}
