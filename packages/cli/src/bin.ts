import { runCli } from "./cli.js";
import { CliError } from "./args.js";

const debug = process.argv.slice(2).includes("--debug");
const json = process.argv.slice(2).includes("--json");
const argv = process.argv.slice(2);

type ErrorClassification = "user/config" | "environment-unavailable" | "policy-refusal" | "internal";

function commandOf(args: string[]): string | null {
  const valueFlags = new Set([
    "--workspace", "--adapter", "--url", "--target", "--seed", "--max-actions",
    "--max-minutes", "--max-findings", "--resume", "--attempts", "--min-successes",
    "--timeout-ms", "--revision", "--run", "--finding", "--provider", "--patch-agent",
    "--repo-root", "--max-attempts", "--error-text", "--selectors", "--id", "--items",
    "--manifest", "--workers", "--steps", "--mode", "--lease-backend", "--lease-ttl-ms", "--limit",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--") return args[index + 1] ?? null;
    if (token.startsWith("-")) {
      if (valueFlags.has(token)) index += 1;
      continue;
    }
    return token;
  }
  return null;
}

function classifyError(kind: string): ErrorClassification {
  if (/adapter|environment|timeout|unavailable|target-unavailable|initial-observe/i.test(kind)) {
    return "environment-unavailable";
  }
  if (/policy|capability|test-tamper|masking|invalid-provenance|workspace-conflict/i.test(kind)) {
    return "policy-refusal";
  }
  if (/unknown|missing|invalid|unexpected|provider|required|argument|value|command/i.test(kind)) {
    return "user/config";
  }
  return "internal";
}

function exitCodeFor(classification: ErrorClassification): number {
  if (classification === "environment-unavailable") return 3;
  if (classification === "user/config" || classification === "policy-refusal") return 4;
  return 1;
}

runCli(argv)
  .then((result) => {
    process.exit(result.code);
  })
  .catch((err: unknown) => {
    // Friendly by default: one concise line; raw stacks only under --debug.
    const message = err instanceof Error ? err.message : String(err);
    const prefix = err instanceof CliError ? "inspector" : "inspector error";
    if (json) {
      const kind = err instanceof CliError ? err.kind : "internal";
      const classification = classifyError(kind);
      process.stdout.write(JSON.stringify({
        schema: "inspector-cli/error/1",
        ok: false,
        command: commandOf(argv),
        error: {
          kind,
          message,
          classification,
          exitCode: exitCodeFor(classification),
        },
      }) + "\n");
    } else {
      process.stderr.write(`${prefix}: ${message}\n`);
    }
    if (debug && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(json ? exitCodeFor(classifyError(err instanceof CliError ? err.kind : "internal")) : 1);
  });
