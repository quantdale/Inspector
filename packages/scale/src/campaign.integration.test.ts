import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  UnattendedCampaign,
  InspectorFacade,
  AdapterRegistry,
  type WorkItem,
} from "./index.js";

const bases: string[] = [];
function fresh(name: string): string {
  const base = mkdtempSync(join(tmpdir(), `inspector-m7-${name}-`));
  bases.push(base);
  return base;
}
afterEach(() => {
  for (const b of bases) rmSync(b, { recursive: true, force: true });
  bases.length = 0;
});

function items(): WorkItem[] {
  return [
    { id: "item-1", priority: 1, mode: "hunt", target: "fake", seed: 11, steps: 2 },
    { id: "item-2", priority: 2, mode: "hunt", target: "fake", seed: 22, steps: 2 },
    { id: "item-3", priority: 3, mode: "regression", target: "fake", seed: 33, steps: 2 },
    { id: "item-4", priority: 4, mode: "repair", target: "fake", seed: 44, steps: 2 },
  ];
}

const USAGE = { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 };

describe("M8-proving multi-worker campaign (S0/S5/S8)", () => {
  it("runs a bounded campaign across two isolated workers with clean shutdown", async () => {
    const stateDir = join(fresh("basic"), "state");
    const campaign = new UnattendedCampaign({
      stateDir,
      workerCount: 2,
      items: items(),
      usagePerStep: USAGE,
    });

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
    campaign.dispose();
  });

  it("survives controller restart without duplicating completed work", async () => {
    const stateDir = join(fresh("restart"), "state");

    const first = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: items(),
      usagePerStep: USAGE,
    });
    await first.run();
    const before = await first.run(); // idempotent second pass
    expect(before.completed).toHaveLength(4);

    // Controller restart: fresh campaign object over the same durable state.
    const restarted = new UnattendedCampaign({
      stateDir,
      workerCount: 2,
      items: items(),
      usagePerStep: USAGE,
    });
    restarted.injectRestart();
    const after = await restarted.run();
    // Completed items are not re-executed; executions remain one per item.
    const counts = new Map<string, number>();
    for (const e of after.executions) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
    expect(counts.size).toBe(4);
    for (const [, n] of counts) expect(n).toBe(1);
    expect(after.restartsInjected).toBe(1);
    restarted.dispose();
  });

  it("restarts mid-queue between items without duplication or loss", async () => {
    const stateDir = join(fresh("midqueue"), "state");

    // First controller only knows about item-1; it completes and exits.
    const first = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: [items()[0]!],
      usagePerStep: USAGE,
    });
    const firstReport = await first.run();
    expect(firstReport.completed).toEqual(["item-1"]);

    // Replacement controller comes back with the full item set: item-1 must
    // not re-execute, and items 2–4 must each execute exactly once.
    const second = new UnattendedCampaign({
      stateDir,
      workerCount: 2,
      items: items(),
      usagePerStep: USAGE,
    });
    second.injectRestart();
    const report = await second.run();
    const counts = new Map<string, number>();
    for (const e of report.executions) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(["item-1", "item-2", "item-3", "item-4"]);
    for (const [, n] of counts) expect(n).toBe(1);
    expect(report.staleCompletions).toBe(0);
    second.dispose();
  });
});

describe("external integration facade (S6)", () => {
  it("exposes read-only views plus a stop/resume lifecycle through policy-safe methods", async () => {
    const stateDir = join(fresh("facade"), "state");
    const registry = new AdapterRegistry()
      .register({ id: "web", version: "1.0", protocolVersion: "0.1", conformance: "pass" })
      .register({ id: "broken", version: "1.0", protocolVersion: "0.1", conformance: "fail" });
    let running = true;
    const campaign = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: [items()[0]!],
      usagePerStep: USAGE,
    });
    const facade = new InspectorFacade({
      status: () => ({ running, queue: 0, completed: 1, inFlight: 0 }),
      findings: () => [],
      ledger: campaign.ledgerRef,
      registry,
      stop: () => {
        running = false;
        campaign.stop();
      },
      resume: () => {
        running = true;
        campaign.resume();
      },
    });

    const status = await facade.handle({ method: "campaign.status" });
    expect(status.ok).toBe(true);
    const adapters = await facade.handle({ method: "adapters.list" });
    expect(adapters.ok).toBe(true);
    // Conformance failures stay out of the default discovery view.
    expect(JSON.stringify(adapters.result)).not.toContain("broken");
    const unknown = await facade.handle({ method: "campaign.mutate" as never });
    expect(unknown.ok).toBe(false); // external clients cannot mutate state
    const stop = await facade.handle({ method: "campaign.stop" });
    expect(stop.ok).toBe(true);
    expect(campaign.ledgerRef.isStopped).toBe(true);
    // Symmetric operator path clears the durable stop.
    const resume = await facade.handle({ method: "campaign.resume" });
    expect(resume.ok).toBe(true);
    expect(campaign.ledgerRef.isStopped).toBe(false);
    campaign.dispose();
  });
});
