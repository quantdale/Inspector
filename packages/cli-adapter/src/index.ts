export * from "./types.js";
export * from "./mock-pty.js";
export * from "./cli-adapter.js";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Spawn descriptor for running the CLI adapter as a JSON-RPC subprocess. */
export function cliAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: process.execPath,
    adapterArgs: ["--import", "tsx", join(here, "bin.ts")],
    adapterEnv: { ...process.env },
  };
}
