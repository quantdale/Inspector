/**
 * Stable workflow-level error. Interactive CLI surfaces map this onto the
 * operator-facing CliError with an identical kind/message; fleet executors
 * classify it into WorkItemFailureClass instead.
 */
export class WorkflowError extends Error {
  /** Stable machine-readable kind, identical to the CLI error taxonomy. */
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "WorkflowError";
    this.kind = kind;
  }
}
