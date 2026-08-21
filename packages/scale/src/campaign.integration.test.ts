import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@inspector/store-sqlite";
import {
  UnattendedCampaign,
  InspectorFacade,
  AdapterRegistry,
  type WorkItem,
} from "./index.js";

function items(): WorkItem[] {
  return [
    { id: "item-1", priority: 1, mode: "hunt", target: "fake", seed: 11, steps: 2 },
    { id: "item-2", priority: 2, mode: "hunt", target: "fake", seed: 22, steps: 2 },
    { id: "item-3", priority: 3, mode: "regression", target: "fake", seed: 33, steps: 2 },
    { id: "item-4", priority: 4, mode: "repair", target: "fake", seed: 44, steps: 2 },
  ];
}

describe("M8-proving multi-worker campaign (S0/S5/S8)", () => {
  it("runs a bounded campaign across two isolated workers with clean shutdown", async () => {
    const stateDir = join(mkdtempSync(join(tmpdir(), "inspector-m7-")), "state");
    const store = Store.open(join(stateDir, "..", "runs.db"));
    const campaign = new UnattendedCampaign(
      {
        stateDir,
        workerCount: 2,
        items: items(),
        usagePerStep: { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 },
      },
      store,
    );

    const report = await campaign.run();
    expect(report.completed.sort()).toEqual(["item-1", "item-2", "item-3", "item-4"]);
    // Each item executed exactly once — no cross-worker duplication.
    const counts = new Map<string, number>();
    for (const e of report.executions) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
    for (const [, n] of counts) expect(n).toBe(1);
    // Both workers participated.
    expect(new Set(report.executions.map((e) => e.workerId)).size).toBe(2);
    // Resources accounted.
    expect(report.usage.actions).toBeGreaterThan(0);
    expect(report.usage.tokens).toBeGreaterThan(0);
    store.close();
  });

  it("survives controller restart without duplicating completed work", async () => {
    const base = mkdtempSync(join(tmpdir(), "inspector-m7-restart-"));
    const stateDir = join(base, "state");
    const store = Store.open(join(base, "runs.db"));

    const first = new UnattendedCampaign(
      {
        stateDir,
        workerCount: 1,
        items: items(),
        usagePerStep: { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 },
      },
      store,
    );
    await first.run();
    const before = await first.run(); // idempotent second pass
    expect(before.completed).toHaveLength(4);

    // Controller restart: fresh campaign object over the same durable state.
    const restarted = new UnattendedCampaign(
      {
        stateDir,
        workerCount: 2,
        items: items(),
        usagePerStep: { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 },
      },
      store,
    );
    restarted.injectRestart();
    const after = await restarted.run();
    // Completed items are not re-executed; executions remain one per item.
    const counts = new Map<string, number>();
    for (const e of after.executions) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
    expect(counts.size).toBe(4);
    for (const [, n] of counts) expect(n).toBe(1);
    expect(after.restartsInjected).toBe(1);
    store.close();
  });
});

describe("external integration facade (S6)", () => {
  it("exposes read-only views and cooperative stop through policy-safe methods", async () => {
    const stateDir = join(mkdtempSync(join(tmpdir(), "inspector-m7-facade-")), "state");
    const store = Store.open(join(stateDir, "..", "runs.db"));
    const registry = new AdapterRegistry()
      .register({ id: "web", version: "1.0", protocolVersion: "0.1", conformance: "pass" });
    let running = true;
    const campaign = new UnattendedCampaign(
      {
        stateDir,
        workerCount: 1,
        items: [items()[0]!],
        usagePerStep: { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 },
      },
      store,
    );
    const facade = new InspectorFacade({
      status: () => ({ running, queue: 0, completed: 1, inFlight: 0 }),
      findings: () => [],
      ledger: campaign.ledgerRef,
      registry,
      stop: () => {
        running = false;
        campaign.stop();
      },
    });

    const status = await facade.handle({ method: "campaign.status" });
    expect(status.ok).toBe(true);
    const adapters = await facade.handle({ method: "adapters.list" });
    expect(adapters.ok).toBe(true);
    const unknown = await facade.handle({ method: "campaign.mutate" as never });
    expect(unknown.ok).toBe(false); // external clients cannot mutate state
    const stop = await facade.handle({ method: "campaign.stop" });
    expect(stop.ok).toBe(true);
    expect(campaign.ledgerRef.isStopped).toBe(true);
    store.close();
  });
});
