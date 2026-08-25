import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, Store } from "./index.js";
import type { ModelCallRecord } from "@inspector/model-runtime";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inspector-model-calls-"));
});

afterAll(() => {});

function dbPath(): string {
  return join(dir, `runs-${Math.random().toString(36).slice(2)}.db`);
}

function record(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    id: "mreq_1/a1",
    requestId: "mreq_1",
    attemptNumber: 1,
    fallbackPosition: 0,
    schemaVersion: "inspector-model-call/1",
    status: "completed",
    role: "planner",
    requestClass: "exploration-planner",
    providerId: "fixture",
    modelId: "fixture-small",
    errorClassification: null,
    attribution: { runId: "run_mc", campaignId: "cmp_1", itemId: "item_1", workerId: "w1" },
    contextSha256: "a".repeat(64),
    responseSha256: "b".repeat(64),
    promptBytes: 512,
    responseBytes: 64,
    inputTokens: null,
    outputTokens: 42,
    cachedInputTokens: null,
    totalChargedTokens: null,
    costUsd: 0.001,
    latencyMs: 120,
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:00.120Z",
    metadataJson: { seed: 7 },
    ...overrides,
  };
}

function makeStore(): Store {
  const store = Store.open(dbPath());
  store.createRun({ id: "run_mc" });
  return store;
}

describe("M13 F3: durable model_calls control plane", () => {
  it("migration #12 is additive and schema_version advances to the full count", () => {
    const store = makeStore();
    const version = (store.raw.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
    expect(version).toBe(MIGRATIONS.length);
    expect(version).toBeGreaterThanOrEqual(12);
    const table = store.raw.prepare(`PRAGMA table_info(model_calls)`).all() as Array<{ name: string }>;
    const columns = new Set(table.map((c) => c.name));
    for (const required of [
      "id",
      "request_id",
      "status",
      "role",
      "provider_id",
      "error_classification",
      "campaign_id",
      "context_sha256",
      "input_tokens",
      "cost_usd",
    ]) {
      expect(columns.has(required)).toBe(true);
    }
    store.close();
  });

  it("upgrades an earlier database (pre-model_calls) without rewriting history", () => {
    const path = dbPath();
    // Build a database, then roll it back to the pre-M13 migration state.
    const first = Store.open(path);
    first.close();
    const raw = new Database(path);
    raw.exec(`DROP TABLE model_calls`);
    raw.prepare(`DELETE FROM schema_version`).run();
    raw.prepare(`INSERT INTO schema_version(version) VALUES(?)`).run(MIGRATIONS.length - 1);
    raw.close();
    const reopened = Store.open(path);
    const rows = reopened.raw.prepare(`SELECT COUNT(*) AS c FROM model_calls`).get() as { c: number };
    expect(rows.c).toBe(0);
    const version = (reopened.raw.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version;
    expect(version).toBe(MIGRATIONS.length);
    reopened.close();
  });

  it("inserts and reads a completed call with full attribution and metadata round-trip", () => {
    const store = makeStore();
    store.putModelCall(record());
    const loaded = store.getModelCall("mreq_1/a1");
    expect(loaded).toBeDefined();
    expect(loaded!.attribution).toEqual({
      runId: "run_mc",
      campaignId: "cmp_1",
      itemId: "item_1",
      workerId: "w1",
    });
    expect(loaded!.outputTokens).toBe(42);
    expect(loaded!.inputTokens).toBeNull();
    expect(loaded!.metadataJson).toEqual({ seed: 7 });
    expect(loaded!.status).toBe("completed");
    store.close();
  });

  it("models the sink lifecycle: started row persists, then finishes; unknown stays NULL", () => {
    const store = makeStore();
    store.putModelCall(record({ status: "started", outputTokens: null, costUsd: null, responseSha256: null, responseBytes: null, latencyMs: null, completedAt: null }));
    let row = store.getModelCall("mreq_1/a1")!;
    expect(row.status).toBe("started");
    // Crash before settlement: usage fields remain honestly unknown.
    expect(row.outputTokens).toBeNull();
    expect(row.costUsd).toBeNull();
    // The controller recovers and records the terminal transition.
    store.putModelCall(record({ status: "failed", errorClassification: "deadline" }));
    row = store.getModelCall("mreq_1/a1")!;
    expect(row.status).toBe("failed");
    expect(row.errorClassification).toBe("deadline");
    store.close();
  });

  it("lists with filters and newest-first ordering", () => {
    const store = makeStore();
    store.putModelCall(record({ id: "r/a1", requestId: "r", status: "completed", startedAt: "2026-08-24T00:00:01.000Z" }));
    store.putModelCall(
      record({ id: "r2/a1", requestId: "r2", role: "oracle", requestClass: "semantic-suspicion", status: "denied", providerId: "fixture", startedAt: "2026-08-24T00:00:02.000Z" }),
    );
    store.putModelCall(
      record({ id: "r3/a1", requestId: "r3", role: "repairer", requestClass: "repair-proposal", attribution: {}, startedAt: "2026-08-24T00:00:03.000Z" }),
    );
    expect(store.listModelCalls().map((r) => r.id)).toEqual(["r3/a1", "r2/a1", "r/a1"]);
    expect(store.listModelCalls({ role: "planner" }).map((r) => r.id)).toEqual(["r/a1"]);
    expect(store.listModelCalls({ campaignId: "cmp_1" }).map((r) => r.id)).toEqual(["r2/a1", "r/a1"]);
    expect(store.listModelCalls({ status: "denied" }).map((r) => r.id)).toEqual(["r2/a1"]);
    store.close();
  });

  it("summarizes truthfully: unknown token/cost sums stay NULL, counts stay exact", () => {
    const store = makeStore();
    store.putModelCall(record({ id: "a", requestId: "req-a" }));
    store.putModelCall(record({ id: "b", requestId: "req-a", attemptNumber: 2, fallbackPosition: 1 }));
    store.putModelCall(record({ id: "c", requestId: "req-c", status: "denied", outputTokens: null, costUsd: null }));
    const summary = store.summarizeModelCalls();
    expect(summary.attempts).toBe(3);
    expect(summary.requests).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.denied).toBe(1);
    expect(summary.fallbacks).toBe(1);
    // Only two rows reported tokens/cost — but SUM over NULLs ignores them;
    // the reported sum reflects exactly what is KNOWN.
    expect(summary.outputTokens).toBe(84);
    expect(summary.costUsd).toBeCloseTo(0.002, 6);
    // A filter that excludes every reporting row yields NULL, never zero.
    const none = store.summarizeModelCalls({ workerId: "missing-worker" });
    expect(none.attempts).toBe(0);
    expect(none.outputTokens).toBeNull();
    expect(none.costUsd).toBeNull();
    store.close();
  });

  it("rejects malformed records fail-closed", () => {
    const store = makeStore();
    expect(() => store.putModelCall(record({ status: "exploded" as ModelCallRecord["status"] }))).toThrow(TypeError);
    expect(() => store.putModelCall(record({ role: "shaman" as ModelCallRecord["role"] }))).toThrow(TypeError);
    expect(() => store.putModelCall(record({ outputTokens: -5 }))).toThrow(TypeError);
    expect(() => store.putModelCall(record({ promptBytes: Number.NaN }))).toThrow(TypeError);
    expect(() => store.putModelCall(record({ requestId: "" }))).toThrow(TypeError);
    store.close();
  });

  it("supports concurrent writers through WAL + busy timeout", () => {
    const path = dbPath();
    const a = Store.open(path);
    const b = Store.open(path);
    for (let i = 0; i < 50; i++) {
      a.putModelCall(record({ id: `ca/${i}`, requestId: `ca`, status: i % 2 ? "completed" : "started" }));
      b.putModelCall(record({ id: `cb/${i}`, requestId: `cb`, status: "completed" }));
    }
    const count = a.raw.prepare(`SELECT COUNT(*) AS c FROM model_calls`).get() as { c: number };
    expect(count.c).toBe(100);
    a.close();
    b.close();
  });
});
