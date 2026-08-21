import type { OracleKind } from "./types.js";

/**
 * Weak semantic suspicion (M4 O1). Vision/LLM/heuristic signals may create or
 * enrich candidate findings, but under default policy they can never
 * authorize destructive follow-up work (source repair) on their own.
 */
export type SuspicionSource = "llm" | "vision" | "heuristic";

export interface SuspicionSignal {
  source: SuspicionSource;
  /** 0..1 model/self-reported confidence. Never treated as proof. */
  confidence: number;
  summary: string;
}

export type SuspicionDisposition =
  | /** Corroborated by a hard oracle: full candidate. */ "CANDIDATE"
  | /** Suspicion only: requires a human oracle before repair. */ "NEEDS_HUMAN_ORACLE";

/**
 * Classify a suspicion signal. The rule is absolute: without corroboration
 * from at least one HARD oracle match, the finding is held at
 * NEEDS_HUMAN_ORACLE regardless of the signal's self-reported confidence.
 */
export function classifySuspicion(
  signal: SuspicionSignal,
  corroboratedByHardOracle: boolean,
): SuspicionDisposition {
  void signal;
  return corroboratedByHardOracle ? "CANDIDATE" : "NEEDS_HUMAN_ORACLE";
}

/** Descriptor metadata for a suspicion-derived oracle entry. */
export function suspicionDescriptor(id: string, signal: SuspicionSignal): {
  id: string;
  kind: OracleKind;
  strength: "soft";
  confidence: number;
  description: string;
} {
  return {
    id,
    kind: "semantic-suspicion",
    strength: "soft",
    // Soft cap: even a confident model claim is capped below hard-oracle trust.
    confidence: Math.min(signal.confidence, 0.5),
    description: `${signal.source} suspicion: ${signal.summary}`,
  };
}
