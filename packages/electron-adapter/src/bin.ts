import { ElectronAdapterHandler } from "./electron-adapter.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const handler = new ElectronAdapterHandler(
  {},
  process.env.INSPECTOR_ARTIFACT_BASE_DIR,
);
const server = new AdapterServer(process.stdin, process.stdout, handler);

// Graceful signal shutdown: release the underlying browser/context/seed server
// before exiting instead of leaving orphaned Chromium processes behind.
async function gracefulExit(): Promise<void> {
  server.close();
  await handler.shutdown().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => {
  void gracefulExit();
});
process.on("SIGINT", () => {
  void gracefulExit();
});
process.stdout.on("error", () => process.exit(0));
