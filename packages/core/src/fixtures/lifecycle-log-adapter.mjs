// Minimal JSON-RPC-over-stdio adapter that RECORDS every lifecycle request to
// the file named by LIFECYCLE_LOG_FILE (one JSON line per request). Used by
// core tests to prove startRun forwards createOptions to the adapter.
import readline from "node:readline";
import { appendFileSync } from "node:fs";

const rl = readline.createInterface({ input: process.stdin });

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
  switch (req.method) {
    case "initialize":
      reply({
        protocolVersion: "0.1",
        adapter: "fixture-lifecycle-log",
        capabilities: {
          observe: ["state"],
          act: ["noop"],
          lifecycle: ["create", "reset", "close"],
        },
      });
      break;
    case "lifecycle":
      if (process.env.LIFECYCLE_LOG_FILE) {
        appendFileSync(process.env.LIFECYCLE_LOG_FILE, JSON.stringify(req.params) + "\n");
      }
      reply({ ok: true });
      break;
    case "observe":
      reply({
        id: `log_obs_${req.id}`,
        runId: "run",
        environmentId: "env",
        sequence: 1,
        source: "fixture-lifecycle-log",
        capturedAt: new Date().toISOString(),
        summary: {},
      });
      break;
    case "act":
      reply({
        actionId: req.params?.action?.id ?? "x",
        runId: "run",
        environmentId: "env",
        status: "success",
        observedAt: new Date().toISOString(),
      });
      break;
    default:
      reply({ ok: true });
  }
});
