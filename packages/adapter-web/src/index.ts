import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "bin.ts");

export * from "./seeded-app.js";
export * from "./web-adapter.js";

export function webAdapterSpawn(): {
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
