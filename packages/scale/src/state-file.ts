import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";

/**
 * Atomic JSON state file: the durable campaign state (queue, completed,
 * in-flight leases, ledger) survives controller restart. Production binding
 * is SQLite; the file form keeps the contract identical and auditable.
 */
export class StateFile<T> {
  private readonly path: string;
  constructor(
    stateDir: string,
    name: string,
    private initial: () => T,
  ) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, `${name}.json`);
  }

  load(): T {
    if (!existsSync(this.path)) return this.initial();
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch {
      return this.initial();
    }
  }

  save(value: T): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, this.path);
  }
}
