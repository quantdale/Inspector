// Minimal JSON-RPC-over-stdio adapter used by core hardening tests to prove
// that durable records carry the adapter's REAL identity (not a hardcoded
// label). Speaks the same newline-delimited JSON-RPC 2.0 framing as
// @inspector/adapter-sdk's LineChannel.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let seq = 0;

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
        adapter: "fixture-mini",
        capabilities: {
          observe: ["state"],
          act: ["noop"],
          lifecycle: ["create", "reset", "close"],
        },
      });
      break;
    case "lifecycle":
      reply({ ok: true });
      break;
    case "observe":
      seq += 1;
      reply({
        id: `mini_obs_${seq}`,
        runId: "run",
        environmentId: "env",
        sequence: seq,
        source: "fixture-mini",
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
    case "health":
      reply({ ok: true, uptimeMs: 0, now: new Date().toISOString() });
      break;
    default:
      reply({ ok: true });
  }
});
