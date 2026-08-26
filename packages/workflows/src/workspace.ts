import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { resolveAdapterBin, type AdapterBinRef } from "@inspector/adapter-sdk";
import { cleanupOrphanTemps } from "./atomic.js";
import { WorkflowError } from "./errors.js";
import { familyContractFor } from "./families.js";

const here = dirname(fileURLToPath(import.meta.url));
// Workspace tsconfig so a dev-mode tsx subprocess can resolve @inspector/*
// even when the CLI (and thus its adapter subprocesses) run with a cwd
// outside the repository.
const repoTsconfig = join(here, "..", "..", "..", "tsconfig.json");

/** Adapter binary files by family bin name (H5: exhaustive single source). */
const ADAPTER_BIN_FILES: Record<
  "web" | "fake" | "cli" | "windows" | "android" | "electron",
  { bundled: string; segments: string[] }
> = {
  web: { bundled: "inspector-adapter-web.js", segments: ["..", "..", "adapter-web", "src", "bin"] },
  fake: { bundled: "inspector-adapter-fake.js", segments: ["..", "..", "adapter-fake", "src", "bin"] },
  cli: { bundled: "inspector-adapter-cli.js", segments: ["..", "..", "cli-adapter", "src", "bin"] },
  windows: { bundled: "inspector-adapter-windows.js", segments: ["..", "..", "windows-adapter", "src", "bin"] },
  android: { bundled: "inspector-adapter-android.js", segments: ["..", "..", "android", "src", "bin"] },
  electron: { bundled: "inspector-adapter-electron.js", segments: ["..", "..", "electron-adapter", "src", "bin"] },
};

function adapterBin(name: keyof typeof ADAPTER_BIN_FILES): AdapterBinRef {
  const spec = ADAPTER_BIN_FILES[name];
  return resolveAdapterBin(import.meta.url, spec.bundled, ...spec.segments);
}

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
 * workspace database into an actionable WorkflowError; pass anything else through.
 */
export function remapWorkspaceConflict(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!SHARED_DB_PATTERN.test(message)) return error;
  return new WorkflowError(
    "workspace-conflict",
    "workspace database is locked by another concurrent run or shared; " +
      `pass --workspace <dir> to isolate (underlying error: ${message})`,
  );
}

export function openWorkspace(cwd: string): Workspace {
  const base = workspaceDirFrom(cwd);
  const store = Store.open(join(base, "runs.db"));
  cleanupOrphanTemps(base);
  const artifacts = new ArtifactStore(join(base, "artifacts"));
  return { store, artifacts, base };
}

export interface AdapterSpawnSpec {
  adapterCommand: string;
  adapterArgs: string[];
  adapterEnv: NodeJS.ProcessEnv;
}

/**
 * Spawn spec for a named adapter; extra env is merged over process.env.
 * HARDENING_5 H5-D0: resolution is EXHAUSTIVE and fail-closed — an unknown or
 * unsupported adapter name is a typed error, never a silent fake fallback.
 */
export function adapterSpawn(name: string, extraEnv: NodeJS.ProcessEnv = {}): AdapterSpawnSpec {
  const contract = familyContractFor(name);
  if (contract === undefined) {
    throw new WorkflowError(
      "unknown-adapter",
      `no executable adapter exists for '${name}'; refusing to substitute another adapter`,
    );
  }
  const bin = adapterBin(contract.binName);
  return {
    adapterCommand: bin.command,
    adapterArgs: bin.args,
    adapterEnv: {
      ...process.env,
      ...(existsSync(repoTsconfig) ? { TSX_TSCONFIG_PATH: repoTsconfig } : {}),
      ...extraEnv,
    },
  };
}
