import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, "..", "..", "adapter-fake", "src", "bin.ts");
const webBin = join(here, "..", "..", "adapter-web", "src", "bin.ts");

export interface Workspace {
  store: Store;
  artifacts: ArtifactStore;
  base: string;
}

export function workspaceDirFrom(cwd: string): string {
  return join(cwd, ".inspector");
}

export function openWorkspace(cwd: string): Workspace {
  const base = workspaceDirFrom(cwd);
  const store = Store.open(join(base, "runs.db"));
  const artifacts = new ArtifactStore(join(base, "artifacts"));
  return { store, artifacts, base };
}

export interface AdapterSpawnSpec {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
}

/** Spawn spec for a named adapter; extra env is merged over process.env. */
export function adapterSpawn(name: string, extraEnv: NodeJS.ProcessEnv = {}): AdapterSpawnSpec {
  const bin = name === "web" ? webBin : fakeBin;
  return {
    adapterCommand: process.execPath,
    adapterArgs: ["--import", "tsx", bin],
    adapterEnv: { ...process.env, ...extraEnv },
  };
}
