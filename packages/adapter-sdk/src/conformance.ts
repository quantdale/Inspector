import type { AdapterClient } from "./client.js";
import type { Action } from "@inspector/protocol";

export interface ConformanceHooks {
  /** Spawn a fresh adapter subprocess (called once per scenario group). */
  start(): Promise<AdapterClient>;
  /** Stop and release the client under test. */
  stop(client: AdapterClient): Promise<void>;
  /** Steps that move the target from its seeded baseline to its main surface. */
  traverseSteps: Action[];
  /** An action that makes the TARGET application fail (genuine defect). */
  crashStep: Action;
  /** An action aimed at a nonexistent element (automation miss). */
  missStep: Action;
  /** Element ids that must be visible after traversal. */
  expectedIdsAfterTraverse: string[];
}

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

/**
 * Common adapter conformance contract (M6). Every platform adapter must
 * satisfy these invariants regardless of interaction model:
 *  - protocol version negotiation,
 *  - deterministic seeded baseline + reset,
 *  - semantic observation model (uiTree),
 *  - genuine target failures classified TARGET_FAILURE,
 *  - automation misses classified ACTION_FAILED.
 */
export async function runCommonConformance(hooks: ConformanceHooks): Promise<void> {
  // Version/capability negotiation.
  let client = await hooks.start();
  try {
    // Cold adapter startup can be delayed by a platform broker (PowerShell,
    // ADB, or a browser) while the host is running the full conformance
    // matrix. Keep the protocol check bounded, but do not turn scheduler load
    // into a false capability failure.
    const caps = (await client.request("initialize", {}, 30000)) as { protocolVersion: string };
    if (caps.protocolVersion !== "0.1") {
      throw new Error(`unexpected protocol version ${caps.protocolVersion}`);
    }
  } finally {
    await hooks.stop(client);
  }

  // Baseline -> traverse -> reset restores the baseline.
  client = await hooks.start();
  try {
    await client.request("lifecycle", { op: "create" }, 30000);
    const before = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string }> };
    };
    const idsBefore = new Set(before.summary.uiTree.map((e) => e.id));

    let seq = 0;
    for (const step of hooks.traverseSteps) {
      await client.request("act", { action: { ...step, id: `cc-${seq++}` } }, 15000);
    }
    const after = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string }> };
    };
    const idsAfter = new Set(after.summary.uiTree.map((e) => e.id));
    for (const id of hooks.expectedIdsAfterTraverse) {
      if (!idsAfter.has(id)) throw new Error(`expected element '${id}' after traversal`);
    }

    await client.request("lifecycle", { op: "reset" }, 15000);
    const restored = (await client.request("observe", { observe: ["uiTree"] }, 20000)) as {
      summary: { uiTree: Array<{ id?: string }> };
    };
    const idsRestored = new Set(restored.summary.uiTree.map((e) => e.id));
    for (const id of idsBefore) {
      if (id && !idsRestored.has(id)) throw new Error(`reset did not restore '${id}'`);
    }
  } finally {
    await hooks.stop(client);
  }

  // Genuine target failure vs automation miss classification.
  client = await hooks.start();
  try {
    await client.request("lifecycle", { op: "create" }, 30000);
    let seq = 0;
    for (const step of hooks.traverseSteps) {
      await client.request("act", { action: { ...step, id: `cf-${seq++}` } }, 15000);
    }
    const crash = (await client.request(
      "act",
      { action: { ...hooks.crashStep, id: "cf-crash" } },
      15000,
    )) as { status: string; error?: { code: string } };
    if (crash.status !== "target-failure" || crash.error?.code !== "TARGET_FAILURE") {
      throw new Error(`expected TARGET_FAILURE, got ${crash.status}:${crash.error?.code}`);
    }
    const miss = (await client.request(
      "act",
      { action: { ...hooks.missStep, id: "cf-miss" } },
      15000,
    )) as { status: string; error?: { code: string } };
    if (miss.status !== "target-failure" || miss.error?.code !== "ACTION_FAILED") {
      throw new Error(`expected ACTION_FAILED, got ${miss.status}:${miss.error?.code}`);
    }
  } finally {
    await hooks.stop(client);
  }
}

export { act as conformanceAct };
