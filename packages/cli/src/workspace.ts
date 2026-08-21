import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { CliError } from "./args.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, "..", "..", "adapter-fake", "src", "bin.ts");
const webBin = join(here, "..", "..", "adapter-web", "src", "bin.ts");
// Workspace tsconfig so tsx can resolve @inspector/* even when the CLI (and
// thus its adapter subprocesses) run with a cwd outside the repository.
const repoTsconfig = join(here, "..", "..", "..", "tsconfig.json");
// Absolute tsx entry so `--import` resolves even when the process cwd is
// outside the repository (bare 'tsx' would resolve from cwd's node_modules).
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

export interface Workspace {
  store: Store;
  artifacts: ArtifactStore;
  base: string;
}

export function workspaceDirFrom(cwd: string): string {
  return join(cwd, ".inspector");
}

/**
 * Marker set identifying the Inspector repository root. Running with the repo
 * root as workspace shares one runs.db across every hunt and is almost never
 * what the operator wants, so callers warn about it.
 */
export function isRepoRoot(dir: string): boolean {
  return (
    existsSync(join(dir, "package.json")) &&
    existsSync(join(dir, "packages")) &&
    existsSync(join(dir, ".inspector", "state", "campaign.yaml"))
  );
}

export const REPO_ROOT_WARNING =
  "warning: using repository-root workspace; pass --workspace <dir> to isolate runs";

/**
 * Deterministic, cwd-independent workspace resolution:
 * `--workspace` flag > `INSPECTOR_WORKSPACE` env > caller's cwd.
 */
export function resolveWorkspaceDir(
  explicit: string | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { dir: string; repoRootWarning: string | null } {
  const dir = explicit ?? env.INSPECTOR_WORKSPACE ?? cwd;
  return { dir, repoRootWarning: isRepoRoot(dir) ? REPO_ROOT_WARNING : null };
}

const SHARED_DB_PATTERN =
  /SQLITE_CONSTRAINT|UNIQUE constraint|database is locked|database table is locked/i;

/**
 * Remap store-open / run-start failures caused by a shared or locked
 * workspace database into an actionable CliError; pass anything else through.
 */
export function remapWorkspaceConflict(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!SHARED_DB_PATTERN.test(message)) return error;
  return new CliError(
    "workspace-conflict",
    "workspace database is locked by another concurrent run or shared; " +
      `pass --workspace <dir> to isolate (underlying error: ${message})`,
  );
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
    adapterArgs: ["--import", tsxImportUrl, bin],
    adapterEnv: {
      ...process.env,
      ...(existsSync(repoTsconfig) ? { TSX_TSCONFIG_PATH: repoTsconfig } : {}),
      ...extraEnv,
    },
  };
}
