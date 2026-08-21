import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRouter } from "./router.js";
import { FindingClusterer } from "./cluster.js";
import { ResourceLedger } from "./ledger.js";
import { AdapterRegistry } from "./discovery.js";
import type { Finding } from "@inspector/finding";

function finding(id: string, title: string): Finding {
  return {
    id,
    runId: "run",
    status: "CONFIRMED",
    title,
    confidence: 0.9,
    severity: "high",
    revision: null,
    oracleIds: ["page-error"],
    reproduction: null,
    artifactRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("model router (S2)", () => {
  it("prefers the highest-priority healthy provider per role", async () => {
    const router = new ModelRouter()
      .register({ id: "cheap", roles: ["planner"], priority: 1, costPer1kTokens: 1, healthy: true, complete: async () => "cheap" })
      .register({ id: "best", roles: ["planner"], priority: 9, costPer1kTokens: 5, healthy: true, complete: async () => "best" });
    const r = await router.complete("planner", "x");
    expect(r.provider.id).toBe("best");
    expect(r.fallbacksUsed).toHaveLength(0);
  });

  it("falls back down the priority list on failure and escalates when all fail", async () => {
    const router = new ModelRouter()
      .register({ id: "flaky", roles: ["repairer"], priority: 9, costPer1kTokens: 1, healthy: true, complete: async () => { throw new Error("boom"); } })
      .register({ id: "solid", roles: ["repairer"], priority: 2, costPer1kTokens: 3, healthy: true, complete: async () => "ok" });
    const r = await router.complete("repairer", "x");
    expect(r.provider.id).toBe("solid");
    expect(r.fallbacksUsed).toEqual(["flaky"]);

    const allBad = new ModelRouter().register({
      id: "dead", roles: ["summarizer"], priority: 1, costPer1kTokens: 1, healthy: true,
      complete: async () => { throw new Error("down"); },
    });
    await expect(allBad.complete("summarizer", "x")).rejects.toThrow(/all providers/);
  });
});

describe("finding clusterer (S4)", () => {
  it("clusters duplicates by signature while preserving provenance", () => {
    const c = new FindingClusterer();
    const a = c.add(finding("f1", "crash on submit"), { workerId: "w1", errorText: "TypeError: cannot read property 'id' of undefined" });
    const b = c.add(finding("f2", "crash on submit"), { workerId: "w2", errorText: "TypeError: cannot read property 'id' of undefined" });
    c.add(finding("f3", "different defect"), { workerId: "w1", errorText: "null pointer in renderer" });

    expect(c.size).toBe(2);
    expect(a.canonical.findingId).toBe("f1");
    expect(b.members.map((m) => m.workerId)).toEqual(["w1", "w2"]);
  });
});

describe("resource ledger (S3)", () => {
  it("enforces global and per-worker budgets deterministically", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    const ledger = new ResourceLedger(
      dir,
      { maxActions: 10 },
      { "w-a": { maxActions: 4 } },
    );
    expect(ledger.charge({ workerId: "w-a", actions: 4 })).toBe(true);
    expect(ledger.charge({ workerId: "w-a", actions: 1 })).toBe(false); // worker budget
    expect(ledger.charge({ workerId: "w-b", actions: 6 })).toBe(true);
    expect(ledger.charge({ workerId: "w-b", actions: 1 })).toBe(false); // global budget
    expect(ledger.totals().actions).toBe(10);
  });

  it("refuses charges after stop", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-stop-"));
    const ledger = new ResourceLedger(dir);
    ledger.stop();
    expect(ledger.charge({ workerId: "w", actions: 1 })).toBe(false);
  });
});

describe("adapter registry (S7)", () => {
  it("discovers compatible adapters and reports incompatible ones", () => {
    const reg = new AdapterRegistry()
      .register({ id: "web", version: "1.0", protocolVersion: "0.1", conformance: "pass" })
      .register({ id: "legacy", version: "0.9", protocolVersion: "0.0", conformance: "unverified" });
    expect(reg.discover().map((a) => a.id)).toEqual(["web"]);
    expect(reg.incompatible()[0]?.id).toBe("legacy");
  });
});
