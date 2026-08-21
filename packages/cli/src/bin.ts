import { runCli } from "./cli.js";
import { CliError } from "./args.js";

const debug = process.argv.slice(2).includes("--debug");

runCli(process.argv.slice(2))
  .then((result) => {
    process.exit(result.code);
  })
  .catch((err: unknown) => {
    // Friendly by default: one concise line; raw stacks only under --debug.
    const message = err instanceof Error ? err.message : String(err);
    const prefix = err instanceof CliError ? "inspector" : "inspector error";
    process.stderr.write(`${prefix}: ${message}\n`);
    if (debug && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  });
