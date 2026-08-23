import { join } from "node:path";
import { newId } from "@inspector/protocol";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { Store } from "@inspector/store-sqlite";
import { FakeAdapterHandler } from "@inspector/adapter-fake";
import {
  ItemCancelledError,
  failedResult,
  okResult,
  type ExecutionContext,
  type WorkItemExecutor,
  type WorkItemResult,
  type WorkerCapabilitySnapshot,
} from "./executor.js";

export interface FakeExecutorOptions {
  /** Deterministic per-action usage charged to the ledger. */
  usagePerStep: { modelRequests: number; tokens: number; costUsd: number; actions: number };
  /** Lease renewal cadence hint (half-TTL), matching the scheduler TTL. */
  leaseTtlMs?: number;
}

/**
 * Deterministic fake fixture executor (M12 F1). The historical inline
 * execution of `UnattendedCampaign` extracted verbatim behind the
 * WorkItemExecutor contract. It remains available for exhaustive scheduler
 * tests but is no longer the scale engine's fundamental behavior.
 */
export class FakeItemExecutor implements WorkItemExecutor {
  readonly id = "fake-fixture";

  constructor(private readonly opts: FakeExecutorOptions) {}

  capabilities(): WorkerCapabilitySnapshot {
    return {
      executorId: this.id,
      families: ["fake"],
      capabilities: ["deterministic-fixture"],
      available: true,
      detail: "in-process deterministic state-machine fixture",
    };
  }

  async execute(item: { id: string; seed?: number; target?: string; steps: number }, ctx: ExecutionContext): Promise<WorkItemResult> {
    const ws = ctx.workspaceDir;
    const store = Store.open(join(ws, "runs.db"));
    const runIds: string[] = [];
    try {
      const handler = new FakeAdapterHandler({
        artifactBaseDir: join(ws, "artifacts"),
      });
      await handler.initialize();
      await handler.lifecycle({ op: "create" });

      const engine = new FindingEngine(OracleEngine.defaults(), store);
      const finding = engine.ingest(
        { kind: "DEFECT_SUBMIT_INVALID", detail: `seed ${item.seed}` },
        { runId: `run-${item.id}`, title: `defect-${item.target}-seed${item.seed}` },
      );
      runIds.push(`run-${item.id}`);
      // Persist evidence before proceeding: a crash later in the item must
      // not lose work already done.
      ctx.persistPartial([finding]);

      let lastRenewMs = ctx.now();
      // Bounded deterministic hunt cycles against the isolated environment.
      for (let i = 0; i < item.steps; i++) {
        if (ctx.signal.aborted) throw new ItemCancelledError();
        // Renewal at half-TTL keeps long items from expiring mid-run; the
        // generation fence remains the backstop if renewal ever fails.
        const t = ctx.now();
        if (t - lastRenewMs >= (this.opts.leaseTtlMs ?? 60_000) / 2) {
          ctx.renewLease();
          lastRenewMs = t;
        }
        const action = {
          id: newId("act"),
          runId: `run-${item.id}`,
          environmentId: "env",
          kind: "click",
          risk: "interact",
          deadlineMs: 5000,
          idempotency: "safe-retry",
          input: {},
        } as Parameters<typeof handler.act>[0]["action"];
        const outcome = await handler.act({ action });
        const charged = ctx.charge({
          actions: this.opts.usagePerStep.actions,
          modelRequests: this.opts.usagePerStep.modelRequests,
          tokens: this.opts.usagePerStep.tokens,
          costUsd: this.opts.usagePerStep.costUsd,
        });
        if (!charged) {
          return failedResult("budget-exhausted", `budget exhausted during item ${item.id}`, {
            findings: [finding],
            runIds,
          });
        }
        if (outcome.status === "target-failure") break;
      }
      return okResult({ findings: [finding], runIds });
    } finally {
      store.close();
    }
  }
}
