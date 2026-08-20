import type { Oracle, OracleSignal, ReplayResult, OracleSignalKind } from "./types.js";

export class TargetFailureOracle implements Oracle {
  readonly id = "target-failure";
  detect(result: ReplayResult): boolean {
    return result.outcomes.some((o) => o.status === "target-failure");
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
  private readonly kind: OracleSignalKind;
  constructor(kind: OracleSignalKind) {
    this.kind = kind;
    this.id = `signal:${kind}`;
  }
  detect(result: ReplayResult): boolean {
    return result.signals.some((s) => s.kind === this.kind);
  }
}

export class OracleEngine {
  constructor(private readonly oracles: Oracle[]) {}

  static defaults(): OracleEngine {
    return new OracleEngine([
      new TargetFailureOracle(),
      new CrashOracle(),
      new ExplicitSignalOracle("DEFECT_SUBMIT_INVALID"),
      new ExplicitSignalOracle("IMPOSSIBLE_STATE"),
      new ExplicitSignalOracle("ADAPTER_CRASH"),
    ]);
  }

  evaluate(result: ReplayResult): { reproduced: boolean; signals: OracleSignal[] } {
    const matched = this.oracles.filter((o) => o.detect(result));
    return { reproduced: matched.length > 0, signals: result.signals };
  }

  get ids(): string[] {
    return this.oracles.map((o) => o.id);
  }
}
