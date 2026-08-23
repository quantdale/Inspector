export * from "./electron-adapter.js";
export * from "./capabilities.js";
export * from "./real-electron.js";

import { resolveAdapterBin } from "@inspector/adapter-sdk";

const electronBin = resolveAdapterBin(import.meta.url, "inspector-adapter-electron.js", "bin");

/** Spawn descriptor for running the Electron adapter as a JSON-RPC subprocess. */
export function electronAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: electronBin.command,
    adapterArgs: electronBin.args,
    adapterEnv: { ...process.env },
  };
}
