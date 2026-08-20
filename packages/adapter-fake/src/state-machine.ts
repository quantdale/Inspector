export type FakeState = "home" | "form" | "submitting" | "done" | "error";

export interface FakeTransitionResult {
  status: "success" | "target-failure";
  nextState: FakeState;
  oracleSignal?: string;
  summary: Record<string, unknown>;
}

export interface FakeActionInput {
  kind: string;
  input?: Record<string, unknown> | null;
}

const INVALID_TRANSITION: FakeTransitionResult = {
  status: "success",
  nextState: "home",
  summary: { ignored: true, reason: "invalid-transition" },
};

/**
 * Deterministic 5-state machine with 8 semantic actions and one deterministic
 * failure oracle (submitting the form with the value "BAD" always fails).
 */
export class FakeStateMachine {
  state: FakeState = "home";
  private fields: Record<string, string> = {};
  private flag = false;
  private artifactCount = 0;

  reset(): void {
    this.state = "home";
    this.fields = {};
    this.flag = false;
    this.artifactCount = 0;
  }

  get artifactTotal(): number {
    return this.artifactCount;
  }

  apply(action: FakeActionInput): FakeTransitionResult {
    switch (action.kind) {
      case "openForm":
        if (this.state !== "home") return INVALID_TRANSITION;
        this.state = "form";
        return this.ok();
      case "fillField":
        if (this.state !== "form") return INVALID_TRANSITION;
        this.fields[String(action.input?.name ?? "default")] = String(action.input?.value ?? "");
        return this.ok();
      case "submit": {
        if (this.state !== "form") return INVALID_TRANSITION;
        this.state = "submitting";
        const value = this.fields["default"] ?? "";
        if (value === "BAD") {
          this.state = "error";
          return {
            status: "target-failure",
            nextState: "error",
            oracleSignal: "DEFECT_SUBMIT_INVALID",
            summary: { value, reason: "deterministic oracle: invalid submit" },
          };
        }
        this.state = "done";
        return this.ok({ value });
      }
      case "retry":
        if (this.state !== "error") return INVALID_TRANSITION;
        this.state = "form";
        return this.ok();
      case "goHome":
        this.state = "home";
        return this.ok();
      case "toggleFlag":
        this.flag = !this.flag;
        return this.ok({ flag: this.flag });
      case "createArtifact":
        this.artifactCount += 1;
        return this.ok({ artifact: `stub-${this.artifactCount}` });
      case "reset":
        this.reset();
        return this.ok();
      default:
        return INVALID_TRANSITION;
    }
  }

  private ok(extra: Record<string, unknown> = {}): FakeTransitionResult {
    return {
      status: "success",
      nextState: this.state,
      summary: { ...this.snapshot(), ...extra },
    };
  }

  snapshot(): Record<string, unknown> {
    return { state: this.state, fields: { ...this.fields }, flag: this.flag };
  }
}
