import { WindowsAdapterHandler } from "./windows-adapter.js";
import { MockUiaBackend } from "./mock-uia.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const handler = new WindowsAdapterHandler(new MockUiaBackend());
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
