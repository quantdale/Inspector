import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { RunManager } from "./run-manager.js";

const here = dirname(fileURLToPath(import.meta.url));
const logBin = join(here, "fixtures", "lifecycle-log-adapter.mjs");

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function setup(): { base: string; logFile: string } {
  dir = mkdtempSync(join(tmpdir(), "inspector-core-createopts-"));
  return { base: dir, logFile: join(dir, "lifecycle.log") };
}

function readLifecycleCalls(logFile: string): Array<Record<string, unknown>> {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("startRun lifecycle-create attribution", () => {
  it("forwards createOptions alongside controller attribution", async () => {
    const { base, logFile } = setup();
    const store = Store.open(join(base, "run.db"));
    const mgr = new RunManager(store, new ArtifactStore(join(base, "artifacts")));
    const run = await mgr.startRun({
      adapterCommand: process.execPath,
      adapterArgs: [logBin],
      adapterEnv: { ...process.env, LIFECYCLE_LOG_FILE: logFile },
      createOptions: { targetUrl: "http://127.0.0.1:3000/" },
    });
    await run.close();

    const creates = readLifecycleCalls(logFile).filter((c) => c.op === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.options).toEqual({
      targetUrl: "http://127.0.0.1:3000/",
      runId: run.runId,
      environmentId: run.environmentId,
    });
    store.close();
  });

  it("supplies controller attribution when createOptions is absent", async () => {
    const { base, logFile } = setup();
    const store = Store.open(join(base, "run.db"));
    const mgr = new RunManager(store, new ArtifactStore(join(base, "artifacts")));
    const run = await mgr.startRun({
      adapterCommand: process.execPath,
      adapterArgs: [logBin],
      adapterEnv: { ...process.env, LIFECYCLE_LOG_FILE: logFile },
    });
    await run.close();

    const creates = readLifecycleCalls(logFile).filter((c) => c.op === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.options).toEqual({
      runId: run.runId,
      environmentId: run.environmentId,
    });
    store.close();
  });
});
