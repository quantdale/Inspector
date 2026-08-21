import { join } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { LeaseRecord } from "./types.js";
import { StateFile } from "./state-file.js";

/** Durable lease state, identical in shape across backends. */
export interface LeasesState {
  leases: Record<string, LeaseRecord>;
  done: string[];
}

/**
 * Storage backend behind {@link LeaseManager}. Every mutation goes through
 * {@link update}, which must serialize concurrent instances on the same
 * stateDir (cross-process lock or SQLite write transaction), reload the
 * current state inside that critical section, apply `fn`, and persist — so
 * no manager ever acts on a stale snapshot.
 */
export interface LeaseStore {
  load(): LeasesState;
  update<U>(fn: (current: LeasesState) => U): U;
  /** Release backend resources (no-op for the JSON file store). */
  close(): void;
}

/** JSON-file backend: the original StateFile-backed store (default). */
export class JsonLeaseStore implements LeaseStore {
  private readonly file: StateFile<LeasesState>;

  constructor(stateDir: string) {
    this.file = new StateFile(stateDir, "leases", () => ({ leases: {}, done: [] }));
  }

  load(): LeasesState {
    return this.file.load();
  }

  update<U>(fn: (current: LeasesState) => U): U {
    return this.file.update(fn);
  }

  close(): void {
    // Nothing to release; the file handle lifetime is per-operation.
  }
}

const LEASES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS leases (
    item_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    acquired_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lease_done (
    item_id TEXT PRIMARY KEY,
    done_at_ms INTEGER NOT NULL
  );
`;

/**
 * SQLite backend: leases live in `<stateDir>/leases.db`, a database owned by
 * the scale package (the store-sqlite control-plane DB is a separate concern).
 * Atomicity replaces the JSON store's cross-process FileLock: each
 * {@link update} runs read-modify-write inside one write transaction, and
 * busy_timeout makes concurrent processes queue instead of failing.
 */
export class SqliteLeaseStore implements LeaseStore {
  private readonly db: Database.Database;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.db = new Database(join(stateDir, "leases.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(LEASES_SCHEMA);
  }

  load(): LeasesState {
    return this.readState();
  }

  update<U>(fn: (current: LeasesState) => U): U {
    const tx = this.db.transaction(() => {
      const current = this.readState();
      const result = fn(current);
      this.writeState(current);
      return result;
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }

  private readState(): LeasesState {
    const state: LeasesState = { leases: {}, done: [] };
    for (const row of this.db.prepare(`SELECT * FROM leases ORDER BY rowid`).all() as Array<{
      item_id: string;
      worker_id: string;
      generation: number;
      acquired_at_ms: number;
      expires_at_ms: number;
    }>) {
      state.leases[row.item_id] = {
        itemId: row.item_id,
        workerId: row.worker_id,
        generation: row.generation,
        acquiredAtMs: row.acquired_at_ms,
        expiresAtMs: row.expires_at_ms,
      };
    }
    for (const row of this.db.prepare(`SELECT item_id FROM lease_done ORDER BY rowid`).all() as Array<{
      item_id: string;
    }>) {
      state.done.push(row.item_id);
    }
    return state;
  }

  private writeState(state: LeasesState): void {
    this.db.prepare(`DELETE FROM leases`).run();
    this.db.prepare(`DELETE FROM lease_done`).run();
    const insertLease = this.db.prepare(
      `INSERT INTO leases(item_id, worker_id, generation, acquired_at_ms, expires_at_ms)
       VALUES(?, ?, ?, ?, ?)`,
    );
    for (const l of Object.values(state.leases)) {
      insertLease.run(l.itemId, l.workerId, l.generation, l.acquiredAtMs, l.expiresAtMs);
    }
    const insertDone = this.db.prepare(
      `INSERT INTO lease_done(item_id, done_at_ms) VALUES(?, ?)`,
    );
    for (const id of state.done) {
      insertDone.run(id, 0);
    }
  }
}
