export type IapErrorCode =
  | "PROTOCOL_VERSION"
  | "INVALID_ENVELOPE"
  | "INVALID_MESSAGE"
  | "UNKNOWN_METHOD"
  | "CAPABILITY_DENIED"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED"
  | "ADAPTER_CRASH"
  | "TARGET_FAILURE"
  | "VALIDATION"
  | "UNKNOWN";

export interface IapError {
  code: IapErrorCode;
  message: string;
  detail?: unknown;
}

export class ProtocolError extends Error {
  readonly code: IapErrorCode;
  readonly detail?: unknown;
  constructor(error: IapError) {
    super(`[${error.code}] ${error.message}`);
    this.name = "ProtocolError";
    this.code = error.code;
    this.detail = error.detail;
  }
  toIapError(): IapError {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

export function protocolError(code: IapErrorCode, message: string, detail?: unknown): ProtocolError {
  return new ProtocolError({ code, message, detail });
}
