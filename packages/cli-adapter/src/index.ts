export * from "./types.js";
export * from "./mock-pty.js";
export * from "./cli-adapter.js";

import { resolveAdapterBin } from "@inspector/adapter-sdk";

const cliBin = resolveAdapterBin(import.meta.url, "inspector-adapter-cli.js", "bin");

/** Spawn descriptor for running the CLI adapter as a JSON-RPC subprocess. */
export function cliAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: cliBin.command,
    adapterArgs: cliBin.args,
    adapterEnv: { ...process.env },
  };
}
