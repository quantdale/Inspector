import { describe, it, expect } from "vitest";
import { CliError, intFlag, parseArgs, requirePositional } from "./args.js";

function expectCliError(fn: () => unknown, kind: string): CliError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CliError);
    const err = e as CliError;
    expect(err.kind).toBe(kind);
    expect(err.message.startsWith(`${kind}:`)).toBe(true);
    return err;
  }
  throw new Error(`expected CliError(${kind})`);
}

describe("cli arg parser", () => {
  it("rejects unknown flags with named errors", () => {
    const err = expectCliError(() => parseArgs(["doctor", "--foo"]), "unknown-flag");
    expect(err.message).toBe("unknown-flag: --foo");
  });

  it("rejects missing flag values", () => {
    const err = expectCliError(() => parseArgs(["hunt", "--seed"], ["--seed"]), "missing-value");
    expect(err.message).toContain("--seed");
    expectCliError(() => parseArgs(["hunt", "--seed", "--json"], ["--seed"]), "missing-value");
  });

  it("rejects duplicate value flags", () => {
    const err = expectCliError(
      () => parseArgs(["hunt", "--seed", "1", "--seed", "2"], ["--seed"]),
      "duplicate-flag",
    );
    expect(err.message).toContain("duplicate-flag");
  });

  it("accepts values that start with a single dash (negative numbers)", () => {
    const parsed = parseArgs(["hunt", "--seed", "-1"], ["--seed"]);
    expect(parsed.flags["--seed"]).toBe("-1");
  });

  it("normalizes -h/-v aliases and collects positionals", () => {
    const parsed = parseArgs(["show", "find_1", "-h", "--json"]);
    expect(parsed.help).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.positionals).toEqual(["show", "find_1"]);
  });

  it("treats everything after -- as positionals", () => {
    const parsed = parseArgs(["show", "--", "--weird-id"]);
    expect(parsed.positionals).toEqual(["show", "--weird-id"]);
  });

  it("intFlag validates junk loudly and applies defaults", () => {
    expect(intFlag({}, "--limit", 42)).toBe(42);
    expect(intFlag({ "--limit": "7" }, "--limit", 42)).toBe(7);
    expectCliError(() => intFlag({ "--limit": "abc" }, "--limit", 1), "invalid-value");
    expectCliError(() => intFlag({ "--limit": "-3" }, "--limit", 1), "invalid-value");
  });

  it("requirePositional reports the usage hint", () => {
    expect(requirePositional(["x"], 0, "usage text")).toBe("x");
    const err = expectCliError(() => requirePositional([], 0, "usage text"), "missing-argument");
    expect(err.message).toContain("usage text");
  });
});
