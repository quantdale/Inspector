import { WebAdapterHandler, type WebFaults } from "./web-adapter.js";
import { AdapterServer } from "@inspector/adapter-sdk";

function parseFaults(): WebFaults {
  const raw = process.env.WEB_FAULTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WebFaults;
  } catch {
    return {};
  }
}

const handler = new WebAdapterHandler(parseFaults());
const server = new AdapterServer(process.stdin, process.stdout, handler);

// Graceful signal shutdown: release the browser/context/seed server before
// exiting instead of leaving orphaned Chromium processes behind.
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
