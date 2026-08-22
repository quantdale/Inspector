import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the Inspector version at runtime.
 *
 * Precedence is deliberate:
 * 1. The build-stamped `inspector-version.txt` sitting next to the bundled
 *    entry — the authoritative version of an installed artifact. It MUST be
 *    consulted first: ambient package.json files above/beside the install
 *    location (a consumer's own manifest, a global prefix root) would
 *    otherwise be picked up and report a foreign version.
 * 2. The repository root manifest (dev checkout, three directories up).
 * 3. This package's own manifest (source-tree fallback).
 *
 * Never throws: an unreadable tree yields a dev placeholder instead of
 * failing `--version`.
 */
export function resolveVersion(): string {
  for (const candidate of [
    // Installed artifact: the build stamps the release version next to the
    // bundles; absent in dev checkouts.
    join(here, "inspector-version.txt"),
    join(here, "..", "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ]) {
    try {
      if (candidate.endsWith(".txt")) {
        const raw = readFileSync(candidate, "utf8").trim();
        if (raw.length > 0) return raw;
        continue;
      }
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return "0.0.0-dev";
}
