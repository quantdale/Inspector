import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the Inspector version from package.json at runtime (relative to this
 * source file), preferring the repository root manifest and falling back to
 * this package's own manifest. Never throws: an unreadable tree yields a
 * dev placeholder instead of failing `--version`.
 */
export function resolveVersion(): string {
  for (const candidate of [
    join(here, "..", "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ]) {
    try {
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
