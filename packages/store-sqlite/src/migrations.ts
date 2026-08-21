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
  // Rebuild schema_version with a primary key: the original table had none,
  // so every open inserted another row and reads relied on undefined order.
  `
  CREATE TABLE schema_version_rebuilt (version INTEGER NOT NULL PRIMARY KEY);
  INSERT INTO schema_version_rebuilt(version) SELECT COALESCE(MAX(version), 0) FROM schema_version;
  DROP TABLE schema_version;
  ALTER TABLE schema_version_rebuilt RENAME TO schema_version;
  `,
  // Wave-1 finding extensions (signature/minimization/lastTransition/adapter)
  // plus uniqueness of the idempotency key among unresolved actions.
  `
  ALTER TABLE findings ADD COLUMN signature TEXT;
  ALTER TABLE findings ADD COLUMN minimization_json TEXT;
  ALTER TABLE findings ADD COLUMN last_transition_json TEXT;
  ALTER TABLE findings ADD COLUMN adapter TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_idempotency
    ON actions(idempotency) WHERE status IN ('pending', 'unknown');
  `,
  // Oracle evaluation records (docs/ORACLE-SYSTEM.md): one row per oracle
  // evaluated per evaluation event (reproduction attempts, minimization
  // verifications, repair verification), so evidence bundles can answer
  // "which oracles ran, what did they see, and why was this promoted".
  `
  CREATE TABLE IF NOT EXISTS oracle_evaluations (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    step_id TEXT,
    finding_id TEXT,
    subject_key TEXT,
    phase TEXT NOT NULL,
    oracle_id TEXT NOT NULL,
    oracle_kind TEXT,
    oracle_strength TEXT,
    oracle_class TEXT,
    reproduced INTEGER NOT NULL,
    confidence REAL,
    expected TEXT,
    observed TEXT,
    explanation TEXT,
    version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oracle_evaluations_run ON oracle_evaluations(run_id);
  CREATE INDEX IF NOT EXISTS idx_oracle_evaluations_finding ON oracle_evaluations(finding_id);
  `,
];

export function applyMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Retry instead of failing immediately when a second process holds the
  // write lock. (better-sqlite3 also defaults its `timeout` option to 5s;
  // setting the pragma explicitly keeps the guarantee independent of how the
  // Database was constructed.)
  db.pragma("busy_timeout = 5000");
  const tx = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
    const current =
      (db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined)
        ?.version ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]!);
    }
    // Exactly one authoritative row. (An UPSERT here proved unreliable right
    // after the same-transaction table rebuild above: SQLite inserted a new
    // row instead of taking the conflict path, so state is reset explicitly.)
    db.prepare(`DELETE FROM schema_version`).run();
    db.prepare(`INSERT INTO schema_version(version) VALUES(?)`).run(MIGRATIONS.length);
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
