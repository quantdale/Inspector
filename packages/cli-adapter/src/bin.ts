import { CliAdapterHandler } from "./cli-adapter.js";
import { MockPtyBackend } from "./mock-pty.js";
import { armPtyExitGuard } from "./node-pty-backend.js";
import type { PtyBackend } from "./types.js";
import { AdapterServer } from "@inspector/adapter-sdk";
import { mkdirSync } from "node:fs";

// SPEC-009: optional long-path sandbox for real PTY programs (vim needs a
// writable cwd for scratch files). MUST be a long path — ConPTY hard-crashes
// with an 8.3 short-path cwd (see GA field evidence FIELD-ENV-CONPTY-SHORTPATH).
const cliCwd = process.env.INSPECTOR_CLI_CWD;
if (cliCwd) {
  mkdirSync(cliCwd, { recursive: true });
  process.chdir(cliCwd);
}

async function selectBackend(): Promise<PtyBackend> {
  // INSPECTOR_PTY=real opts into the native node-pty backend; mock stays the
  // default so existing behavior and tests are unchanged.
  if (process.env.INSPECTOR_PTY === "real") {
    const { NodePtyBackend } = await import("./node-pty-backend.js");
    return new NodePtyBackend();
  }
  return new MockPtyBackend();
}

const program = process.env.INSPECTOR_CLI_PROGRAM ?? "seedcli";
const usingRealPty = process.env.INSPECTOR_PTY === "real";
const handler = new CliAdapterHandler(await selectBackend(), undefined, program);
const server = new AdapterServer(process.stdin, process.stdout, handler);

// Guarded shutdown: when stdin EOF ends the JSON-RPC session and the real
// PTY backend was used, arm a force-exit guard so leaked upstream node-pty
// IPC handles can never wedge this host process at exit (see
// armPtyExitGuard). The mock backend has no such leak; leave it untouched.
if (usingRealPty) {
  const arm = () => {
    server.close();
    armPtyExitGuard();
  };
  process.stdin.once("end", arm);
  process.stdin.once("close", arm);
}

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.stdout.on("error", () => process.exit(0));
