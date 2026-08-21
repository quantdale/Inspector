import { CliAdapterHandler } from "./cli-adapter.js";
import { MockPtyBackend } from "./mock-pty.js";
import type { PtyBackend } from "./types.js";
import { AdapterServer } from "@inspector/adapter-sdk";

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
const handler = new CliAdapterHandler(await selectBackend(), undefined, program);
const server = new AdapterServer(process.stdin, process.stdout, handler);

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.stdout.on("error", () => process.exit(0));
