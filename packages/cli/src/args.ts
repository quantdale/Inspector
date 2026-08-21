/**
 * Hand-rolled argument parser (no dependencies).
 *
 * Errors are `CliError`s whose messages carry a machine-greppable kind prefix
 * (`unknown-flag: --foo`, `missing-value: --seed`, ...) so both humans and
 * scripts can tell exactly what was rejected.
 */

/** A user-facing CLI misuse error; rendered concisely by bin.ts. */
export class CliError extends Error {
  constructor(
    readonly kind: string,
    detail: string,
  ) {
    super(`${kind}: ${detail}`);
    this.name = "CliError";
  }
}

export interface ParsedInvocation {
  /** Non-flag arguments, in order (subcommands, ids, ...). */
  positionals: string[];
  /** Normalized long flag name -> `true` (boolean) or string value. */
  flags: Record<string, string | true>;
  json: boolean;
  workspace?: string;
  help: boolean;
  version: boolean;
}

/** Flags valid for every command. */
const GLOBAL_BOOL_FLAGS = new Set(["--json", "--help", "-h", "--version", "-v", "--debug"]);
const GLOBAL_VALUE_FLAGS = new Set(["--workspace"]);

function normalizeFlag(token: string): string {
  if (token === "-h") return "--help";
  if (token === "-v") return "--version";
  return token;
}

/**
 * Parse `argv` for one command. `valueFlags` (long names) consume the next
 * token; everything else recognized is boolean. Unknown flags, missing
 * values, and duplicated value flags are rejected with named errors.
 */
export function parseArgs(
  argv: string[],
  valueFlags: string[] = [],
  boolFlags: string[] = [],
): ParsedInvocation {
  const valueSet = new Set([...GLOBAL_VALUE_FLAGS, ...valueFlags]);
  const boolSet = new Set([...GLOBAL_BOOL_FLAGS, ...boolFlags]);
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];

  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!onlyPositionals && token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (!onlyPositionals && token.length > 1 && token.startsWith("-")) {
      const name = normalizeFlag(token);
      if (valueSet.has(name)) {
        if (flags[name] !== undefined) {
          throw new CliError("duplicate-flag", `${token} given more than once`);
        }
        const raw = argv[i + 1];
        // A following long flag means the value was forgotten; a leading
        // single dash is still accepted so negative numbers work.
        if (raw === undefined || (raw.startsWith("--") && raw.length > 2)) {
          throw new CliError("missing-value", `${token} requires a value`);
        }
        flags[name] = raw;
        i += 1;
      } else if (boolSet.has(name)) {
        flags[name] = true;
      } else {
        throw new CliError("unknown-flag", token);
      }
    } else {
      positionals.push(token);
    }
  }

  return {
    positionals,
    flags,
    json: flags["--json"] === true,
    workspace: typeof flags["--workspace"] === "string" ? flags["--workspace"] : undefined,
    help: flags["--help"] === true,
    version: flags["--version"] === true,
  };
}

/** Read an integer flag with a default; rejects junk loudly. */
export function intFlag(
  flags: Record<string, string | true>,
  name: string,
  fallback: number,
): number {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError("invalid-value", `${name} expects a non-negative integer, got '${raw}'`);
  }
  return n;
}

/** Read a required positional; the caller supplies the usage hint. */
export function requirePositional(positionals: string[], index: number, usage: string): string {
  const value = positionals[index];
  if (value === undefined || value === "") {
    throw new CliError("missing-argument", `missing-argument: ${usage}`);
  }
  return value;
}
