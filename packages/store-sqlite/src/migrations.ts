import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    adapter TEXT,
    policy_json TEXT,
    meta_json TEXT
  );

  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    adapter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created'
  );

  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    sequence INTEGER NOT NULL,
    action_id TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    kind TEXT NOT NULL,
    risk TEXT NOT NULL,
    deadline_ms INTEGER NOT NULL,
    idempotency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    error_code TEXT,
    error_json TEXT,
    state_after TEXT,
    step_id TEXT
  );

  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    step_id TEXT,
    sequence INTEGER NOT NULL,
    source TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observation_artifacts (
    observation_id TEXT NOT NULL REFERENCES observations(id),
    sha256 TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY(observation_id, sha256)
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    step_id TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_steps_run_seq ON steps(run_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id);
  CREATE INDEX IF NOT EXISTS idx_observations_seq ON observations(run_id, sequence);
  `,
  `
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    severity TEXT,
    revision TEXT,
    oracle_ids TEXT,
    reproduction_json TEXT,
    artifact_refs TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
  `,
];

export function applyMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const tx = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
    const row = db.prepare(`SELECT version FROM schema_version`).get() as
      | { version: number }
      | undefined;
    const current = row?.version ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]!);
    }
    db.prepare(
      `INSERT INTO schema_version(version) VALUES(?)
       ON CONFLICT DO UPDATE SET version = excluded.version`,
    ).run(MIGRATIONS.length);
  });
  tx();
}

export function openStore(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  applyMigrations(db);
  return db;
}
