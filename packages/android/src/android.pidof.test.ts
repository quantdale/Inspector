import { describe, expect, it } from "vitest";
import { AdbError } from "./adb-errors.js";
import { MockAdbBackend, SEED_PACKAGE } from "./mock-backend.js";
import { parsePidofOutcome, RealAdbBackend } from "./real-backend.js";
import type { RunResult } from "./real-backend.js";

function result(code: number | null, stdout = ""): RunResult {
  return { stdout: Buffer.from(stdout), stderr: "", code };
}

describe("parsePidofOutcome", () => {
  it("returns the trimmed pid string(s) on success", () => {
    expect(parsePidofOutcome(0, Buffer.from("1234\n"))).toBe("1234");
    expect(parsePidofOutcome(0, Buffer.from(" 12 34 \n"))).toBe("12 34");
  });

  it("resolves null on exit 1 with empty output (not running)", () => {
    expect(parsePidofOutcome(1, Buffer.from(""))).toBeNull();
    expect(parsePidofOutcome(1, Buffer.from("\n"))).toBeNull();
  });

  it("throws ADB_COMMAND_FAILED on unexpected outcomes", () => {
    for (const [code, out] of [
      [2, ""],
      [137, ""],
      [0, ""],
      [1, "unexpected"],
    ] as const) {
      try {
        parsePidofOutcome(code, Buffer.from(out));
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AdbError);
        expect((e as AdbError).code).toBe("ADB_COMMAND_FAILED");
      }
    }
  });
});

describe("RealAdbBackend.pidOf", () => {
  it("returns the pid string when the package is running", async () => {
    const backend = new RealAdbBackend("adb", 5_000, (_p, args) =>
      Promise.resolve(
        args.includes("echo ok") ? result(0, "ok") : result(0, "4321\n"),
      ),
    );
    await expect(backend.pidOf("emulator-5554", "com.example.app")).resolves.toBe("4321");
  });

  it("resolves null without throwing when the process is absent (exit 1)", async () => {
    const backend = new RealAdbBackend("adb", 5_000, (_p, args) =>
      Promise.resolve(args.includes("echo ok") ? result(0, "ok") : result(1, "")),
    );
    await expect(backend.pidOf("emulator-5554", "com.example.app")).resolves.toBeNull();
  });

  it("throws ADB_COMMAND_FAILED only on genuine unexpected exits", async () => {
    const backend = new RealAdbBackend("adb", 5_000, (_p, args) =>
      Promise.resolve(args.includes("echo ok") ? result(0, "ok") : result(2, "")),
    );
    await expect(backend.pidOf("emulator-5554", "com.example.app")).rejects.toMatchObject({
      code: "ADB_COMMAND_FAILED",
    });
  });

  it("maps timeouts during the liveness probe to DEVICE_NOT_ALIVE", async () => {
    const backend = new RealAdbBackend(
      "adb",
      5_000,
      (_p, _args) => Promise.reject(new AdbError("ADB_TIMEOUT", "adb timed out", { timeoutMs: 5_000 })),
    );
    await expect(backend.pidOf("emulator-5554", "com.example.app")).rejects.toMatchObject({
      code: "DEVICE_NOT_ALIVE",
    });
  });

  it("throws DEVICE_OFFLINE when the liveness probe fails", async () => {
    const backend = new RealAdbBackend("adb", 5_000, (_p, _args) => Promise.resolve(result(null, "")));
    await expect(backend.pidOf("emulator-5554", "com.example.app")).rejects.toMatchObject({
      code: "DEVICE_OFFLINE",
    });
  });
});

describe("MockAdbBackend.pidOf (mirrors the real contract)", () => {
  it("resolves null before any launch and after force-stop / pm clear", async () => {
    const mock = new MockAdbBackend();
    await expect(mock.pidOf("emulator-5554", SEED_PACKAGE)).resolves.toBeNull();

    await mock.shell("emulator-5554", `am start -n ${SEED_PACKAGE}/.MainActivity`);
    const pid = await mock.pidOf("emulator-5554", SEED_PACKAGE);
    expect(pid).toMatch(/^\d+$/);

    await mock.shell("emulator-5554", `am force-stop ${SEED_PACKAGE}`);
    await expect(mock.pidOf("emulator-5554", SEED_PACKAGE)).resolves.toBeNull();

    await mock.shell("emulator-5554", `monkey -p ${SEED_PACKAGE} 1`);
    await expect(mock.pidOf("emulator-5554", SEED_PACKAGE)).resolves.not.toBeNull();
    await mock.shell("emulator-5554", `pm clear ${SEED_PACKAGE}`);
    await expect(mock.pidOf("emulator-5554", SEED_PACKAGE)).resolves.toBeNull();
  });

  it("throws a typed error when the device is down", async () => {
    const mock = new MockAdbBackend();
    mock.deviceCrashed = true;
    await expect(mock.pidOf("emulator-5554", SEED_PACKAGE)).rejects.toThrow(/offline/);
  });
});
