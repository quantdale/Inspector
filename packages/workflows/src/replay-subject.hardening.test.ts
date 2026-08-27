import { describe, it, expect } from "vitest";
import { replayDriverFor, WorkflowProvenanceError } from "./replay-subject.js";
import type { LoadedReplaySubject } from "./replay-subject.js";

function electronSubject(spawnEnv: Record<string, unknown>): LoadedReplaySubject {
  return {
    record: {} as LoadedReplaySubject["record"],
    finding: { id: "f-electron", adapter: "electron-chromium" } as LoadedReplaySubject["finding"],
    run: { adapter: "electron-chromium" } as LoadedReplaySubject["run"],
    environment: {
      adapter: "electron-chromium",
      create_options: JSON.stringify({}),
      spawn_env: JSON.stringify(spawnEnv),
    } as LoadedReplaySubject["environment"],
    bundle: {} as LoadedReplaySubject["bundle"],
    bundlePath: "/dev/null",
  };
}

describe("HARDENING_5 H5-D11: durable replay backend provenance is explicit", () => {
  it("refuses electron replay that lacks durable backend provenance (never auto-selects from current host)", async () => {
    const subject = electronSubject({}); // no INSPECTOR_ELECTRON_BACKEND
    await expect(replayDriverFor(subject, "/tmp")).rejects.toThrow(WorkflowProvenanceError);
    await expect(replayDriverFor(subject, "/tmp")).rejects.toThrow(/backend provenance/i);
  });

  it("pins the recorded electron backend instead of falling back to auto", async () => {
    const subject = electronSubject({ INSPECTOR_ELECTRON_BACKEND: "injectable" });
    const driver = await replayDriverFor(subject, "/tmp");
    expect(driver).toBeDefined();
  });
});
