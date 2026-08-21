import { CliAdapterHandler } from "./cli-adapter.js";
import { MockPtyBackend } from "./mock-pty.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const handler = new CliAdapterHandler(new MockPtyBackend());
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
