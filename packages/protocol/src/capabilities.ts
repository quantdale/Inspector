import { PROTOCOL_VERSION, type ProtocolVersion } from "./version.js";
import { isId } from "./ids.js";

export interface Capabilities {
  observe: string[];
  act: string[];
  lifecycle: string[];
  faults?: string[];
  coverage?: string[];
}

export interface CapabilityDoc {
  protocolVersion: ProtocolVersion;
  adapter: string;
  capabilities: Capabilities;
}

export function isCapabilityGranted(doc: CapabilityDoc, group: keyof Capabilities, name: string): boolean {
  const list = doc.capabilities[group];
  return Array.isArray(list) && list.includes(name);
}

export interface NegotiationRequest {
  adapter?: string;
  requested?: Partial<Capabilities>;
}

/**
 * Intersect a requested capability subset with what the adapter offered.
 * A requested capability that the adapter does not offer is dropped (not granted).
 */
export function negotiateCapabilities(offered: CapabilityDoc, requested?: NegotiationRequest): CapabilityDoc {
  if (!requested || !requested.requested) {
    return offered;
  }
  const granted: Capabilities = {
    observe: intersect(offered.capabilities.observe, requested.requested.observe),
    act: intersect(offered.capabilities.act, requested.requested.act),
    lifecycle: intersect(offered.capabilities.lifecycle, requested.requested.lifecycle),
    faults: intersect(offered.capabilities.faults ?? [], requested.requested.faults),
    coverage: intersect(offered.capabilities.coverage ?? [], requested.requested.coverage),
  };
  return { protocolVersion: PROTOCOL_VERSION, adapter: offered.adapter, capabilities: granted };
}

function intersect(offered: string[] | undefined, requested: string[] | undefined): string[] {
  if (!requested) return offered ?? [];
  const set = new Set(offered ?? []);
  return requested.filter((c) => set.has(c));
}

export function assertAdapterId(adapter: unknown): asserts adapter is string {
  if (typeof adapter !== "string" || !isId(adapter)) {
    throw new Error(`invalid adapter id: ${JSON.stringify(adapter)}`);
  }
}
