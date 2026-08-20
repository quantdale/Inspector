import { runCli } from "./cli.js";

runCli(process.argv.slice(2))
  .then((result) => {
    process.exit(result.code);
  })
  .catch((err) => {
    process.stderr.write(`inspector error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
