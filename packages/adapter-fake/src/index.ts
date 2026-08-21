import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "bin.ts");

export * from "./state-machine.js";
export * from "./handler.js";

export function fakeAdapterSpawn(): {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
} {
  return {
    adapterCommand: process.execPath,
    adapterArgs: ["--import", "tsx", binPath],
    adapterEnv: { ...process.env },
  };
}
