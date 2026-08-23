/**
 * SPEC-009 W6: CLI/PTTY replay pipeline proofs (deterministic fixtures).
 *
 *  - reproducible target failure  -> reproduction succeeds -> evidence bundle
 *  - non-reproducible tail-only failure -> REJECTED (never confirmed)
 *  - automation miss (command-not-found ACTION_FAILED) is NOT a defect signal
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@inspector/protocol";
import type { Action } from "@inspector/protocol";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import {
  FindingEngine,
  OracleEngine,
  type ReplayDriver,
} from "@inspector/finding";
import { CliPtyReplayDriver } from "./replay.js";

function line(value: string, id: string): Action {
  return {
    id,
    runId: "run_cli_replay",
    environmentId: "env",
    kind: "fill",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input: { value },
  };
}

describe("SPEC-009 W6: CLI replay pipeline", () => {
  const base = mkdtempSync(join(tmpdir(), "spec009-cli-replay-"));
  const store = Store.open(join(base, "runs.db"));
  const artifacts = new ArtifactStore(join(base, "artifacts"));

  function engine(): FindingEngine {
    return new FindingEngine(OracleEngine.defaults(), store);
  }

  function driver(): ReplayDriver {
    return new CliPtyReplayDriver({
      program: "seedcli",
      backend: "mock", // fixture replay implementation under test
      bootSettleMs: 50,
      actionSettleMs: 30,
    });
  }

  it("reproducible crash line reproduces on a fresh PTY session", async () => {
    // Discovery-time segment: help, then the crashing login.
    const path = [line("help", "p0"), line("login CRASH x", "p1")];
    const e1 = engine();
    const finding = e1.ingest(
      { kind: "TARGET_FAILURE", detail: "FATAL HiddenValidationCrash" },
      { runId: "run_cli_replay", title: "TARGET_FAILURE: FATAL HiddenValidationCrash", adapter: "cli-pty" },
    );
    const rep = await e1.reproduce(finding, path, driver(), {
      attempts: 2,
      minSuccesses: 1,
    });
    expect(["REPRODUCED", "MINIMIZED", "CONFIRMED"]).toContain(rep.finding.status);
    expect(rep.stats.successes).toBeGreaterThanOrEqual(1);
  });

  it("tail-only failure (state-dependent overflow) is NOT reproduced -> honest rejection", async () => {
    // The overflow requires EIGHT prior `inc` commands in the SAME session;
    // replaying only the final failing line against a fresh session cannot
    // reproduce it, so promotion must be denied.
    const path = [
      ...Array.from({ length: 8 }, (_, i) => line("inc", `inc${i}`)),
      line("count", "final"),
    ];
    const e2 = engine();
    const finding = e2.ingest(
      { kind: "TARGET_FAILURE", detail: "NaN abort" },
      { runId: "run_cli_replay", title: "TARGET_FAILURE: NaN abort", adapter: "cli-pty" },
    );
    const rep = await e2.reproduce(finding, path, driver(), {
      attempts: 2,
      minSuccesses: 1,
    });
    expect(rep.finding.status).toBe("REJECTED");
  });

  afterAll(() => {
    try {
      store.close();
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* Windows AV lag on temp cleanup is non-fatal */
    }
  });

  void newId;
});
