export * from "./types.js";
export * from "./adb-errors.js";
export * from "./mock-backend.js";
export * from "./real-backend.js";
export * from "./uiautomator.js";
export * from "./android-adapter.js";
export * from "./replay.js";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Spawn descriptor for running the android adapter as a JSON-RPC subprocess. */
export function androidAdapterSpawn(): {
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
