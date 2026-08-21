export * from "./types.js";
export * from "./mock-uia.js";
export * from "./windows-adapter.js";
export * from "./uia-bridge.js";
export * from "./real-uia.js";
export * from "./selection.js";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Spawn descriptor for running the Windows adapter as a JSON-RPC subprocess. */
export function windowsAdapterSpawn(): {
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
