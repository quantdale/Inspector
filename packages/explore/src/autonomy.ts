/**
 * SPEC-009 W2: external-side-effect risk classification.
 *
 * Two independent layers deny actions that could reach outside the test
 * environment (accounts, payments, communications, installs, destructive
 * operations):
 *
 *   1. Adapter-declared kind risk — a vocabulary entry whose `risk` is
 *      "external-side-effect" or whose `autonomousEligible` is false is never
 *      auto-selected.
 *   2. Contextual label promotion — candidates whose human-visible label
 *      matches a deny pattern are promoted to external-side-effect EVEN WHEN
 *      the adapter declared them interact. Labels alone never DOWNGRADE an
 *      action; they only make it stricter.
 *
 * The default policy denies external-side-effect actions; this module only
 * classifies. Enforcement lives in the exploration session (candidate
 * filtering) and the policy engine (marker rejection).
 */

export const EXTERNAL_SIDE_EFFECT_DENY_PATTERNS: readonly RegExp[] = [
  /\bsign[ -]?in\b/i,
  /\b(log[ -]?in|log[ -]?out|sign[ -]?out)\b/i,
  /\bpurchase\b/i,
  /\bcheckout\b/i,
  /\bpay\b/i,
  /\bsend\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\binstall\b/i,
  /\buninstall\b/i,
  /\bgrant\b/i,
  /\ballow\b/i,
  /\bsubscribe\b/i,
  /\bupgrade\b/i,
  /\breset password\b/i,
  /\berase\b/i,
  /\bwipe\b/i,
];

/** True when a candidate's visible label matches a deny pattern. */
export function labelDeniesAutonomy(label: string | undefined): boolean {
  if (!label) return false;
  return EXTERNAL_SIDE_EFFECT_DENY_PATTERNS.some((re) => re.test(label));
}

/** Vocabulary entry for a kind (undefined when the adapter declared none). */
export function vocabularyKindOf(
  caps: import("@inspector/protocol").CapabilityDoc | undefined,
  kind: string,
): import("@inspector/protocol").ActionKindSpec | undefined {
  return caps?.capabilities.vocabulary?.find((v) => v.kind === kind);
}

/**
 * Effective autonomy verdict for a candidate:
 *   - kind not in vocabulary            => decided by label only
 *   - autonomousEligible === false      => never autonomous
 *   - declared/label risk elevated      => external-side-effect
 */
export interface AutonomyVerdict {
  eligible: boolean;
  reason: "ok" | "kind-not-autonomous" | "external-side-effect";
}

export function classifyAutonomy(input: {
  caps?: import("@inspector/protocol").CapabilityDoc;
  kind: string;
  /** Human-visible label of the target control (name/text), if any. */
  label?: string;
}): AutonomyVerdict {
  const spec = vocabularyKindOf(input.caps, input.kind);
  if (spec && !spec.autonomousEligible) {
    return { eligible: false, reason: "kind-not-autonomous" };
  }
  const declaredRisk = spec?.risk ?? "interact";
  if (
    declaredRisk === "external-side-effect" ||
    labelDeniesAutonomy(input.label)
  ) {
    return { eligible: false, reason: "external-side-effect" };
  }
  return { eligible: true, reason: "ok" };
}
