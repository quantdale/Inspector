import { type Database } from "better-sqlite3";
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
  run_id: string;
  step_id: string | null;
  created_at: string;
  payload_json: string;
}

export interface StepBundle {
  step: { id: string; sequence: number; actionId: string | null; status: StepStatus };
  action: ActionRecord | null;
  observations: Array<ObservationRecord & { artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> }>;
}

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

  createRun(input: { id: string; adapter?: string; policy?: unknown; meta?: unknown }): RunRecord {
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

  getRun(id: string): RunRecord | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRecord | undefined;
  }

  listRuns(limit = 100): RunRecord[] {
    return this.db
      .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as RunRecord[];
  }

  setRunStatus(id: string, status: string): void {
    this.db.prepare(`UPDATE runs SET status = ? WHERE id = ?`).run(status, id);
  }

  createEnvironment(input: { id: string; runId: string; adapter: string }): EnvironmentRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO environments(id, run_id, adapter, created_at, status)
         VALUES(?, ?, ?, ?, 'created')`,
      )
      .run(input.id, input.runId, input.adapter, now);
    return this.getEnvironment(input.id)!;
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
    };
    observations: Array<{
      id: string;
      stepId: string | null;
      sequence: number;
      source: string;
      capturedAt: string;
      summary: unknown;
      artifacts?: Array<{ sha256: string; mime: string; size: number; path: string }>;
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
          `INSERT OR REPLACE INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
             status, requested_at, decided_at, error_code, error_json, state_after, step_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  /** Insert an action that has been requested but not yet decided (in-flight). */
  insertPendingAction(input: {
    id: string;
    runId: string;
    environmentId: string;
    kind: string;
    risk: string;
    deadlineMs: number;
    idempotency: string;
    stepId?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
           status, requested_at, step_id)
         VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
      );
  }

  finalizeAction(
    id: string,
    outcome: { status: ActionStatus; stateAfter?: string | null; errorCode?: string | null; error?: unknown | null },
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
    return this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as ActionRecord | undefined;
  }

  /**
   * On restart, any action still in `pending` state means the adapter response
   * was never persisted (adapter loss / crash). Mark these `unknown` so the
   * core re-observes/resets instead of blindly retrying.
   */
  markInFlightUnknown(runId: string): ActionRecord[] {
    const pending = this.getInFlightActions(runId);
    const tx = this.db.transaction((ids: string[]) => {
      const stmt = this.db.prepare(
        `UPDATE actions SET status = 'unknown', decided_at = ? WHERE id = ?`,
      );
      for (const id of ids) stmt.run(new Date().toISOString(), id);
    });
    tx(pending.map((a) => a.id));
    return pending;
  }

  getInFlightActions(runId: string): ActionRecord[] {
    return this.db
      .prepare(`SELECT * FROM actions WHERE run_id = ? AND status IN ('pending', 'unknown') ORDER BY requested_at`)
      .all(runId) as ActionRecord[];
  }

  writeCheckpoint(input: { id: string; runId: string; stepId?: string | null; payload: unknown }): CheckpointRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.runId, input.stepId ?? null, now, JSON.stringify(input.payload));
    return this.db.prepare(`SELECT * FROM checkpoints WHERE id = ?`).get(input.id) as CheckpointRecord;
  }

  getLatestCheckpoint(runId: string): CheckpointRecord | undefined {
    return this.db
      .prepare(`SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(runId) as CheckpointRecord | undefined;
  }

  getCheckpoint(id: string): CheckpointRecord | undefined {
    return this.db.prepare(`SELECT * FROM checkpoints WHERE id = ?`).get(id) as CheckpointRecord | undefined;
  }

  getStepObservations(
    stepId: string,
  ): Array<ObservationRecord & { artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> }> {
    const obs = this.db
      .prepare(`SELECT * FROM observations WHERE step_id = ? ORDER BY sequence`)
      .all(stepId) as ObservationRecord[];
    const getArtifacts = this.db.prepare(
      `SELECT sha256, mime, size, path FROM observation_artifacts WHERE observation_id = ?`,
    );
    return obs.map((o) => ({
      ...o,
      artifacts: getArtifacts.all(o.id) as Array<{ sha256: string; mime: string; size: number; path: string }>,
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
      artifacts?: Array<{ sha256: string; mime: string; size: number; path: string }>;
    }>;
  }): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO steps(id, run_id, environment_id, sequence, action_id, status, created_at)
           VALUES(?, ?, ?, ?, NULL, 'committed', ?)`,
        )
        .run(input.stepId, input.runId, input.environmentId, input.sequence, new Date().toISOString());
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
        ? (this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(s.action_id) as ActionRecord)
        : null;
      return {
        step: { id: s.id, sequence: s.sequence, actionId: s.action_id, status: s.status },
        action,
        observations: this.getStepObservations(s.id),
      };
    });
  }
}
