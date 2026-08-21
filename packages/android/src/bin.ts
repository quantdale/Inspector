import { AndroidAdapterHandler } from "./android-adapter.js";
import { MockAdbBackend } from "./mock-backend.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const backend = new MockAdbBackend();
const handler = new AndroidAdapterHandler(backend);
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
