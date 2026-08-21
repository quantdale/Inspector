import type { Oracle, OracleSignal, ReplayResult, OracleSignalKind, SignatureExtractor } from "./types.js";

/**
 * Outcome error codes that represent a genuine target crash. A plain
 * automation miss (e.g. ACTION_FAILED from a Playwright element lookup) is
 * NOT an application defect and must never constitute reproduction by
 * itself; genuine crashes surface as TARGET_FAILURE-class signals.
 */
const CRASH_CLASS_OUTCOME_CODES: ReadonlySet<string> = new Set(["TARGET_FAILURE"]);

export class TargetFailureOracle implements Oracle {
  readonly id = "target-failure";
  detect(result: ReplayResult): boolean {
    return result.outcomes.some(
      (o) =>
        o.status === "target-failure" &&
        CRASH_CLASS_OUTCOME_CODES.has(o.error?.code ?? ""),
    );
  }
}

export class CrashOracle implements Oracle {
  readonly id = "page-error";
  detect(result: ReplayResult): boolean {
    return result.signals.some((s) => s.kind === "PAGE_ERROR");
  }
}

export class ExplicitSignalOracle implements Oracle {
  readonly id: string;
  private readonly signalKind: OracleSignalKind;
  constructor(kind: OracleSignalKind) {
    this.signalKind = kind;
    this.id = `signal:${kind}`;
  }
  detect(result: ReplayResult): boolean {
    return result.signals.some((s) => s.kind === this.signalKind);
  }
}

/**
 * Default signature vocabulary: the sorted distinct oracle signal kinds of
 * the replay result (null when the run produced no signal).
 */
export const defaultSignatureExtractor: SignatureExtractor = (result) => {
  const kinds = [...new Set(result.signals.map((s) => s.kind))].sort();
  return kinds.length > 0 ? kinds.join("|") : null;
};

export interface OracleEngineOptions {
  signatureExtractor?: SignatureExtractor;
}

/** Per-oracle outcome of one evaluate() call, for evaluation provenance. */
export interface OracleEvaluationDetail {
  oracleId: string;
  reproduced: boolean;
  kind: string | null;
  strength: "hard" | "soft" | null;
  confidence: number | null;
  description: string | null;
}

export interface OracleEvaluation {
  reproduced: boolean;
  signals: OracleSignal[];
  /** Ids of the registered oracles that matched, for downstream evidence. */
  matchedOracleIds: string[];
  /**
   * One entry per registered oracle (matched or not), so persisted
   * evaluation records capture which oracles RAN, not only which fired.
   */
  evaluations: OracleEvaluationDetail[];
}

export class OracleEngine {
  private readonly oracles: Oracle[];
  private readonly signatureExtractor: SignatureExtractor;

  constructor(oracles: Oracle[], opts: OracleEngineOptions = {}) {
    this.oracles = oracles;
    this.signatureExtractor = opts.signatureExtractor ?? defaultSignatureExtractor;
  }

  static defaults(): OracleEngine {
    return new OracleEngine([
      new TargetFailureOracle(),
      new CrashOracle(),
      new ExplicitSignalOracle("DEFECT_SUBMIT_INVALID"),
      new ExplicitSignalOracle("IMPOSSIBLE_STATE"),
      new ExplicitSignalOracle("ADAPTER_CRASH"),
    ]);
  }

  evaluate(result: ReplayResult): OracleEvaluation {
    const matched = this.oracles.filter((o) => o.detect(result));
    return {
      reproduced: matched.length > 0,
      signals: result.signals,
      matchedOracleIds: matched.map((o) => o.id),
      evaluations: this.oracles.map((o) => ({
        oracleId: o.id,
        reproduced: matched.includes(o),
        kind: o.kind ?? null,
        strength: o.strength ?? null,
        confidence: typeof o.confidence === "number" ? o.confidence : null,
        description: o.description ?? null,
      })),
    };
  }

  /** The defect signature of a replay result under this engine's extractor. */
  signatureOf(result: ReplayResult): string | null {
    return this.signatureExtractor(result);
  }

  /**
   * Oracle ids that can fire on a replay exhibiting this signal alone.
   * Falls back to every registered oracle when none discriminates the signal
   * shape, so findings never lose oracle coverage silently.
   */
  relevantOracleIds(signal: OracleSignal): string[] {
    const probe: ReplayResult = { outcomes: [], signals: [signal], observations: [] };
    const relevant = this.oracles.filter((o) => o.detect(probe)).map((o) => o.id);
    return relevant.length > 0 ? relevant : this.ids;
  }

  get ids(): string[] {
    return this.oracles.map((o) => o.id);
  }
}
