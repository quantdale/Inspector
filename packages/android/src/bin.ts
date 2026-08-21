import { AndroidAdapterHandler } from "./android-adapter.js";
import { createAdbBackendFromEnv } from "./real-backend.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const { backend } = await createAdbBackendFromEnv();
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
