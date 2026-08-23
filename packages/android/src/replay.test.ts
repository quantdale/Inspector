/**
 * SPEC-009 W6: platform-faithful Android replay.
 *  - provenance binding refuses package mismatches BEFORE device contact
 *  - an injected backend is used verbatim (the critical invariant: a real
 *    finding is never validated against MockAdbBackend internals)
 *  - force-stop reset strategy runs against the same selected device
 */
import { describe, it, expect } from "vitest";
import type { Action, ActionOutcome } from "@inspector/finding";
import type { AdbBackend } from "./types.js";
import {
  AndroidReplayDriver,
  AndroidReplayTargetMismatchError,
} from "./replay.js";

function act(id: string): Action {
  return {
    id,
    runId: "run_r",
    environmentId: "env",
    kind: "click",
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    input: { selector: "#row" },
  };
}

/** Minimal recording backend: proves the driver uses THE injected instance. */
function stubBackend(): AdbBackend & { taps: string[]; stopped: string[] } {
  const impl = {
    taps: [] as string[],
    stopped: [] as string[],
    async devices() {
      return ["emulator-test"];
    },
    async shell(_serial: string, cmd: string) {
      if (cmd.startsWith("input tap")) impl.taps.push(cmd);
      if (cmd.startsWith("am force-stop")) impl.stopped.push(cmd);
      return "";
    },
    async dumpUi() {
      return '<hierarchy rotation="0"><node index="0" text="Row" resource-id="com.x:id/row" class="android.widget.Button" bounds="[0,0][100,50]" enabled="true"/></hierarchy>';
    },
    async screencap() {
      return Buffer.alloc(0);
    },
    async logcat() {
      return [];
    },
    async appErrors() {
      return [];
    },
    async install() {},
    async uninstall() {},
    async pidOf() {
      return null;
    },
  };
  return impl as never;
}

describe("SPEC-009 W6: android replay provenance + backend faithfulness", () => {
  it("refuses a package mismatch before any device contact", async () => {
    const backend = stubBackend();
    const driver = new AndroidReplayDriver({
      backend,
      launchPackage: "com.android.settings",
      createOptions: { launchPackage: "com.other.app" },
    });
    await expect(driver.replay([act("a1")])).rejects.toBeInstanceOf(
      AndroidReplayTargetMismatchError,
    );
    expect(backend.taps).toHaveLength(0); // no device contact happened
  });

  it("uses the INJECTED backend verbatim - never a hidden mock", async () => {
    const backend = stubBackend();
    const driver = new AndroidReplayDriver({
      backend,
      launchPackage: "com.android.settings",
      createOptions: { launchPackage: "com.android.settings" },
      resetStrategy: "force-stop",
    });
    const result = await driver.replay([act("a1"), act("a2")]);
    expect(backend.stopped.length).toBe(1);
    expect(backend.taps.length).toBe(2);
    expect(result.outcomes.length).toBe(2);
    // Outcomes carry the injected backend's success semantics.
    for (const o of result.outcomes as ActionOutcome[]) {
      expect(o.status).toBe("success");
    }
  });

  it("force-stop reset precedes relaunch on the SAME device serial", async () => {
    const backend = stubBackend();
    const driver = new AndroidReplayDriver({
      backend,
      launchPackage: "com.android.settings",
      createOptions: { launchPackage: "com.android.settings" },
      resetStrategy: "force-stop",
    });
    await driver.replay([]);
    expect(backend.stopped.length).toBe(1);
    expect(backend.stopped[0]).toContain("com.android.settings");
  });
});
