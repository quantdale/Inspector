import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { UnattendedCampaign, okResult, type ExecutionContext, type WorkItemExecutor, type WorkItemResult } from "./index.js";
import type { WorkItem } from "./types.js";

/**
 * M13 F16: model calls made INSIDE campaign items reserve/settle through the
 * scheduler-owned ExecutionContext gate. Two concurrent workers over one
 * shared campaign-global model ceiling can never collectively oversubscribe
 * it — the same atomicity the resource ledger gives actions/resets.
 */
describe("M13 F16/F17: campaign-scoped model accounting", () => {
  it("binds ctx.modelGate and keeps two workers under one shared request ceiling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m13-campaign-"));
    const GLOBAL_MODEL_REQUESTS = 5;
    const admittedAttemptIds: string[] = [];

    class ModelHammerExecutor implements WorkItemExecutor {
      readonly id = "model-hammer";
      capabilities() {
        return {
          executorId: this.id,
          families: ["fake" as const],
          // M13 F17: model capability is declared separately from backends.
          capabilities: ["deterministic-fixture", "model-planner"],
          available: true,
        };
      }
      async execute(item: unknown, ctx: ExecutionContext): Promise<WorkItemResult> {
        if (ctx.modelGate === undefined) {
          return okResult({ failureClass: undefined } as never);
        }
        let admitted = 0;
        for (let i = 0; i < 8; i++) {
          const attemptId = `${item.id}/attempt/${i}`;
          const ok = ctx.modelGate.admit({
            requestId: `req-${item.id}`,
            attemptId,
            role: "planner",
            requestClass: "exploration-planner",
            estimateTokens: 200,
          });
          if (!ok) break;
          admitted += 1;
          admittedAttemptIds.push(attemptId);
          ctx.modelGate.settle({
            requestId: `req-${item.id}`,
            attemptId,
            outcome: "completed",
            usage: { totalChargedTokens: 180 },
          });
        }
        return okResult({ usage: {}, notes: { admitted } });
      }
    }

    const items: WorkItem[] = [1, 2, 3].map((i) => ({
      id: `item-${i}`,
      priority: i,
      mode: "hunt" as const,
      target: "fake",
      seed: i,
      steps: 0,
    }));

    const campaign = new UnattendedCampaign(
      {
        id: "m13-model-ceiling",
        items,
        workerCount: 2,
        executor: new ModelHammerExecutor(),
        globalBudget: { maxModelRequests: GLOBAL_MODEL_REQUESTS },
        stateDir: join(dir, "state"),
      },
      join(dir, "artifacts"),
    );
    const report = await campaign.run();
    expect(report.completed.length).toBe(3);
    // THE invariant: two racing workers together never exceed the ceiling.
    expect(admittedAttemptIds.length).toBeLessThanOrEqual(GLOBAL_MODEL_REQUESTS);
    expect(admittedAttemptIds.length).toBeGreaterThan(0);
    // Unique attempts only.
    expect(new Set(admittedAttemptIds).size).toBe(admittedAttemptIds.length);
    // Durable truth matches what was actually admitted+settled.
    const totals = campaign.modelBudgetRef.totals();
    expect(totals.requests).toBe(admittedAttemptIds.length);
    expect(totals.activeReservations).toBe(0);
    campaign.dispose();
  }, 60000);

  it("per-item model ceilings are enforced independently of the global scope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-m13-item-"));
    class SingleShotExecutor implements WorkItemExecutor {
      readonly id = "single-shot";
      capabilities() {
        return { executorId: this.id, families: ["fake" as const], capabilities: ["deterministic-fixture"], available: true };
      }
      async execute(item: unknown, ctx: ExecutionContext): Promise<WorkItemResult> {
        const gate = ctx.modelGate;
        if (!gate) throw new Error("scheduler must bind ctx.modelGate");
        const first = gate.admit({ requestId: `r-${item.id}`, attemptId: `${item.id}-a`, role: "planner", requestClass: "c", estimateTokens: 10 });
        const second = gate.admit({ requestId: `r-${item.id}`, attemptId: `${item.id}-b`, role: "planner", requestClass: "c", estimateTokens: 10 });
        return okResult({ notes: { first, second } });
      }
    }
    const items: WorkItem[] = [1, 2].map((i) => ({
      id: `it-${i}`,
      priority: i,
      mode: "hunt" as const,
      target: "fake",
      seed: i,
      steps: 0,
      budgets: { maxModelRequests: 1 },
    }));
    const campaign = new UnattendedCampaign(
      {
        id: "m13-item-scope",
        items,
        workerCount: 2,
        executor: new SingleShotExecutor(),
        stateDir: join(dir, "state"),
      },
      join(dir, "artifacts"),
    );
    const report = await campaign.run();
    expect(report.completed.length).toBe(2);
    const totals = campaign.modelBudgetRef.totals();
    // Each item admitted exactly one of its two attempts.
    expect(totals.requests).toBe(2);
    campaign.dispose();
  }, 60000);
});
