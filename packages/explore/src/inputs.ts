/**
 * Boundary / adversarial input generation (M3 E3).
 *
 * Candidate values are deterministic and replayable. The seeded web app hides
 * defects behind a long username (length >= 64) and the sentinel "CRASH", so
 * those are included. The list stays small to keep the action space tractable.
 */
export function boundaryValues(field: string): string[] {
 const base = ["", "admin", "A".repeat(80), "CRASH", "<b>x</b>", "12345"];
 // A couple of per-field extras to probe type/format handling.
 if (field.toLowerCase().includes("user")) {
  base.push("user@example.com");
 }
 return base;
}

/**
 * Stateful / adversarial sequences: repeat the same element interaction to
 * probe accumulation, lifecycle, and boundary behavior (e.g. clicking a counter
 * enough times to overflow).
 */
export const DEFAULT_SEQUENCE_LENGTHS = [2, 3, 5, 8, 12];

export function pickSequenceLengths(
 rngInt: (max: number) => number,
 lengths: number[],
): number {
 return lengths[rngInt(lengths.length)]!;
}
