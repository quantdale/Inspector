/**
 * Typed error surface for ADB backend operations. Every failure carries a
 * stable machine-readable code so callers (adapter, oracle, campaign state)
 * can classify without string matching.
 */
export type AdbErrorCode =
  | "ADB_NOT_FOUND"
  | "ADB_TIMEOUT"
  | "ADB_COMMAND_FAILED"
  | "DEVICE_OFFLINE"
  | "DEVICE_NOT_ALIVE"
  | "DUMP_FAILED";

export class AdbError extends Error {
  constructor(
    public readonly code: AdbErrorCode,
    message: string,
    public readonly detail?: { serial?: string; command?: string; stderr?: string; timeoutMs?: number },
  ) {
    super(message);
    this.name = "AdbError";
  }
}

export function isAdbError(e: unknown): e is AdbError {
  return e instanceof AdbError;
}
