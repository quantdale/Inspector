// Strict-lifecycle JSON-RPC-over-stdio adapter used by the FIELD-1 regression
// test: observe REFUSES until lifecycle.create was seen in THIS process, which
// mirrors real adapters (web/cli/windows/android) whose handlers require an
// environment. Records every lifecycle-create request (with the spawn-env
// marker) to LIFECYCLE_LOG_FILE so tests can prove faithful resume replay.
// An act whose input.value === "die" exits the process abruptly (host-death
// simulation without cooperative close).
import readline from "node:readline";
import { appendFileSync } from "node:fs";

const rl = readline.createInterface({ input: process.stdin });
let created = false;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n");
  };
  const fail = (message) => {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } }) + "\n",
    );
  };
  switch (req.method) {
    case "initialize":
      reply({
        protocolVersion: "0.1",
        adapter: "fixture-strict-lifecycle",
        capabilities: {
          observe: ["state"],
          act: ["noop"],
          lifecycle: ["create", "reset", "close"],
        },
      });
      break;
    case "lifecycle":
      if (req.params?.op === "create") {
        created = true;
        if (process.env.LIFECYCLE_LOG_FILE) {
          appendFileSync(
            process.env.LIFECYCLE_LOG_FILE,
            JSON.stringify({
              op: "create",
              options: req.params.options ?? null,
              strictTargetSeen: process.env.STRICT_TARGET ?? null,
            }) + "\n",
          );
        }
      }
      reply({ ok: true });
      break;
    case "observe":
      if (!created) {
        fail("environment not created");
        return;
      }
      reply({
        id: `strict_obs_${req.id}`,
        runId: "run",
        environmentId: "env",
        sequence: 1,
        source: "fixture-strict-lifecycle",
        capturedAt: new Date().toISOString(),
        summary: {},
      });
      break;
    case "act": {
      if (!created) {
        fail("environment not created");
        return;
      }
      if (req.params?.action?.input?.value === "die") {
        process.exit(70);
      }
      reply({
        actionId: req.params?.action?.id ?? "x",
        runId: "run",
        environmentId: "env",
        status: "success",
        observedAt: new Date().toISOString(),
      });
      break;
    }
    default:
      reply({ ok: true });
  }
});
