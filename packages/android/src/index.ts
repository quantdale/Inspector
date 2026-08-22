export * from "./types.js";
export * from "./adb-errors.js";
export * from "./mock-backend.js";
export * from "./real-backend.js";
export * from "./uiautomator.js";
export * from "./android-adapter.js";
export * from "./replay.js";

import { resolveAdapterBin } from "@inspector/adapter-sdk";

const androidBin = resolveAdapterBin(import.meta.url, "inspector-adapter-android.js", "bin");

/** Spawn descriptor for running the android adapter as a JSON-RPC subprocess. */
export function androidAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: androidBin.command,
    adapterArgs: androidBin.args,
    adapterEnv: { ...process.env },
  };
}
