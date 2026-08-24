import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  UnattendedCampaign,
  FakeItemExecutor,
  type WorkItem,
  type WorkItemExecutor,
  type WorkerCapabilitySnapshot,
} from "./index.js";

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

function baseItems(): WorkItem[] {
  return [
    { id: "fake-ok", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 2 },
  ];
}

function stubExecutor(caps: Partial<WorkerCapabilitySnapshot>): WorkItemExecutor {
  const inner = new FakeItemExecutor({ usagePerStep: USAGE });
  return {
    id: caps.executorId ?? "stub",
    capabilities: () => ({
      executorId: caps.executorId ?? "stub",
      families: caps.families ?? ["fake"],
      capabilities: caps.capabilities ?? ["deterministic-fixture"],
      available: caps.available ?? true,
      ...(caps.detail !== undefined ? { detail: caps.detail } : {}),
    }),
    execute: async (item, ctx) => inner.execute(item as WorkItem, ctx),
  };
}

describe("M12 F4: capability-aware routing", () => {
  it("refuses durably when no worker can execute an item's adapter family", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m12-route-"));
    try {
      const items: WorkItem[] = [
        ...baseItems(),
        { id: "web-item", priority: 2, mode: "hunt", target: "web", adapterFamily: "web", seed: 2, steps: 1 },
      ];
      // Stub declares ONLY fake: the web item must be refused, never faked.
      const campaign = new UnattendedCampaign({
        stateDir: join(dir, "state"),
        workerCount: 2,
        items,
        usagePerStep: USAGE,
        executor: stubExecutor({ families: ["fake"], detail: "no browser backend" }),
      });
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual(["fake-ok"]);
        expect(report.failed).toEqual([]);
        expect(report.refusals).toHaveLength(1);
        expect(report.refusals[0]).toMatchObject({
          itemId: "web-item",
          class: "capability-unavailable",
        });
        // Refusal is durable for audit/recovery.
        const disk = JSON.parse(readFileSync(join(dir, "state", "campaign.json"), "utf8")) as {
          refusals: Array<{ itemId: string; class: string }>;
          workerCaps: Record<string, WorkerCapabilitySnapshot>;
          queue: string[];
        };
        expect(disk.refusals[0]).toMatchObject({ itemId: "web-item", class: "capability-unavailable" });
        expect(disk.queue).not.toContain("web-item");
        expect(Object.keys(disk.workerCaps).length).toBeGreaterThanOrEqual(1);
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses items whose required capabilities exceed the worker snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m12-route-caps-"));
    try {
      const items: WorkItem[] = [
        { id: "needs-display", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1, requiresCapabilities: ["display"] },
      ];
      const campaign = new UnattendedCampaign({
        stateDir: join(dir, "state"),
        workerCount: 1,
        items,
        usagePerStep: USAGE,
        executor: stubExecutor({ capabilities: ["deterministic-fixture"] }),
      });
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.refusals[0]).toMatchObject({
          itemId: "needs-display",
          class: "capability-unavailable",
        });
        expect(report.refusals[0]?.detail).toContain("display");
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records assignment decisions with the worker's presented capabilities", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m12-route-assign-"));
    try {
      const campaign = new UnattendedCampaign({
        stateDir: join(dir, "state"),
        workerCount: 1,
        items: baseItems(),
        usagePerStep: USAGE,
        executor: stubExecutor({
          executorId: "routed-stub",
          families: ["fake"],
          capabilities: ["deterministic-fixture", "probed"],
        }),
      });
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual(["fake-ok"]);
        expect(report.assignments).toHaveLength(1);
        expect(report.assignments[0]).toMatchObject({
          itemId: "fake-ok",
          workerId: "worker-0",
          attempt: 1,
          executorId: "routed-stub",
        });
        expect(report.assignments[0]!.capabilities).toContain("probed");
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes mixed fleets: executable work runs while unroutable work is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m12-route-mixed-"));
    try {
      const items: WorkItem[] = [
        { id: "a-fake", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 },
        { id: "b-web", priority: 2, mode: "hunt", target: "web", adapterFamily: "web", seed: 2, steps: 1 },
        { id: "c-android", priority: 3, mode: "hunt", target: "android", adapterFamily: "android", seed: 3, steps: 1 },
        { id: "d-cli-requires-pty", priority: 4, mode: "hunt", target: "cli", adapterFamily: "cli", seed: 4, steps: 1 },
      ];
      // Fleet probe result: browser + pty healthy, no adb.
      const campaign = new UnattendedCampaign({
        stateDir: join(dir, "state"),
        workerCount: 2,
        items,
        usagePerStep: USAGE,
        executor: stubExecutor({
          executorId: "mixed-fleet",
          families: ["fake", "web", "cli"],
          capabilities: ["deterministic-fixture", "browser", "pty"],
        }),
      });
      try {
        const report = await campaign.run();
        expect(report.completed.sort()).toEqual(["a-fake", "b-web", "d-cli-requires-pty"]);
        expect(report.failed).toEqual([]);
        const refusedIds = report.refusals.map((r) => r.itemId).sort();
        expect(refusedIds).toEqual(["c-android"]);
        expect(report.refusals[0]).toMatchObject({ class: "capability-unavailable" });
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats an unavailable executor as refusing all work loudly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m12-route-dead-"));
    try {
      const campaign = new UnattendedCampaign({
        stateDir: join(dir, "state"),
        workerCount: 1,
        items: baseItems(),
        usagePerStep: USAGE,
        executor: stubExecutor({ available: false, detail: "executor offline" }),
      });
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.refusals[0]).toMatchObject({ class: "capability-unavailable" });
        expect(report.refusals[0]?.detail).toContain("executor offline");
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
