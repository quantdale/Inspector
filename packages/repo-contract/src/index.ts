/**
 * Repository-level contract guards (HARDENING_4).
 *
 * These validators are deliberately dependency-free and shape-conservative:
 * they parse only the block-style YAML and single-line `run:` steps this
 * repository actually authors, and fail loud on structural surprises instead
 * of silently passing. They exist to mechanically catch two defect classes
 * that already reached a completion commit:
 *
 * 1. workspace-executable resolution mistakes in CI (`pnpm exec <bin>` at
 *    the root for a binary owned only by a workspace package — pnpm's
 *    isolated layout does not hoist package-local bins to the root, so the
 *    step fails on any clean runner; hosted run 32840538303);
 * 2. duplicate mapping keys / duplicate list identities in durable campaign
 *    state, where loader semantics could silently erase history
 *    (campaign.yaml carried two `completed_task_groups:` keys).
 */

export interface DuplicateKey {
  key: string;
  line: number;
}

export interface DuplicateListItem {
  item: string;
  container: string;
  line: number;
}

export interface CiExecutableViolation {
  step: string;
  reason: string;
}

const BLOCK_SCALAR_RE = /^[>|][+-]?$/;
const KEY_BODY_RE = /^((?:"[^"]+"|'[^']+'|[A-Za-z0-9_./*-]+)):(\s+.*)?$/;

/** True when the value opens or continues a block-scalar body. */
function isBlockScalarValue(value: string): boolean {
  return BLOCK_SCALAR_RE.test(value);
}

function unquote(key: string): string {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

/**
 * Detects duplicate sibling keys in block-style YAML mappings.
 *
 * Key identity is the full ancestor chain: for a key at indent depth d,
 * ancestors are the most recent keys seen at each shallower depth. A repeated
 * key under one parent is flagged; the same key name under different parents
 * is legal; every sequence entry gets its own child scope (repeated
 * `- name:` entries are legal). Block-scalar bodies (`|`/`>` with chomping
 * indicators), comments, blank lines, and flow collections (`{...}`/`[...]`)
 * are skipped. Indentation must be consistent even-space blocks; anything
 * else fails loud rather than guessing.
 */
export function findDuplicateMappingKeys(yaml: string): DuplicateKey[] {
  const duplicates: DuplicateKey[] = [];
  const ancestry: (string | undefined)[] = [];
  const firstSeenAt = new Map<string, number>();
  // Sequence-entry discriminators per (parent identity, marker depth).
  const seqCounters = new Map<string, number>();
  let blockScalarBelowDepth = -1;

  /** Record a key at the given logical depth; reports duplicates by full identity. */
  function recordKey(key: string, keyDepth: number, lineNo: number): void {
    ancestry.length = Math.min(ancestry.length, keyDepth);
    const parentIdentity = ancestry
      .slice(0, keyDepth)
      .filter((k): k is string => k !== undefined)
      .join(".");
    const identity = `${parentIdentity}.${key}`;
    const seenAtLine = firstSeenAt.get(identity);
    if (seenAtLine !== undefined) {
      duplicates.push({ key: identity, line: lineNo });
    } else {
      firstSeenAt.set(identity, lineNo);
    }
    ancestry[keyDepth] = key;
  }

  const lines = yaml.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    if (indent > 0 && raw.trimStart().startsWith("\t")) {
      throw new Error(`tab indentation at line ${lineNo} is not supported by this validator`);
    }
    if (indent % 2 !== 0) {
      throw new Error(`non-even indentation (${indent} spaces) at line ${lineNo} is not supported by this validator`);
    }
    const depth = Math.floor(indent / 2);
    if (blockScalarBelowDepth >= 0) {
      if (depth > blockScalarBelowDepth) continue;
      blockScalarBelowDepth = -1;
    }

    const isListItem = trimmed === "-" || trimmed.startsWith("- ");
    const itemBody = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : "";
    const body = isListItem ? itemBody : trimmed;

    // Flow collections and multi-token non-key bodies are not mapping keys.
    if (body.startsWith("{") || body.startsWith("[")) continue;
    const match = KEY_BODY_RE.exec(body);

    if (!match) {
      if (isBlockScalarValue(trimmed)) blockScalarBelowDepth = depth;
      // Scalar sequence entry or free text: never a key.
      continue;
    }

    const key = unquote(match[1] ?? "");
    const value = (match[2] ?? "").trim();

    if (!isListItem) {
      recordKey(key, depth, lineNo);
    } else {
      // A mapping-valued sequence entry gets its own child scope: a unique
      // discriminator at the marker's depth, then the entry's first key one
      // level below. This keeps `- id:` entries distinct across items in both
      // dash styles (indented under the parent key or at the parent column).
      ancestry.length = Math.min(ancestry.length, depth);
      const parentIdentity = ancestry
        .slice(0, depth)
        .filter((k): k is string => k !== undefined)
        .join(".");
      const seqKey = `${parentIdentity}|${depth}`;
      const seqIndex = (seqCounters.get(seqKey) ?? 0) + 1;
      seqCounters.set(seqKey, seqIndex);
      ancestry.length = depth + 1;
      ancestry[depth] = `#${seqIndex}`;
      recordKey(key, depth + 1, lineNo);
    }

    if (isBlockScalarValue(value)) blockScalarBelowDepth = isListItem ? depth + 1 : depth;
  }
  return duplicates;
}

/**
 * Detects duplicated scalar entries within the same named sequence
 * (e.g. the same task group listed twice under `completed_task_groups`).
 * Mapping-valued sequence entries are out of scope.
 */
export function findDuplicateListItems(yaml: string): DuplicateListItem[] {
  const duplicates: DuplicateListItem[] = [];
  const perContainer = new Map<string, Map<string, number>>();
  const ancestry: (string | undefined)[] = [];
  let listItemDepth = -1;
  let containerPath = "(root)";
  let blockScalarBelowDepth = -1;

  const lines = yaml.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new Error(`non-even indentation (${indent} spaces) at line ${lineNo} is not supported by this validator`);
    }
    const depth = Math.floor(indent / 2);
    if (blockScalarBelowDepth >= 0) {
      if (depth > blockScalarBelowDepth) continue;
      blockScalarBelowDepth = -1;
    }

    if (trimmed === "-" || trimmed.startsWith("- ")) {
      const itemBody = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : "";
      if (!itemBody || itemBody.includes(":") || itemBody.startsWith("{") || itemBody.startsWith("[")) continue;
      if (listItemDepth === -1) {
        listItemDepth = depth;
        containerPath =
          ancestry.slice(0, depth).filter((k): k is string => k !== undefined).join(".") || "(root)";
      }
      if (depth !== listItemDepth) continue;
      let seen = perContainer.get(containerPath);
      if (!seen) {
        seen = new Map();
        perContainer.set(containerPath, seen);
      }
      const firstAt = seen.get(itemBody);
      if (firstAt !== undefined) duplicates.push({ item: itemBody, container: containerPath, line: lineNo });
      else seen.set(itemBody, lineNo);
      continue;
    }

    const match = KEY_BODY_RE.exec(trimmed);
    if (!match) {
      if (isBlockScalarValue(trimmed)) blockScalarBelowDepth = depth;
      continue;
    }
    const key = unquote(match[1] ?? "");
    const value = (match[2] ?? "").trim();
    ancestry.length = Math.min(ancestry.length, depth);
    ancestry[depth] = key;
    listItemDepth = -1;
    if (isBlockScalarValue(value)) blockScalarBelowDepth = depth;
  }
  return duplicates;
}

export interface RootBinsInput {
  /** Binaries resolvable from the workspace root (manifest deps ∪ node_modules/.bin). */
  rootBins: ReadonlySet<string>;
  /**
   * Workspace packages that own specific binaries, e.g.
   * `{ playwright: "@inspector/adapter-web" }` derived from package manifests.
   */
  binOwners?: Readonly<Record<string, string>>;
}

/**
 * Audits every `pnpm exec <bin> ...` step plus every browser-provisioning
 * invocation in a CI workflow for dependency-locality correctness. A step may
 * execute a non-root binary only when it scopes the call to an owning package
 * via `pnpm --filter <pkg>` (or an owning-package script reference).
 */
export function ciExecutableViolations(ciYaml: string, input: RootBinsInput): CiExecutableViolation[] {
  const violations: CiExecutableViolation[] = [];

  for (const step of extractRunSteps(ciYaml)) {
    const execMatch = /\bpnpm exec\s+([^\s|>&]+)/.exec(step.command);
    if (execMatch) {
      const bin = execMatch[1] ?? "";
      const scoped = step.command.includes("--filter");
      if (!input.rootBins.has(bin) && !scoped) {
        violations.push({
          step: step.command,
          reason:
            `binary "${bin}" is not resolvable from the workspace root and the step has no --filter scoping; ` +
            `on a clean runner pnpm's isolated layout hides package-local bins (hosted failure class of run 32840538303)`,
        });
      }
    }
    if (/\bplaywright\b/.test(step.command) || /provision:browser\b/.test(step.command)) {
      const owner = input.binOwners?.playwright;
      const scopedToOwner =
        owner !== undefined &&
        (step.command.includes(`--filter ${owner}`) ||
          step.command.includes(`--filter=${owner}`) ||
          step.command.includes(`${owner} provision:browser`));
      if (!scopedToOwner) {
        violations.push({
          step: step.command,
          reason:
            `browser provisioning invoked without scoping to the playwright-owning workspace package` +
            `${owner ? ` (${owner})` : ""}; the downloaded revision must come from the same playwright ` +
            `version the integration tests import`,
        });
      }
    }
  }
  return violations;
}

export interface RunStep {
  command: string;
  line: number;
}

/** Extracts single-line `- run:` steps from a workflow file. */
export function extractRunSteps(ciYaml: string): RunStep[] {
  const steps: RunStep[] = [];
  const lines = ciYaml.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const match = /^\s*- run:\s*(.+)$/.exec(raw);
    if (match) steps.push({ command: (match[1] ?? "").trim(), line: index + 1 });
  }
  return steps;
}
