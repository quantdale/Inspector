import { PROTOCOL_VERSION, type ProtocolVersion } from "./version.js";
import { isId } from "./ids.js";

/**
 * Effective risk class of an action kind. `external-side-effect` marks kinds
 * that reach OUTSIDE the test environment (accounts, payments, comms,
 * installs, destructive device/process operations); they require an explicit
 * policy opt-in before any autonomous exploration may select them.
 */
export type ActionRiskClass =
  | "observe"
  | "interact"
  | "mutate-test-state"
  | "external-side-effect";

/** How selectors for a vocabulary kind address targets on this platform. */
export type TargetScheme =
  | "css"
  | "uia-runtime-id"
  | "android-resource-id"
  | "pty-input";

/** One semantic entry of an adapter's action vocabulary (SPEC-009 W0). */
export interface ActionKindSpec {
  /** Canonical kind id, e.g. click, tap, fill, press, back, swipe, toggle,
   * invoke, terminal-input, terminal-resize, lifecycle-restart. */
  kind: string;
  targetScheme?: TargetScheme;
  /** Adapter-declared default risk class for this kind. */
  risk: ActionRiskClass;
  /** false => the explorer must never auto-select this kind. */
  autonomousEligible: boolean;
  description?: string;
}

export interface Capabilities {
  observe: string[];
  act: string[];
  lifecycle: string[];
  faults?: string[];
  coverage?: string[];
  /** Semantic action vocabulary (SPEC-009). Optional for backward
   * compatibility; adapters without it behave exactly as before. */
  vocabulary?: ActionKindSpec[];
}

export interface CapabilityDoc {
  protocolVersion: ProtocolVersion;
  adapter: string;
  capabilities: Capabilities;
}

/** Capability groups whose values are plain string lists. */
type StringListGroup = "observe" | "act" | "lifecycle" | "faults" | "coverage";

export function isCapabilityGranted(
  doc: CapabilityDoc,
  group: StringListGroup,
  name: string,
): boolean {
  const list = doc.capabilities[group];
  return Array.isArray(list) && (list as string[]).includes(name);
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
    // Vocabulary is descriptive metadata about HOW granted kinds behave; it
    // passes through with the offer rather than being negotiated.
    ...(offered.capabilities.vocabulary
      ? { vocabulary: offered.capabilities.vocabulary }
      : {}),
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
