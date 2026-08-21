import type { CapabilityDoc } from "@inspector/protocol";

export interface FaultPolicy {
  enableFaultInjection: boolean;
  /** Whether the target environment is disposable (resettable, isolated). */
  disposable: boolean;
}

/**
 * Guards fault injection (M3 E4). Faults may only run when explicitly enabled,
 * the environment is disposable, AND the adapter advertises a `faults`
 * capability. Without all three, no fault actions are ever generated.
 */
export class FaultController {
  constructor(
    private readonly caps: CapabilityDoc,
    private readonly policy: FaultPolicy,
  ) {}

  get allowed(): boolean {
    return (
      this.policy.enableFaultInjection &&
      this.policy.disposable &&
      (this.caps.capabilities.faults?.length ?? 0) > 0
    );
  }

  permittedFaults(): string[] {
    if (!this.allowed) return [];
    return this.caps.capabilities.faults ?? [];
  }
}
