import { WindowsAdapterHandler } from "./windows-adapter.js";
import { selectWindowsBackend } from "./selection.js";
import type { RealUiaBackend } from "./real-uia.js";
import { AdapterServer } from "@inspector/adapter-sdk";

const selection = await selectWindowsBackend();
const handler = new WindowsAdapterHandler(
  selection.backend,
  process.env.INSPECTOR_ARTIFACT_BASE_DIR,
);
const realBackend = selection.kind === "real" ? (selection.backend as RealUiaBackend) : null;
const server = new AdapterServer(process.stdin, process.stdout, handler);

const shutdown = (): void => {
  realBackend?.dispose();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.stdout.on("error", () => process.exit(0));
