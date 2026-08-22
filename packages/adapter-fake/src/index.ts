import { resolveAdapterBin } from "@inspector/adapter-sdk";

const bin = resolveAdapterBin(import.meta.url, "inspector-adapter-fake.js", "bin");

export * from "./state-machine.js";
export * from "./handler.js";

export function fakeAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: bin.command,
    adapterArgs: bin.args,
    adapterEnv: { ...process.env },
  };
}
