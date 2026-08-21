import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AndroidAdapterHandler, MockAdbBackend, SEED_PACKAGE } from "./index.js";

const ART_BASE = join(tmpdir(), "inspector-android-lifecycle");

/** Records every shell command and install/uninstall call for assertions. */
class RecordingBackend extends MockAdbBackend {
  readonly commands: string[] = [];
  readonly installs: string[] = [];
  readonly uninstalls: string[] = [];
  override async shell(serial: string, cmd: string): Promise<string> {
    this.commands.push(cmd);
    return super.shell(serial, cmd);
  }
  override async install(serial: string, apkPath: string): Promise<void> {
    this.installs.push(apkPath);
    return super.install(serial, apkPath);
  }
  override async uninstall(serial: string, pkg: string): Promise<void> {
    this.uninstalls.push(pkg);
    return super.uninstall(serial, pkg);
  }
}

describe("android lifecycle options (no-seed default)", () => {
  it("create without seedApk performs NO install (real-backend safe)", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await expect(handler.lifecycle({ op: "create" })).resolves.toEqual({ ok: true });
    expect(backend.installs).toEqual([]);
    expect(backend.uninstalls).toEqual([]);
  });

  it("create with launchPackage launches the app without installing", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { launchPackage: "com.android.settings" } });
    expect(backend.installs).toEqual([]);
    expect(backend.commands).toContain(
      "monkey -p com.android.settings -c android.intent.category.LAUNCHER 1",
    );
  });

  it("create with launchActivity uses am start -n pkg/activity", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({
      op: "create",
      options: { launchPackage: "com.android.settings", launchActivity: ".Settings" },
    });
    expect(backend.commands).toContain("am start -n com.android.settings/.Settings");
  });

  it("reset with launchPackage force-stops, clears data, and relaunches", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { launchPackage: "com.example.app" } });
    backend.commands.length = 0;
    await handler.lifecycle({ op: "reset", options: { launchPackage: "com.example.app" } });
    expect(backend.installs).toEqual([]);
    expect(backend.commands).toContain("am force-stop com.example.app");
    expect(backend.commands).toContain("pm clear com.example.app");
    expect(backend.commands).toContain(
      "monkey -p com.example.app -c android.intent.category.LAUNCHER 1",
    );
  });

  it("reset without any options is a no-op ok (no install/uninstall)", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create" });
    backend.commands.length = 0;
    await expect(handler.lifecycle({ op: "reset" })).resolves.toEqual({ ok: true });
    expect(backend.commands).toEqual([]);
    expect(backend.installs).toEqual([]);
    expect(backend.uninstalls).toEqual([]);
  });
});

describe("android lifecycle options (seeded path unchanged)", () => {
  it("create with seedApk installs exactly the given APK and nothing else", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { seedApk: "/fixtures/seeddroid.apk" } });
    expect(backend.installs).toEqual(["/fixtures/seeddroid.apk"]);
    // No launch command is issued on the seeded path (byte-compatible).
    expect(backend.commands.filter((c) => c.startsWith("am start") || c.startsWith("monkey"))).toEqual([]);
  });

  it("reset with seedApk reinstalls the seed package (legacy behavior)", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { seedApk: "/fixtures/seeddroid.apk" } });
    backend.installs.length = 0;
    backend.commands.length = 0;
    await handler.lifecycle({ op: "reset", options: { seedApk: "/fixtures/seeddroid.apk" } });
    expect(backend.uninstalls).toEqual([SEED_PACKAGE]);
    expect(backend.installs).toEqual(["/fixtures/seeddroid.apk"]);
    expect(backend.commands).toEqual([]);
  });

  it("observations report the launched package when launchPackage is set", async () => {
    const backend = new RecordingBackend();
    const handler = new AndroidAdapterHandler(backend, {}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { launchPackage: "com.example.app" } });
    const obs = await handler.observe({});
    expect(obs.summary.url).toBe("android://emulator-5554/com.example.app");
  });
});
