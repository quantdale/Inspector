import { FakeAdapterHandler, type FakeFaults } from "./handler.js";
import { AdapterServer } from "@inspector/adapter-sdk";

function parseFaults(): FakeFaults {
  const raw = process.env.FAKE_FAULTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FakeFaults;
  } catch {
    return {};
  }
}

const handler = new FakeAdapterHandler({ faults: parseFaults() });
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
