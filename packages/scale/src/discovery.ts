import { PROTOCOL_VERSION } from "@inspector/protocol";

export interface AdapterRegistration {
  id: string;
  version: string;
  protocolVersion: string;
  /** Conformance status from the shared runner (M6). */
  conformance: "pass" | "unverified" | "fail";
  factory?: () => unknown;
}

/**
 * Plugin/adapter registration and discovery (M7 S7). Adapters register with
 * version + conformance status; consumers discover by protocol compatibility.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AdapterRegistration>();

  register(reg: AdapterRegistration): this {
    this.adapters.set(reg.id, reg);
    return this;
  }

  get(id: string): AdapterRegistration | undefined {
    return this.adapters.get(id);
  }

  /** All adapters compatible with the current protocol version. */
  discover(): AdapterRegistration[] {
    return [...this.adapters.values()].filter(
      (a) => a.protocolVersion === PROTOCOL_VERSION,
    );
  }

  /** Incompatible registrations, for the compatibility matrix report. */
  incompatible(): Array<AdapterRegistration & { reason: string }> {
    return [...this.adapters.values()]
      .filter((a) => a.protocolVersion !== PROTOCOL_VERSION)
      .map((a) => ({ ...a, reason: `expects IAP ${a.protocolVersion}, runtime is ${PROTOCOL_VERSION}` }));
  }
}
