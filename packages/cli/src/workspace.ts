/**
 * Compatibility layer: the workspace/spawn helpers moved to
 * @inspector/workflows so both interactive commands and fleet executors share
 * one implementation. Public re-exports are preserved for library consumers.
 */
export {
  adapterSpawn,
  isRepoRoot,
  openWorkspace,
  remapWorkspaceConflict,
  resolveWorkspaceDir,
  REPO_ROOT_WARNING,
  workspaceDirFrom,
  type AdapterSpawnSpec,
  type Workspace,
} from "@inspector/workflows";
