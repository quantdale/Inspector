import { resolveAdapterBin } from "@inspector/adapter-sdk";

const bin = resolveAdapterBin(import.meta.url, "inspector-adapter-web.js", "bin");

export * from "./seeded-app.js";
export * from "./web-adapter.js";

export function webAdapterSpawn(): {
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
