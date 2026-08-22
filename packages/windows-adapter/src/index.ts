export * from "./types.js";
export * from "./mock-uia.js";
export * from "./windows-adapter.js";
export * from "./uia-bridge.js";
export * from "./real-uia.js";
export * from "./selection.js";

import { resolveAdapterBin } from "@inspector/adapter-sdk";

const winBin = resolveAdapterBin(import.meta.url, "inspector-adapter-windows.js", "bin");

/** Spawn descriptor for running the Windows adapter as a JSON-RPC subprocess. */
export function windowsAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: winBin.command,
    adapterArgs: winBin.args,
    adapterEnv: { ...process.env },
  };
}
