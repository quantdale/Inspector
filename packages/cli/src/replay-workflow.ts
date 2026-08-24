/**
 * Compatibility layer: the replay subject/driver machinery moved to
 * @inspector/workflows so interactive commands and fleet executors share one
 * implementation. Public exports are preserved unchanged.
 */
export {
  ensureReplayDir,
  loadReplaySubject,
  regressionScenarioKey,
  replayDriverFor,
  WorkflowProvenanceError,
  type LoadedReplaySubject,
  type WorkflowClassification,
} from "@inspector/workflows";
