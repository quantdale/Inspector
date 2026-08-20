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

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.stdout.on("error", () => process.exit(0));
