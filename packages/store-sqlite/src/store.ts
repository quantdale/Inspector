import type { Database } from "better-sqlite3";
import { createHash } from "node:crypto";
import { openStore } from "./migrations.js";

export type ActionStatus =
  | "pending"
  | "success"
  | "target-failure"
  | "adapter-crash"
  | "cancelled"
  | "deadline-exceeded"
  | "unknown";

export type StepStatus = "created" | "committed" | "failed";

export interface RunRecord {
  id: string;
  created_at: string;
  status: string;
  adapter: string | null;
  policy_json: string | null;
  meta_json: string | null;
}

export interface EnvironmentRecord {
  id: string;
  run_id: string;
  adapter: string;
  created_at: string;
  status: string;
  create_options: string | null;
  spawn_env: string | null;
}

export interface ActionRecord {
  id: string;
  run_id: string;
  environment_id: string;
  kind: string;
  risk: string;
  deadline_ms: number;
  idempotency: string;
  status: ActionStatus;
  requested_at: string;
  decided_at: string | null;
  error_code: string | null;
  error_json: string | null;
  state_after: string | null;
  step_id: string | null;
  metadata_json: string | null;
}

export interface ObservationRecord {
  id: string;
  run_id: string;
  environment_id: string;
  step_id: string | null;
  sequence: number;
  source: string;
  captured_at: string;
  summary_json: string;
}

export interface CheckpointRecord {
  id: string;
  runId: string;
  stepId: string | null;
  createdAt: string;
  payload_json: string;
}

export interface ExplorationCampaignRecord {
  runId: string;
  schemaVersion: number;
  explorerKind: string;
  explorerVersion: string;
  adapter: string;
  configJson: string;
  createdAt: string;
  status: string;
}

export interface ExplorationCheckpointRecord {
  id: string;
  runId: string;
  schemaVersion: number;
  explorerKind: string;
  explorerVersion: string;
  stepSequence: number;
  actionCount: number;
  createdAt: string;
  payloadJson: string;
  payloadSha256: string;
}

export type ExplorationEventStatus = "pending" | "committed" | "unknown";

export interface ExplorationEventRecord {
  id: string;
  runId: string;
  kind: string;
  status: ExplorationEventStatus;
  stepSequence: number;
  createdAt: string;
  resolvedAt: string | null;
  payloadJson: string;
}

export interface CommittedActionRecord {
  action: ActionRecord;
  stepSequence: number;
}

export type FindingStatus =
  | "OBSERVED"
  | "CANDIDATE"
  | "REPRODUCING"
  | "MINIMIZED"
  | "CONFIRMED"
  | "PATCHING"
  | "VERIFYING"
  | "RESOLVED"
  | "REGRESSED"
  | "REJECTED"
  | "FLAKY"
  | "NEEDS_HUMAN_ORACLE";

export interface FindingRecord {
  id: string;
  runId: string | null;
  status: FindingStatus;
  title: string;
  confidence: number;
  severity: string | null;
  revision: string | null;
  oracleIds: string | null;
  reproductionJson: string | null;
  artifactRefs: string | null;
  createdAt: string;
  updatedAt: string;
  /** Wave-1 finding extensions; null for rows written before the columns existed. */
  signature: string | null;
  minimizationJson: string | null;
  lastTransitionJson: string | null;
  adapter: string | null;
  /** Exploration anomaly class; null for findings created outside a hunt. */
  classKey?: string | null;
}

export type WorkflowRecordStatus = "running" | "completed" | "failed";

export interface VerificationRecord {
  id: string;
  findingId: string;
  runId: string | null;
  adapter: string;
  revision: string | null;
  status: WorkflowRecordStatus;
  classification: string;
  attempts: number;
  successes: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
  resultJson: string | null;
  artifactPath: string | null;
}

export interface RegressionRecord {
  id: string;
  scenarioKey: string;
  findingId: string;
  runId: string | null;
  adapter: string;
  revision: string | null;
  status: WorkflowRecordStatus;
  classification: string;
  attempts: number;
  successes: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
  resultJson: string | null;
  artifactPath: string | null;
}

export interface RepairWorkflowRecord {
  id: string;
  findingId: string;
  repoRoot: string;
  revision: string;
  status: WorkflowRecordStatus;
  outcome: string;
  startedAt: string;
  completedAt: string | null;
  resultJson: string | null;
  artifactPath: string | null;
}

/**
 * One oracle's outcome for a single evaluation event. Persisted per
 * docs/ORACLE-SYSTEM.md so evidence bundles and campaign provenance can
 * reconstruct which oracles ran, what they saw, and why a finding was
 * promoted. `oracle_class` is nullable: the codebase only carries
 * kind/strength today; class is populated from kind where unambiguous.
 */
export interface OracleEvaluationRecord {
  id: string;
  runId: string | null;
  stepId: string | null;
  findingId: string | null;
  /** Replay subject key when no finding exists yet (e.g. baseline evals). */
  subjectKey: string | null;
  phase: "reproduce" | "minimize" | "repair-verify";
  oracleId: string;
  oracleKind: string | null;
  oracleStrength: string | null;
  oracleClass: string | null;
  reproduced: boolean;
  confidence: number | null;
  expected: string | null;
  observed: string | null;
  explanation: string | null;
  version: string;
  createdAt: string;
}

/** Raised when a second unresolved action tries to claim an idempotency key
 * that is already held by a pending/unknown action. */
export class DuplicateActionIdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateActionIdempotencyError";
  }
}

export interface StepBundle {
  step: {
    id: string;
    sequence: number;
    actionId: string | null;
    status: StepStatus;
  };
  action: ActionRecord | null;
  observations: Array<
    ObservationRecord & {
      artifacts: Array<{
        sha256: string;
        mime: string;
        size: number;
        path: string;
      }>;
    }
  >;
}

/** Maps snake_case findings columns onto the camelCase FindingRecord shape. */
const FINDING_SELECT = `SELECT id, run_id AS runId, status, title, confidence, severity, revision,
  oracle_ids AS oracleIds, reproduction_json AS reproductionJson, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt, signature,
  minimization_json AS minimizationJson, last_transition_json AS lastTransitionJson, adapter
  , class_key AS classKey
  FROM findings`;

export class Store {
  constructor(private readonly db: Database) {}

  static open(path: string): Store {
    return new Store(openStore(path));
  }

  get raw(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  createRun(input: {
    id: string;
    adapter?: string;
    policy?: unknown;
    meta?: unknown;
  }): RunRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs(id, created_at, status, adapter, policy_json, meta_json)
         VALUES(?, ?, 'created', ?, ?, ?)`,
      )
      .run(
        input.id,
        now,
        input.adapter ?? null,
        input.policy ? JSON.stringify(input.policy) : null,
        input.meta ? JSON.stringify(input.meta) : null,
      );
    return this.getRun(input.id)!;
  }

  /** Register the immutable explorer contract before the first action. */
  createExplorationCampaign(input: {
    runId: string;
    schemaVersion: number;
    explorerKind: string;
    explorerVersion: string;
    adapter: string;
    config: unknown;
    createdAt?: string;
  }): ExplorationCampaignRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO exploration_campaigns(
           run_id, schema_version, explorer_kind, explorer_version, adapter,
           config_json, created_at, status
         ) VALUES(?, ?, ?, ?, ?, ?, ?, 'running')`,
      )
      .run(
        input.runId,
        input.schemaVersion,
        input.explorerKind,
        input.explorerVersion,
        input.adapter,
        JSON.stringify(input.config),
        createdAt,
      );
    return this.getExplorationCampaign(input.runId)!;
  }

  getExplorationCampaign(runId: string): ExplorationCampaignRecord | undefined {
    return this.db
      .prepare(
        `SELECT run_id AS runId, schema_version AS schemaVersion,
           explorer_kind AS explorerKind, explorer_version AS explorerVersion,
           adapter, config_json AS configJson, created_at AS createdAt, status
         FROM exploration_campaigns WHERE run_id = ?`,
      )
      .get(runId) as ExplorationCampaignRecord | undefined;
  }

  setExplorationCampaignStatus(runId: string, status: string): void {
    this.db
      .prepare(`UPDATE exploration_campaigns SET status = ? WHERE run_id = ?`)
      .run(status, runId);
  }

  getRun(id: string): RunRecord | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | RunRecord
      | undefined;
  }

  listRuns(limit = 100): RunRecord[] {
    return this.db
      .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as RunRecord[];
  }

  setRunStatus(id: string, status: string): void {
    this.db.prepare(`UPDATE runs SET status = ? WHERE id = ?`).run(status, id);
  }

  createEnvironment(input: {
    id: string;
    runId: string;
    adapter: string;
    /** Durable resume spec: lifecycle-create options for a fresh process. */
    createOptions?: Record<string, unknown>;
    /** Durable resume spec: adapter spawn-env delta (never full env). */
    spawnEnv?: NodeJS.ProcessEnv;
  }): EnvironmentRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO environments(id, run_id, adapter, created_at, status, create_options, spawn_env)
         VALUES(?, ?, ?, ?, 'created', ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.adapter,
        now,
        input.createOptions ? JSON.stringify(input.createOptions) : null,
        input.spawnEnv ? JSON.stringify(input.spawnEnv) : null,
      );
    return this.getEnvironment(input.id)!;
  }

  /** The environment row for a run (resume reads the durable create spec). */
  getEnvironmentForRun(runId: string): EnvironmentRecord | undefined {
    return this.db
      .prepare(`SELECT * FROM environments WHERE run_id = ? ORDER BY created_at LIMIT 1`)
      .get(runId) as EnvironmentRecord | undefined;
  }

  getEnvironment(id: string): EnvironmentRecord | undefined {
    return this.db.prepare(`SELECT * FROM environments WHERE id = ?`).get(id) as
      | EnvironmentRecord
      | undefined;
  }

  /**
   * Atomically commit a step: the action request, its final outcome, and all
   * observations are written in one transaction so a crash cannot leave the
   * step half-committed.
   */
  commitStep(input: {
    stepId: string;
    runId: string;
    environmentId: string;
    sequence: number;
    action: {
      id: string;
      kind: string;
      risk: string;
      deadlineMs: number;
      idempotency: string;
      status: ActionStatus;
      stateAfter?: string | null;
      errorCode?: string | null;
      error?: unknown | null;
      metadata?: unknown | null;
    };
    observations: Array<{
      id: string;
      stepId: string | null;
      sequence: number;
      source: string;
      capturedAt: string;
      summary: unknown;
      artifacts?: Array<{
        sha256: string;
        mime: string;
        size: number;
        path: string;
      }>;
    }>;
  }): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO steps(id, run_id, environment_id, sequence, action_id, status, created_at)
           VALUES(?, ?, ?, ?, ?, 'committed', ?)`,
        )
        .run(
          input.stepId,
          input.runId,
          input.environmentId,
          input.sequence,
          input.action.id,
          new Date().toISOString(),
        );

      this.db
        .prepare(
          `INSERT INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
           status, requested_at, decided_at, error_code, error_json, state_after, step_id, metadata_json)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             decided_at = excluded.decided_at,
             error_code = excluded.error_code,
             error_json = excluded.error_json,
              state_after = excluded.state_after,
              step_id = excluded.step_id,
              metadata_json = excluded.metadata_json`,
        )
        .run(
          input.action.id,
          input.runId,
          input.environmentId,
          input.action.kind,
          input.action.risk,
          input.action.deadlineMs,
          input.action.idempotency,
          input.action.status,
          new Date().toISOString(),
          new Date().toISOString(),
          input.action.errorCode ?? null,
          input.action.error ? JSON.stringify(input.action.error) : null,
          input.action.stateAfter ?? null,
          input.stepId,
          input.action.metadata ? JSON.stringify(input.action.metadata) : null,
        );

      const insertObs = this.db.prepare(
        `INSERT INTO observations(id, run_id, environment_id, step_id, sequence, source, captured_at, summary_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertArtifact = this.db.prepare(
        `INSERT INTO observation_artifacts(observation_id, sha256, mime, size, path)
         VALUES(?, ?, ?, ?, ?)`,
      );
      for (const o of input.observations) {
        insertObs.run(
          o.id,
          input.runId,
          input.environmentId,
          o.stepId ?? null,
          o.sequence,
          o.source,
          o.capturedAt,
          JSON.stringify(o.summary),
        );
        for (const a of o.artifacts ?? []) {
          insertArtifact.run(o.id, a.sha256, a.mime, a.size, a.path);
        }
      }
    });
    tx();
  }

  /**
   * Insert an action that has been requested but not yet decided (in-flight).
   * Idempotent: re-inserting a known action id returns the existing row
   * instead of crashing on the primary key, so an adapter error followed by a
   * resubmission can never escape as SQLITE_CONSTRAINT. A *different* action
   * claiming an idempotency key that is already held by a pending/unknown
   * action raises DuplicateActionIdempotencyError.
   */
  insertPendingAction(input: {
    id: string;
    runId: string;
    environmentId: string;
    kind: string;
    risk: string;
    deadlineMs: number;
    idempotency: string;
    stepId?: string | null;
    metadata?: unknown | null;
  }): { inserted: boolean; existing: ActionRecord | null } {
    const existing = this.getAction(input.id);
    if (existing) return { inserted: false, existing };
    try {
      this.db
        .prepare(
          `INSERT INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
             status, requested_at, step_id, metadata_json)
           VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          input.id,
          input.runId,
          input.environmentId,
          input.kind,
          input.risk,
          input.deadlineMs,
          input.idempotency,
          new Date().toISOString(),
          input.stepId ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
        );
      return { inserted: true, existing: null };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("idx_actions_pending_idempotency") ||
          err.message.includes("UNIQUE constraint failed: actions.idempotency"))
      ) {
        throw new DuplicateActionIdempotencyError(
          `idempotency key '${input.idempotency}' is already held by an unresolved action in run ${input.runId}`,
        );
      }
      throw err;
    }
  }

  finalizeAction(
    id: string,
    outcome: {
      status: ActionStatus;
      stateAfter?: string | null;
      errorCode?: string | null;
      error?: unknown | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE actions SET status = ?, decided_at = ?, state_after = ?, error_code = ?, error_json = ?
         WHERE id = ?`,
      )
      .run(
        outcome.status,
        new Date().toISOString(),
        outcome.stateAfter ?? null,
        outcome.errorCode ?? null,
        outcome.error ? JSON.stringify(outcome.error) : null,
        id,
      );
  }

  getAction(id: string): ActionRecord | undefined {
    return this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as
      | ActionRecord
      | undefined;
  }

  /**
   * On restart, any action still in `pending` state means the adapter response
   * was never persisted (adapter loss / crash). Mark these `unknown` so the
   * core re-observes/resets instead of blindly retrying. Only NEWLY lost
   * actions are returned: actions already marked `unknown` by an earlier
   * recovery pass stay untouched, so repeated resumes cannot multiply
   * synthetic recovery observations.
   */
  markInFlightUnknown(runId: string): ActionRecord[] {
    const newlyLost = this.db
      .prepare(
        `SELECT * FROM actions WHERE run_id = ? AND status = 'pending' ORDER BY requested_at`,
      )
      .all(runId) as ActionRecord[];
    const tx = this.db.transaction((ids: string[]) => {
      const stmt = this.db.prepare(
        `UPDATE actions SET status = 'unknown', decided_at = ? WHERE id = ?`,
      );
      for (const id of ids) stmt.run(new Date().toISOString(), id);
    });
    tx(newlyLost.map((a) => a.id));
    return newlyLost;
  }

  getInFlightActions(runId: string): ActionRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM actions WHERE run_id = ? AND status IN ('pending', 'unknown') ORDER BY requested_at`,
      )
      .all(runId) as ActionRecord[];
  }

  /** Number of actions ever admitted for a run, regardless of outcome. Used
   * to re-derive the max_actions budget from durable state after a restart. */
  countRunActions(runId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM actions WHERE run_id = ?`)
      .get(runId) as { c: number };
    return row.c;
  }

  /** Actions whose committed step is newer than an explorer snapshot. */
  listCommittedActionsAfterStep(runId: string, stepSequence: number): CommittedActionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, s.sequence AS stepSequence
         FROM actions a JOIN steps s ON s.action_id = a.id
         WHERE a.run_id = ? AND s.sequence > ?
         ORDER BY s.sequence`,
      )
      .all(runId, stepSequence) as Array<ActionRecord & { stepSequence: number }>;
    return rows.map(({ stepSequence: sequence, ...action }) => ({
      action,
      stepSequence: sequence,
    }));
  }

  /** Reset/event records are durable budget admissions, including pending ones. */
  listExplorationEvents(runId: string, kind?: string): ExplorationEventRecord[] {
    const where = kind === undefined ? "" : " AND kind = ?";
    const params = kind === undefined ? [runId] : [runId, kind];
    return this.db
      .prepare(
        `SELECT id, run_id AS runId, kind, status, step_sequence AS stepSequence,
           created_at AS createdAt, resolved_at AS resolvedAt, payload_json AS payloadJson
         FROM exploration_events WHERE run_id = ?${where} ORDER BY created_at, rowid`,
      )
      .all(...params) as ExplorationEventRecord[];
  }

  appendExplorationEvent(input: {
    id: string;
    runId: string;
    kind: string;
    status: ExplorationEventStatus;
    stepSequence: number;
    payload: unknown;
  }): ExplorationEventRecord {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO exploration_events(
           id, run_id, kind, status, step_sequence, created_at, payload_json
         ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.kind,
        input.status,
        input.stepSequence,
        createdAt,
        JSON.stringify(input.payload),
      );
    return this.db
      .prepare(
        `SELECT id, run_id AS runId, kind, status, step_sequence AS stepSequence,
           created_at AS createdAt, resolved_at AS resolvedAt, payload_json AS payloadJson
         FROM exploration_events WHERE id = ?`,
      )
      .get(input.id) as ExplorationEventRecord;
  }

  resolveExplorationEvent(id: string, status: ExplorationEventStatus): void {
    this.db
      .prepare(
        `UPDATE exploration_events SET status = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), id);
  }

  countExplorationEvents(
    runId: string,
    kind: string,
    statuses: ExplorationEventStatus[] = ["pending", "committed", "unknown"],
  ): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => "?").join(",");
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM exploration_events
         WHERE run_id = ? AND kind = ? AND status IN (${placeholders})`,
      )
      .get(runId, kind, ...statuses) as { c: number };
    return row.c;
  }

  writeExplorationCheckpoint(input: {
    id: string;
    runId: string;
    schemaVersion: number;
    explorerKind: string;
    explorerVersion: string;
    stepSequence: number;
    actionCount: number;
    payload: unknown;
    retain?: number;
  }): ExplorationCheckpointRecord {
    const payloadJson = JSON.stringify(input.payload);
    const payloadSha256 = createHash("sha256").update(payloadJson).digest("hex");
    const createdAt = new Date().toISOString();
    const retain = Math.max(1, Math.floor(input.retain ?? 8));
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO exploration_checkpoints(
             id, run_id, schema_version, explorer_kind, explorer_version,
             step_sequence, action_count, created_at, payload_json, payload_sha256
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.runId,
          input.schemaVersion,
          input.explorerKind,
          input.explorerVersion,
          input.stepSequence,
          input.actionCount,
          createdAt,
          payloadJson,
          payloadSha256,
        );
      this.db
        .prepare(
          `DELETE FROM exploration_checkpoints
           WHERE run_id = ? AND rowid NOT IN (
             SELECT rowid FROM exploration_checkpoints
             WHERE run_id = ? ORDER BY rowid DESC LIMIT ?
           )`,
        )
        .run(input.runId, input.runId, retain);
    });
    tx();
    return this.getExplorationCheckpoint(input.id)!;
  }

  getExplorationCheckpoint(id: string): ExplorationCheckpointRecord | undefined {
    const record = this.db
      .prepare(
        `SELECT id, run_id AS runId, schema_version AS schemaVersion,
           explorer_kind AS explorerKind, explorer_version AS explorerVersion,
           step_sequence AS stepSequence, action_count AS actionCount,
           created_at AS createdAt, payload_json AS payloadJson,
           payload_sha256 AS payloadSha256
         FROM exploration_checkpoints WHERE id = ?`,
      )
      .get(id) as ExplorationCheckpointRecord | undefined;
    if (record) this.assertExplorationCheckpointChecksum(record);
    return record;
  }

  getLatestExplorationCheckpoint(runId: string): ExplorationCheckpointRecord | undefined {
    const record = this.db
      .prepare(
        `SELECT id, run_id AS runId, schema_version AS schemaVersion,
           explorer_kind AS explorerKind, explorer_version AS explorerVersion,
           step_sequence AS stepSequence, action_count AS actionCount,
           created_at AS createdAt, payload_json AS payloadJson,
           payload_sha256 AS payloadSha256
         FROM exploration_checkpoints WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(runId) as ExplorationCheckpointRecord | undefined;
    if (record) this.assertExplorationCheckpointChecksum(record);
    return record;
  }

  countExplorationCheckpoints(runId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM exploration_checkpoints WHERE run_id = ?`)
      .get(runId) as { c: number };
    return row.c;
  }

  private assertExplorationCheckpointChecksum(record: ExplorationCheckpointRecord): void {
    const actual = createHash("sha256").update(record.payloadJson).digest("hex");
    if (actual !== record.payloadSha256) {
      throw new Error(
        `exploration checkpoint ${record.id} checksum mismatch; refusing to resume`,
      );
    }
  }

  /** Highest durably committed step sequence for a run (0 when none). The
   * authoritative floor for the next sequence number after a restart: the
   * checkpoint payload can lag the last committed step when a process dies
   * between the step transaction and the checkpoint write, and reusing a
   * persisted sequence violates UNIQUE(steps.run_id, steps.sequence). */
  maxRunStepSequence(runId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(sequence) AS m FROM steps WHERE run_id = ?`)
      .get(runId) as { m: number | null };
    return row.m ?? 0;
  }

  /** True when an observation with this id is already persisted. */
  observationExists(id: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM observations WHERE id = ?`).get(id) !==
      undefined
    );
  }

  setEnvironmentStatus(id: string, status: string): void {
    this.db
      .prepare(`UPDATE environments SET status = ? WHERE id = ?`)
      .run(status, id);
  }

  /** Record the adapter's self-reported identity on its run and environment
   * rows once initialize has answered. The exploration campaign identity is
   * updated in the same transaction so a crash between adapter negotiation
   * and explorer startup cannot leave two conflicting provenance records. */
  recordAdapterIdentity(runId: string, envId: string, adapter: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE runs SET adapter = ? WHERE id = ?`)
        .run(adapter, runId);
      this.db
        .prepare(`UPDATE environments SET adapter = ? WHERE id = ?`)
        .run(adapter, envId);
      this.db
        .prepare(`UPDATE exploration_campaigns SET adapter = ? WHERE run_id = ?`)
        .run(adapter, runId);
    });
    tx();
  }

  writeCheckpoint(input: {
    id: string;
    runId: string;
    stepId?: string | null;
    payload: unknown;
  }): CheckpointRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.stepId ?? null,
        now,
        JSON.stringify(input.payload),
      );
    return this.db
      .prepare(`SELECT * FROM checkpoints WHERE id = ?`)
      .get(input.id) as CheckpointRecord;
  }

  getLatestCheckpoint(runId: string): CheckpointRecord | undefined {
    // rowid order breaks ties between checkpoints written within the same
    // millisecond; ordering by created_at alone could restore a stale
    // stepSeq and violate UNIQUE(run_id, sequence) on the next commit.
    return this.db
      .prepare(
        `SELECT * FROM checkpoints WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(runId) as CheckpointRecord | undefined;
  }

  getCheckpoint(id: string): CheckpointRecord | undefined {
    return this.db.prepare(`SELECT * FROM checkpoints WHERE id = ?`).get(id) as
      | CheckpointRecord
      | undefined;
  }

  getStepObservations(
    stepId: string,
  ): Array<
    ObservationRecord & {
      artifacts: Array<{
        sha256: string;
        mime: string;
        size: number;
        path: string;
      }>;
    }
  > {
    const obs = this.db
      .prepare(`SELECT * FROM observations WHERE step_id = ? ORDER BY sequence`)
      .all(stepId) as ObservationRecord[];
    const getArtifacts = this.db.prepare(
      `SELECT sha256, mime, size, path FROM observation_artifacts WHERE observation_id = ?`,
    );
    return obs.map((o) => ({
      ...o,
      artifacts: getArtifacts.all(o.id) as Array<{
        sha256: string;
        mime: string;
        size: number;
        path: string;
      }>,
    }));
  }

  /** Commit a step that only records observations (no action). */
  commitObservationStep(input: {
    stepId: string;
    runId: string;
    environmentId: string;
    sequence: number;
    observations: Array<{
      id: string;
      stepId: string | null;
      sequence: number;
      source: string;
      capturedAt: string;
      summary: unknown;
      artifacts?: Array<{
        sha256: string;
        mime: string;
        size: number;
        path: string;
      }>;
    }>;
  }): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO steps(id, run_id, environment_id, sequence, action_id, status, created_at)
           VALUES(?, ?, ?, ?, NULL, 'committed', ?)`,
        )
        .run(
          input.stepId,
          input.runId,
          input.environmentId,
          input.sequence,
          new Date().toISOString(),
        );
      const insertObs = this.db.prepare(
        `INSERT INTO observations(id, run_id, environment_id, step_id, sequence, source, captured_at, summary_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertArtifact = this.db.prepare(
        `INSERT INTO observation_artifacts(observation_id, sha256, mime, size, path)
         VALUES(?, ?, ?, ?, ?)`,
      );
      for (const o of input.observations) {
        insertObs.run(
          o.id,
          input.runId,
          input.environmentId,
          o.stepId ?? null,
          o.sequence,
          o.source,
          o.capturedAt,
          JSON.stringify(o.summary),
        );
        for (const a of o.artifacts ?? []) {
          insertArtifact.run(o.id, a.sha256, a.mime, a.size, a.path);
        }
      }
    });
    tx();
  }

  getRunSteps(runId: string): StepBundle[] {
    const steps = this.db
      .prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY sequence`)
      .all(runId) as Array<{
      id: string;
      run_id: string;
      environment_id: string;
      sequence: number;
      action_id: string | null;
      status: StepStatus;
      created_at: string;
    }>;
    return steps.map((s) => {
      const action = s.action_id
        ? (this.db
            .prepare(`SELECT * FROM actions WHERE id = ?`)
            .get(s.action_id) as ActionRecord)
        : null;
      return {
        step: {
          id: s.id,
          sequence: s.sequence,
          actionId: s.action_id,
          status: s.status,
        },
        action,
        observations: this.getStepObservations(s.id),
      };
    });
  }

  putFinding(f: FindingRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO findings(id, run_id, status, title, confidence, severity, revision,
           oracle_ids, reproduction_json, artifact_refs, created_at, updated_at,
           signature, minimization_json, last_transition_json, adapter, class_key)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           title = excluded.title,
           confidence = excluded.confidence,
           severity = excluded.severity,
           revision = excluded.revision,
           oracle_ids = excluded.oracle_ids,
           reproduction_json = excluded.reproduction_json,
           artifact_refs = excluded.artifact_refs,
           signature = excluded.signature,
           minimization_json = excluded.minimization_json,
           last_transition_json = excluded.last_transition_json,
           adapter = excluded.adapter,
           class_key = excluded.class_key,
           updated_at = excluded.updated_at`,
      )
      .run(
        f.id,
        f.runId,
        f.status,
        f.title,
        f.confidence,
        f.severity,
        f.revision,
        f.oracleIds,
        f.reproductionJson,
        f.artifactRefs,
        f.createdAt,
        now,
        f.signature,
        f.minimizationJson,
        f.lastTransitionJson,
        f.adapter,
        f.classKey ?? null,
      );
  }

  getFinding(id: string): FindingRecord | undefined {
    return this.db.prepare(`${FINDING_SELECT} WHERE id = ?`).get(id) as
      | FindingRecord
      | undefined;
  }

  listFindings(limit = 100): FindingRecord[] {
    return this.db
      .prepare(`${FINDING_SELECT} ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as FindingRecord[];
  }

  putVerificationRecord(record: VerificationRecord): void {
    this.db
      .prepare(
        `INSERT INTO verification_records(
           id, finding_id, run_id, adapter, revision, status, classification,
           attempts, successes, errors, started_at, completed_at, result_json,
           artifact_path
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           classification = excluded.classification,
           attempts = excluded.attempts,
           successes = excluded.successes,
           errors = excluded.errors,
           completed_at = excluded.completed_at,
           result_json = excluded.result_json,
           artifact_path = excluded.artifact_path`,
      )
      .run(
        record.id,
        record.findingId,
        record.runId,
        record.adapter,
        record.revision,
        record.status,
        record.classification,
        record.attempts,
        record.successes,
        record.errors,
        record.startedAt,
        record.completedAt,
        record.resultJson,
        record.artifactPath,
      );
  }

  private selectVerificationRecords(where: string): string {
    return `SELECT id, finding_id AS findingId, run_id AS runId, adapter,
      revision, status, classification, attempts, successes, errors,
      started_at AS startedAt, completed_at AS completedAt,
      result_json AS resultJson, artifact_path AS artifactPath
      FROM verification_records ${where}`;
  }

  listVerificationRecords(findingId?: string, limit = 100): VerificationRecord[] {
    if (findingId === undefined) {
      return this.db
        .prepare(`${this.selectVerificationRecords(" ")} ORDER BY started_at DESC LIMIT ?`)
        .all(limit) as VerificationRecord[];
    }
    return this.db
      .prepare(`${this.selectVerificationRecords("WHERE finding_id = ?")} ORDER BY started_at DESC LIMIT ?`)
      .all(findingId, limit) as VerificationRecord[];
  }

  getLatestVerificationRecord(findingId: string): VerificationRecord | undefined {
    return this.db
      .prepare(`${this.selectVerificationRecords("WHERE finding_id = ?")} ORDER BY started_at DESC LIMIT 1`)
      .get(findingId) as VerificationRecord | undefined;
  }

  putRegressionRecord(record: RegressionRecord): void {
    this.db
      .prepare(
        `INSERT INTO regression_records(
           id, scenario_key, finding_id, run_id, adapter, revision, status,
           classification, attempts, successes, errors, started_at,
           completed_at, result_json, artifact_path
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scenario_key) DO UPDATE SET
           status = excluded.status,
           classification = excluded.classification,
           attempts = excluded.attempts,
           successes = excluded.successes,
           errors = excluded.errors,
           completed_at = excluded.completed_at,
           result_json = excluded.result_json,
           artifact_path = excluded.artifact_path`,
      )
      .run(
        record.id,
        record.scenarioKey,
        record.findingId,
        record.runId,
        record.adapter,
        record.revision,
        record.status,
        record.classification,
        record.attempts,
        record.successes,
        record.errors,
        record.startedAt,
        record.completedAt,
        record.resultJson,
        record.artifactPath,
      );
  }

  private selectRegressionRecords(where: string): string {
    return `SELECT id, scenario_key AS scenarioKey, finding_id AS findingId,
      run_id AS runId, adapter, revision, status, classification, attempts,
      successes, errors, started_at AS startedAt, completed_at AS completedAt,
      result_json AS resultJson, artifact_path AS artifactPath
      FROM regression_records ${where}`;
  }

  listRegressionRecords(filters: {
    runId?: string;
    findingId?: string;
    adapter?: string;
    revision?: string;
    limit?: number;
  } = {}): RegressionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.runId !== undefined) { clauses.push("run_id = ?"); params.push(filters.runId); }
    if (filters.findingId !== undefined) { clauses.push("finding_id = ?"); params.push(filters.findingId); }
    if (filters.adapter !== undefined) { clauses.push("adapter = ?"); params.push(filters.adapter); }
    if (filters.revision !== undefined) { clauses.push("revision = ?"); params.push(filters.revision); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(filters.limit ?? 1000);
    return this.db
      .prepare(`${this.selectRegressionRecords(where)} ORDER BY started_at DESC LIMIT ?`)
      .all(...params) as RegressionRecord[];
  }

  getRegressionRecordByScenarioKey(scenarioKey: string): RegressionRecord | undefined {
    return this.db
      .prepare(`${this.selectRegressionRecords("WHERE scenario_key = ?")}`)
      .get(scenarioKey) as RegressionRecord | undefined;
  }

  putRepairWorkflowRecord(record: RepairWorkflowRecord): void {
    this.db
      .prepare(
        `INSERT INTO repair_records(
           id, finding_id, repo_root, revision, status, outcome, started_at,
           completed_at, result_json, artifact_path
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           outcome = excluded.outcome,
           completed_at = excluded.completed_at,
           result_json = excluded.result_json,
           artifact_path = excluded.artifact_path`,
      )
      .run(
        record.id,
        record.findingId,
        record.repoRoot,
        record.revision,
        record.status,
        record.outcome,
        record.startedAt,
        record.completedAt,
        record.resultJson,
        record.artifactPath,
      );
  }

  listRepairWorkflowRecords(findingId?: string, limit = 100): RepairWorkflowRecord[] {
    const where = findingId === undefined ? "" : "WHERE finding_id = ?";
    const params = findingId === undefined ? [limit] : [findingId, limit];
    return this.db
      .prepare(
        `SELECT id, finding_id AS findingId, repo_root AS repoRoot, revision,
           status, outcome, started_at AS startedAt, completed_at AS completedAt,
           result_json AS resultJson, artifact_path AS artifactPath
         FROM repair_records ${where} ORDER BY started_at DESC LIMIT ?`,
      )
      .all(...params) as RepairWorkflowRecord[];
  }

  getRepairWorkflowRecord(id: string): RepairWorkflowRecord | undefined {
    return this.db
      .prepare(
        `SELECT id, finding_id AS findingId, repo_root AS repoRoot, revision,
           status, outcome, started_at AS startedAt, completed_at AS completedAt,
           result_json AS resultJson, artifact_path AS artifactPath
         FROM repair_records WHERE id = ?`,
      )
      .get(id) as RepairWorkflowRecord | undefined;
  }

  getFindingByClassKey(runId: string, classKey: string): FindingRecord | undefined {
    return this.db
      .prepare(`${FINDING_SELECT} WHERE run_id = ? AND class_key = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(runId, classKey) as FindingRecord | undefined;
  }

  /** Append one oracle evaluation record. Insert-only: evaluation history is
   * immutable evidence and is never updated in place. */
  putOracleEvaluation(r: OracleEvaluationRecord): void {
    this.db
      .prepare(
        `INSERT INTO oracle_evaluations(id, run_id, step_id, finding_id, subject_key, phase,
           oracle_id, oracle_kind, oracle_strength, oracle_class, reproduced, confidence,
           expected, observed, explanation, version, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.runId,
        r.stepId,
        r.findingId,
        r.subjectKey,
        r.phase,
        r.oracleId,
        r.oracleKind,
        r.oracleStrength,
        r.oracleClass,
        r.reproduced ? 1 : 0,
        r.confidence,
        r.expected,
        r.observed,
        r.explanation,
        r.version,
        r.createdAt,
      );
  }

  private selectOracleEvaluations(where: string): string {
    return `SELECT id, run_id AS runId, step_id AS stepId, finding_id AS findingId,
      subject_key AS subjectKey, phase, oracle_id AS oracleId, oracle_kind AS oracleKind,
      oracle_strength AS oracleStrength, oracle_class AS oracleClass, reproduced,
      confidence, expected, observed, explanation, version, created_at AS createdAt
      FROM oracle_evaluations ${where}`;
  }

  /** Evaluation history for a finding in insertion order (rowid breaks
   * same-millisecond ties). */
  listOracleEvaluationsForFinding(findingId: string): OracleEvaluationRecord[] {
    const rows = this.db
      .prepare(
        `${this.selectOracleEvaluations("WHERE finding_id = ?")} ORDER BY created_at, rowid`,
      )
      .all(findingId) as Array<
      Omit<OracleEvaluationRecord, "reproduced"> & { reproduced: number }
    >;
    return rows.map((r) => ({ ...r, reproduced: r.reproduced !== 0 }));
  }

  /** Evaluation history for a whole run in insertion order. */
  listOracleEvaluationsForRun(runId: string): OracleEvaluationRecord[] {
    const rows = this.db
      .prepare(
        `${this.selectOracleEvaluations("WHERE run_id = ?")} ORDER BY created_at, rowid`,
      )
      .all(runId) as Array<
      Omit<OracleEvaluationRecord, "reproduced"> & { reproduced: number }
    >;
    return rows.map((r) => ({ ...r, reproduced: r.reproduced !== 0 }));
  }
}
