import type {
  Action,
  ActionOutcome,
} from "@inspector/protocol";
import { newId } from "@inspector/protocol";
import type {
  ExplorationCheckpointRecord,
  Store,
} from "@inspector/store-sqlite";
import type { DiscoveredAnomaly } from "./anomaly.js";
import type { StateGraphSnapshot } from "./state.js";
import type { RngSnapshot } from "./rng.js";
import { strongHash } from "./rng.js";
import { StateGraph } from "./state.js";
import { restoreRng } from "./rng.js";

export const EXPLORATION_CHECKPOINT_SCHEMA = "inspector-exploration-checkpoint/1";
export const EXPLORATION_CHECKPOINT_VERSION = 1 as const;
export const EXPLORER_VERSION = "explorer/1";
export const EXPLORATION_CHECKPOINT_RETENTION = 8;

export type ExplorerKind = "web" | "native" | "fake";

export interface FindingOutcomeSnapshot {
  anomalyKey: string;
  classKey: string;
  outcome: string;
  detail?: string;
  findingId?: string;
}

export interface NativeCheckpointState {
  seen: string[];
  useCount: Array<[string, number]>;
  triedEdges: string[];
  plateau: number;
  segment: Action[];
  pendingEdge?: { fromState: string; actionKey: string };
}

export interface FakeCheckpointState {
  state: string;
  pendingFillIsBoundary: boolean;
  statesSeen: string[];
  segment: Action[];
}

/** M13 F7: semantic-planner continuity (optional; older checkpoints without
 * it remain valid and resume fully deterministic). */
export interface PlannerCheckpointState {
  calls: number;
  accepted: number;
  rejected: number;
  rejectedSuggestions: string[];
  actionsSinceCall: number;
  /** Accepted decision persisted before execution; consumed on next select. */
  pendingSuggestion?: string;
  /** M13 F12 advisory digest cache (never authoritative). */
  digest?: string;
  digestAtAction?: number;
}

export interface ExplorationCheckpointPayload {
  schema: typeof EXPLORATION_CHECKPOINT_SCHEMA;
  version: typeof EXPLORATION_CHECKPOINT_VERSION;
  runId: string;
  explorerKind: ExplorerKind;
  explorerVersion: string;
  adapter: string;
  seed: number;
  configFingerprint: string;
  rng: RngSnapshot;
  stepSequence: number;
  campaignStartedAt: string;
  actionsExecuted: number;
  resets: number;
  actionsSinceNewState: number;
  recentActionKeys: string[];
  toxicActionKeys: string[];
  rejectedActionKeys: string[];
  currentState: string;
  currentScreen: string;
  graph: StateGraphSnapshot;
  actionKindSequence: string[];
  actionPath: Action[];
  anomalies: DiscoveredAnomaly[];
  anomalyClassKeys: string[];
  processedFindingClassKeys: string[];
  findingOutcomes: FindingOutcomeSnapshot[];
  budget: {
    maxActions: number;
    maxResets: number;
    maxFindings: number;
    maxWallMs: number;
  };
  native?: NativeCheckpointState;
  fake?: FakeCheckpointState;
  planner?: PlannerCheckpointState;
}

export interface CheckpointIdentity {
  runId: string;
  explorerKind: ExplorerKind;
  explorerVersion: string;
  adapter: string;
  seed: number;
  configFingerprint: string;
}

/** Stable JSON for configuration identity and deterministic test fixtures. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function configFingerprint(config: unknown): string {
  return strongHash(stableJson(config));
}

export function writeCheckpoint(
  store: Store,
  payload: ExplorationCheckpointPayload,
): ExplorationCheckpointRecord {
  assertCheckpointPayload(payload);
  return store.writeExplorationCheckpoint({
    id: newId("checkpoint"),
    runId: payload.runId,
    schemaVersion: payload.version,
    explorerKind: payload.explorerKind,
    explorerVersion: payload.explorerVersion,
    stepSequence: payload.stepSequence,
    actionCount: payload.actionsExecuted,
    payload,
    retain: EXPLORATION_CHECKPOINT_RETENTION,
  });
}

export function loadLatestCheckpoint(
  store: Store,
  identity: CheckpointIdentity,
  expectedBudget?: ExplorationCheckpointPayload["budget"],
): ExplorationCheckpointPayload | null {
  const record = store.getLatestExplorationCheckpoint(identity.runId);
  if (!record) return null;
  if (
    record.schemaVersion !== EXPLORATION_CHECKPOINT_VERSION ||
    record.explorerKind !== identity.explorerKind ||
    record.explorerVersion !== identity.explorerVersion
  ) {
    throw new Error(
      `incompatible exploration checkpoint ${record.id}: expected ${identity.explorerKind}/${identity.explorerVersion} version ${EXPLORATION_CHECKPOINT_VERSION}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payloadJson);
  } catch {
    throw new Error(`malformed exploration checkpoint ${record.id}; refusing to resume`);
  }
  assertCheckpointPayload(parsed);
  if (
    parsed.runId !== identity.runId ||
    parsed.explorerKind !== identity.explorerKind ||
    parsed.explorerVersion !== identity.explorerVersion ||
    parsed.adapter !== identity.adapter ||
    parsed.seed !== identity.seed ||
    parsed.configFingerprint !== identity.configFingerprint
  ) {
    throw new Error(
      `exploration checkpoint ${record.id} does not match the requested run, adapter, seed, or configuration; refusing to resume`,
    );
  }
  if (expectedBudget && stableJson(parsed.budget) !== stableJson(expectedBudget)) {
    throw new Error(
      `exploration checkpoint ${record.id} has incompatible campaign budgets; refusing to resume`,
    );
  }
  if (record.stepSequence !== parsed.stepSequence || record.actionCount !== parsed.actionsExecuted) {
    throw new Error(`exploration checkpoint ${record.id} header/payload mismatch; refusing to resume`);
  }
  return parsed;
}

export function assertCheckpointPayload(value: unknown): asserts value is ExplorationCheckpointPayload {
  if (!isRecord(value) || value.schema !== EXPLORATION_CHECKPOINT_SCHEMA || value.version !== 1) {
    throw new Error("unsupported exploration checkpoint schema/version; refusing to resume");
  }
  if (!isExplorerKind(value.explorerKind) || typeof value.runId !== "string" || typeof value.adapter !== "string" || typeof value.explorerVersion !== "string") {
    throw new Error("invalid exploration checkpoint identity; refusing to resume");
  }
  if (!Number.isSafeInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffffffff || typeof value.configFingerprint !== "string") {
    throw new Error("invalid exploration checkpoint seed/configuration; refusing to resume");
  }
  if (typeof value.campaignStartedAt !== "string" || !Number.isFinite(Date.parse(value.campaignStartedAt))) {
    throw new Error("invalid exploration checkpoint campaign timestamp; refusing to resume");
  }
  for (const [key, allowZero] of [
    ["stepSequence", true],
    ["actionsExecuted", true],
    ["resets", true],
    ["actionsSinceNewState", true],
  ] as const) {
    integer(value[key], key, allowZero);
  }
  if (typeof value.currentState !== "string" || typeof value.currentScreen !== "string") {
    throw new Error("invalid current exploration state identity");
  }
  if (!Array.isArray(value.recentActionKeys) || !Array.isArray(value.toxicActionKeys) || !Array.isArray(value.rejectedActionKeys) || !Array.isArray(value.anomalyClassKeys) || !Array.isArray(value.processedFindingClassKeys)) {
    throw new Error("invalid exploration action/anomaly key collections");
  }
  for (const key of [...value.recentActionKeys, ...value.toxicActionKeys, ...value.rejectedActionKeys, ...value.anomalyClassKeys, ...value.processedFindingClassKeys]) {
    if (typeof key !== "string") throw new Error("invalid exploration key collection entry");
  }
  restoreRng(value.rng);
  StateGraph.fromSnapshot(value.graph);
  if (!Array.isArray(value.actionPath)) throw new Error("invalid exploration action path");
  if (!Array.isArray(value.actionKindSequence) || value.actionKindSequence.some((x) => typeof x !== "string")) throw new Error("invalid exploration action kind sequence");
  value.actionPath.forEach(assertAction);
  if (!Array.isArray(value.anomalies)) throw new Error("invalid exploration anomaly list");
  value.anomalies.forEach(assertAnomaly);
  if (!Array.isArray(value.findingOutcomes)) throw new Error("invalid exploration finding outcomes");
  value.findingOutcomes.forEach(assertFindingOutcome);
  assertBudget(value.budget);
  if (value.native !== undefined) assertNativeState(value.native);
  if (value.fake !== undefined) assertFakeState(value.fake);
  if (value.planner !== undefined) assertPlannerState(value.planner);
}

function assertPlannerState(value: unknown): asserts value is PlannerCheckpointState {
  if (!isRecord(value)) throw new Error("invalid exploration planner checkpoint state");
  for (const key of ["calls", "accepted", "rejected", "actionsSinceCall"] as const) {
    integer(value[key], `planner ${key}`, true);
  }
  if (!Array.isArray(value.rejectedSuggestions) || value.rejectedSuggestions.some((x) => typeof x !== "string")) {
    throw new Error("invalid planner rejectedSuggestions");
  }
  if (value.pendingSuggestion !== undefined && typeof value.pendingSuggestion !== "string") {
    throw new Error("invalid planner pendingSuggestion");
  }
  if (value.digest !== undefined && (typeof value.digest !== "string" || value.digest.length > 4000)) {
    throw new Error("invalid planner digest");
  }
  if (value.digestAtAction !== undefined) integer(value.digestAtAction, "planner digestAtAction", true);
}

function assertFakeState(value: unknown): asserts value is FakeCheckpointState {
  if (!isRecord(value) || typeof value.state !== "string" || typeof value.pendingFillIsBoundary !== "boolean" || !Array.isArray(value.statesSeen) || !Array.isArray(value.segment)) {
    throw new Error("invalid fake exploration checkpoint state");
  }
  value.statesSeen.forEach((x) => { if (typeof x !== "string") throw new Error("invalid fake seen state"); });
  value.segment.forEach(assertAction);
}

function assertNativeState(value: unknown): asserts value is NativeCheckpointState {
  if (!isRecord(value) || !Array.isArray(value.seen) || !Array.isArray(value.useCount) || !Array.isArray(value.triedEdges) || !Array.isArray(value.segment)) {
    throw new Error("invalid native exploration checkpoint state");
  }
  value.seen.forEach((x) => { if (typeof x !== "string") throw new Error("invalid native seen state"); });
  value.triedEdges.forEach((x) => { if (typeof x !== "string") throw new Error("invalid native tried edge"); });
  value.useCount.forEach((x) => {
    if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== "string") throw new Error("invalid native action use count");
    integer(x[1], "native action use count", true);
  });
  integer(value.plateau, "native plateau", true);
  value.segment.forEach(assertAction);
  if (value.pendingEdge !== undefined) {
    if (!isRecord(value.pendingEdge) || typeof value.pendingEdge.fromState !== "string" || typeof value.pendingEdge.actionKey !== "string") throw new Error("invalid native pending edge");
  }
}

function assertBudget(value: unknown): asserts value is ExplorationCheckpointPayload["budget"] {
  if (!isRecord(value)) throw new Error("invalid exploration budget");
  integer(value.maxActions, "maxActions", true);
  integer(value.maxResets, "maxResets", true);
  integer(value.maxFindings, "maxFindings", true);
  integer(value.maxWallMs, "maxWallMs", true);
}

function assertFindingOutcome(value: unknown): asserts value is FindingOutcomeSnapshot {
  if (!isRecord(value) || typeof value.anomalyKey !== "string" || typeof value.classKey !== "string" || typeof value.outcome !== "string") throw new Error("invalid exploration finding outcome");
  if (value.detail !== undefined && typeof value.detail !== "string") throw new Error("invalid exploration finding outcome detail");
  if (value.findingId !== undefined && typeof value.findingId !== "string") throw new Error("invalid exploration finding id");
}

function assertAnomaly(value: unknown): asserts value is DiscoveredAnomaly {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.classKey !== "string" || typeof value.kind !== "string" || typeof value.message !== "string" || typeof value.stateBefore !== "string" || !Array.isArray(value.actionPath)) {
    throw new Error("invalid exploration anomaly");
  }
  value.actionPath.forEach(assertAction);
  if (value.outcome !== undefined) assertActionOutcome(value.outcome);
  if (value.severityHint !== undefined && value.severityHint !== "high" && value.severityHint !== "medium" && value.severityHint !== "low") {
    throw new Error("invalid exploration anomaly severity");
  }
}

function assertAction(value: unknown): asserts value is Action {
  const risks = new Set(["observe", "interact", "mutate-test-state", "modify-source", "publish"]);
  const idempotencies = new Set(["safe-retry", "observe-before-retry", "never-retry"]);
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.runId !== "string" || typeof value.environmentId !== "string" || typeof value.kind !== "string" || typeof value.risk !== "string" || !risks.has(value.risk) || !Number.isSafeInteger(value.deadlineMs) || (value.deadlineMs as number) < 1 || typeof value.idempotency !== "string" || !idempotencies.has(value.idempotency)) {
    throw new Error("invalid serialized exploration action");
  }
  if (value.input !== undefined && value.input !== null && !isRecord(value.input)) throw new Error("invalid serialized exploration action input");
  if (value.metadata !== undefined && !isRecord(value.metadata)) throw new Error("invalid serialized exploration action metadata");
}

function assertActionOutcome(value: unknown): asserts value is ActionOutcome {
  if (!isRecord(value) || typeof value.actionId !== "string" || typeof value.runId !== "string" || typeof value.environmentId !== "string" || typeof value.status !== "string" || typeof value.observedAt !== "string") {
    throw new Error("invalid serialized exploration action outcome");
  }
}

function integer(value: unknown, label: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) throw new Error(`invalid exploration ${label}`);
}

function isExplorerKind(value: unknown): value is ExplorerKind {
  return value === "web" || value === "native" || value === "fake";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
