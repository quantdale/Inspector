/**
 * Deterministic source/change intelligence for diagnosis (M13 F9).
 *
 * Ranks repository context with materially more than raw token occurrence:
 * operator-preferred paths, evidence-referenced paths, explicitly known
 * change sets (never an invented comparison base), prior repair attempts,
 * error/log tokens, UI selector ids, cheap import proximity, and nearby test
 * candidates. Output explains WHY every file was selected so repair packets
 * stay auditable.
 */

export interface SourceIntelInput {
  /** Tracked workspace-relative files (from RepairWorkspace.listFiles). */
  files: string[];
  /** Lazy content access; unreadable files simply score on path signals. */
  readFile: (path: string) => Promise<string | null>;
  errorText?: string;
  selectors?: string[];
  /** Paths already named by evidence (stack traces, bundle metadata). */
  referencedPaths?: string[];
  preferredPaths?: string[];
  /**
   * Changed paths from an EXPLICITLY KNOWN comparison base only. Callers
   * must never fabricate a base: absent evidence means absent signal.
   */
  changedPaths?: string[];
  previousAttemptPaths?: string[];
  maxCandidates?: number;
}

export interface RankedSourceFile {
  path: string;
  score: number;
  reasons: string[];
  /** Test files adjacent to this implementation candidate. */
  nearbyTests: string[];
}

const TEST_PATTERN = /(^|\/)(__tests__|tests?)(\/|$)|\.test\.|\.spec\.|(^|\/)test[^/]*\.[cm]?[jt]sx?$/i;
const IMPORT_RE = /(?:from\s+|require\(\s*|import\s+["'])([^"'\s()]+)["'\s)]/g;

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function basenameTokens(p: string): string[] {
  const base = normalize(p).split("/").pop() ?? "";
  return Array.from(base.toLowerCase().matchAll(/[a-z0-9_]{3,}/g)).map((m) => m[0]);
}

function isTestPath(path: string): boolean {
  return TEST_PATTERN.test(normalize(path));
}

/** Cheap import extraction: module specifiers from one file's content. */
function importSpecifiers(content: string): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    if (match[1]) out.push(match[1]);
  }
  return out.slice(0, 64);
}

/** Does a module specifier plausibly point at `targetPath`? Handles relative
 * specifiers and package-root-ish matches without full resolution. */
function specifierMayResolve(specifier: string, targetPath: string): boolean {
  const t = normalize(targetPath).toLowerCase();
  const spec = specifier.replace(/\.(js|mjs|cjs|ts|tsx)$/i, "").toLowerCase();
  if (!spec.startsWith(".") && !spec.startsWith("@/")) {
    // Bare package specifier: compare against the path's tail segments.
    const tail = t.split("/").slice(-2).join("/");
    return t.includes(spec) || tail.includes(spec.split("/").pop() ?? "\u0000");
  }
  const specSegments = spec.split("/").filter((s) => s !== ".");
  const targetSegments = t.split("/");
  let offset = -1;
  for (let i = 0; i <= targetSegments.length - specSegments.length; i++) {
    if (
      specSegments.every(
        (s, j) => targetSegments[i + j]?.startsWith(s) || targetSegments[i + j] === s,
      )
    ) {
      offset = i;
      break;
    }
  }
  return offset !== -1;
}

export async function rankSourceFiles(input: SourceIntelInput): Promise<RankedSourceFile[]> {
  const maxCandidates = input.maxCandidates ?? 24;
  const errorTokenList = Array.from(
    (input.errorText ?? "").toLowerCase().matchAll(/[a-z0-9_]{4,}/g),
  ).map((m) => m[0]);
  const errorTokens = new Set(errorTokenList);
  const selectorIds = new Set<string>();
  for (const s of input.selectors ?? []) {
    const id = s
      .replace(/^[#.[]+/, "")
      .replace(/["\])]+$/, "")
      .toLowerCase();
    if (id.length >= 3) selectorIds.add(id);
  }
  const preferred = new Set((input.preferredPaths ?? []).map(normalize));
  const referenced = new Set((input.referencedPaths ?? []).map(normalize));
  const changedSet = new Set((input.changedPaths ?? []).map(normalize));
  const priorAttempts = new Set((input.previousAttemptPaths ?? []).map(normalize));

  interface Working {
    path: string;
    score: number;
    reasons: Set<string>;
    imports: string[];
    content: string | null;
  }

  const impls: Working[] = [];
  const tests: Working[] = [];
  const contents = new Map<string, string>();

  for (const rawPath of input.files) {
    const path = normalize(rawPath);
    const working: Working = { path, score: 0, reasons: new Set(), imports: [], content: null };
    if (preferred.has(path)) {
      working.score += 100;
      working.reasons.add("operator-preferred");
    }
    if (changedSet.has(path)) {
      working.score += 60;
      working.reasons.add("changed-vs-known-base");
    }
    if (referenced.has(path)) {
      working.score += 80;
      working.reasons.add("evidence-referenced");
    } else {
      const tokens = basenameTokens(path);
      for (const p of input.referencedPaths ?? []) {
        const refTokens = basenameTokens(p);
        if (refTokens.length > 0 && refTokens.every((t) => tokens.includes(t))) {
          working.score += 40;
          working.reasons.add("evidence-referenced-basename");
          break;
        }
      }
    }
    if (priorAttempts.has(path)) {
      working.score += 30;
      working.reasons.add("prior-attempt-touched");
    }
    let content: string | null = null;
    try {
      content = await input.readFile(rawPath);
    } catch {
      content = null;
    }
    if (content !== null) {
      contents.set(path, content);
      const lower = content.toLowerCase();
      let tokenHits = 0;
      for (const token of errorTokens) {
        if (lower.includes(token)) {
          tokenHits += 1;
          if (tokenHits <= 5) working.reasons.add(`error-token:${token}`);
          if (tokenHits === 6) break;
        }
      }
      if (tokenHits > 0) working.score += Math.min(tokenHits * 10, 50);
      let selectorHits = 0;
      for (const id of selectorIds) {
        if (id.length >= 4 && lower.includes(id)) {
          selectorHits += 1;
          working.reasons.add(`selector:${id}`);
          if (selectorHits === 4) break;
        }
      }
      if (selectorHits > 0) working.score += Math.min(selectorHits * 12, 48);
      working.imports = importSpecifiers(content);
    }
    if (isTestPath(path)) tests.push(working);
    else impls.push(working);
  }

  // Import proximity between implementation candidates (cheap two-pass):
  // a file importing (or imported by) a high-signal file gains context rank.
  const strong = new Set(impls.filter((w) => w.score >= 40).map((w) => w.path));
  for (const w of impls) {
    if (w.imports.length === 0 || strong.has(w.path)) continue;
    for (const spec of w.imports) {
      if ([...strong].some((target) => target !== w.path && specifierMayResolve(spec, target))) {
        w.score += 20;
        w.reasons.add("import-proximity");
        break;
      }
    }
  }

  // Nearby tests: same directory or shared basename stem.
  const rankedImpls = [...impls].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const ranked: RankedSourceFile[] = rankedImpls.slice(0, maxCandidates).map((w) => {
    const stem = basenameTokens(w.path)[0];
    const nearby = tests
      .filter((t) => {
        const dir = w.path.includes("/") ? w.path.slice(0, w.path.lastIndexOf("/")) : "";
        const tdir = t.path.includes("/") ? t.path.slice(0, t.path.lastIndexOf("/")) : "";
        return (stem !== undefined && t.path.toLowerCase().includes(stem)) || (dir !== "" && tdir.startsWith(dir));
      })
      .slice(0, 5)
      .map((t) => t.path);
    return {
      path: w.path,
      score: w.score,
      reasons: [...w.reasons].sort(),
      nearbyTests: nearby,
    };
  });
  return ranked;
}
