/**
 * INTEGRATION: drives real Windows applications through the production UIA
 * backend (PowerShell UI Automation bridge). Skipped entirely when the
 * environment cannot enumerate a real UIA tree. Bounded well under 90s.
 */
import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { PowerShellUiaBridge } from "./uia-bridge.js";
import { RealUiaBackend } from "./real-uia.js";
import { probeRealUia } from "./selection.js";

const available = await probeRealUia();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True while the given pid is still a live process. */
function pidAlive(pid: number): boolean {
  const out = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    timeout: 10000,
  });
  return typeof out.stdout === "string" && out.stdout.includes(String(pid));
}

async function waitUntil(fn: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
}

describe.skipIf(!available)("windows real UIA backend (integration)", () => {
  it(
    "launches Paint, attaches, reads the semantic tree, exercises invoke/value, closes cleanly",
    { timeout: 85000 },
    async () => {
      // Baseline: no orphaned bridge hosts before we start.
      const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
      const backend = new RealUiaBackend(bridge);
      let paintPid = 0;
      let bridgePid: number | null = null;
      try {
        // Launch Paint the way an external workflow would.
        const launcher = spawn("cmd", ["/c", "start", "mspaint"], {
          detached: true,
          stdio: "ignore",
        });
        launcher.unref();

        // Resolve the Paint pid by process name (locale-independent).
        const pidOut = spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process mspaint | Select-Object -First 1).Id"],
          { encoding: "utf8", timeout: 20000 },
        );
        paintPid = Number.parseInt((pidOut.stdout ?? "").trim(), 10);
        expect(Number.isFinite(paintPid)).toBe(true);

        // Attach once Paint's top-level window is enumerable.
        const appeared = await waitUntil(async () => {
          try {
            const wins = await backend.listWindows();
            if (wins.some((w) => w.pid === paintPid)) {
              await backend.attach({ pid: paintPid });
              return true;
            }
          } catch {
            /* window not enumerable yet; keep polling */
          }
          return false;
        }, 40000);
        expect(appeared).toBe(true);

        // Semantic tree: Paint exposes a rich control tree.
        const tree = await backend.richTree();
        expect(tree.pid).toBe(paintPid);
        expect(tree.nodes.length).toBeGreaterThan(10);
        const buttons = tree.nodes.filter(
          (n) => n.type === "Button" && n.patterns.some((p) => p.includes("Invoke")),
        );
        expect(buttons.length).toBeGreaterThan(0);
        // Real IsOffscreen data must be present (no fabricated geometry).
        expect(tree.nodes.every((n) => typeof n.offscreen === "boolean")).toBe(true);

        // Invoke a control (a tool button; harmless state change).
        await backend.invoke(buttons[0]!.id);

        // Value roundtrip where the app supports the Value pattern.
        const valueNodes = tree.nodes.filter((n) => n.patterns.some((p) => p.includes("ValuePattern")));
        if (valueNodes.length > 0) {
          const before = await backend.readValue(valueNodes[0]!.id);
          await backend.setValue(valueNodes[0]!.id, before);
          expect(await backend.readValue(valueNodes[0]!.id)).toBe(before);
        } else {
          // Documented limitation: this app exposes no Value-pattern control.
          console.warn("[real-uia integration] no ValuePattern control exposed; value/set skipped");
        }

        // Close the app gracefully through the Window pattern, then wait for
        // the top-level window to disappear from the UIA tree.
        await backend.closeWindow();
        const closed = await waitUntil(async () => {
          try {
            const wins = await backend.listWindows();
            return !wins.some((w) => w.pid === paintPid);
          } catch {
            return false; // bridge hiccup; keep polling until deadline
          }
        }, 25000);
        expect(closed).toBe(true);

        // A runtime id that no longer exists in the tree must fail with
        // STALE_ELEMENT, never act on a guess. (Note: the closed window's own
        // handles can remain resolvable while the packaged process lingers,
        // so staleness is exercised with a genuinely absent id.)
        await expect(backend.invoke("9999999-9999999-1")).rejects.toThrow(/STALE_ELEMENT/);

        // Packaged apps (Win11 Paint) can outlive their last window; make the
        // "no leftover process" guarantee explicit rather than assuming the
        // OS reaped it.
        if (pidAlive(paintPid)) {
          spawnSync("taskkill", ["/PID", String(paintPid), "/T", "/F"], { timeout: 15000 });
        }
        const reaped = await waitUntil(() => !pidAlive(paintPid), 15000);
        expect(reaped).toBe(true);
      } finally {
        // Guarantee no leftover application process even on failure.
        if (paintPid && pidAlive(paintPid)) {
          spawnSync("taskkill", ["/PID", String(paintPid), "/T", "/F"], { timeout: 15000 });
        }
        bridge.dispose();
        bridgePid = bridge.childPid;
      }

      // No orphaned PowerShell bridge host after dispose.
      expect(bridgePid).not.toBeNull();
      const reaped = await waitUntil(() => !pidAlive(bridgePid!), 15000);
      expect(reaped).toBe(true);
    },
  );

  it(
    "waitForWindow resolves on cold start and times out typed; tree throws DEAD_WINDOW after kill",
    { timeout: 70000 },
    async () => {
      const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
      const backend = new RealUiaBackend(bridge);
      let paintPid = 0;
      try {
        // Cold start: the spawned launcher pid differs from / precedes the
        // window's appearance in the top-level list, exactly the gap
        // waitForWindow exists for.
        const launcher = spawn("cmd", ["/c", "start", "mspaint"], {
          detached: true,
          stdio: "ignore",
        });
        launcher.unref();
        const pidOut = spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process mspaint | Select-Object -First 1).Id"],
          { encoding: "utf8", timeout: 20000 },
        );
        paintPid = Number.parseInt((pidOut.stdout ?? "").trim(), 10);
        expect(Number.isFinite(paintPid)).toBe(true);

        // Success path: bounded poll until the window is enumerable.
        const win = await backend.waitForWindow({ pid: paintPid, timeoutMs: 40000 });
        expect(win.pid).toBe(paintPid);
        await backend.attach({ pid: paintPid });
        const tree = await backend.richTree();
        expect(tree.pid).toBe(paintPid);
        expect(tree.nodes.length).toBeGreaterThan(0);

        // Timeout path: impossible pid must fail fast with WINDOW_NOT_FOUND.
        await expect(
          backend.waitForWindow({ pid: 999999, timeoutMs: 1500 }),
        ).rejects.toMatchObject({ code: "WINDOW_NOT_FOUND" });

        // Kill probe: after the process dies, richTree must throw a typed
        // DEAD_WINDOW instead of returning stale/cached data.
        spawnSync("taskkill", ["/PID", String(paintPid), "/T", "/F"], { timeout: 15000 });
        const dead = await waitUntil(() => !pidAlive(paintPid), 15000);
        expect(dead).toBe(true);
        await expect(backend.richTree()).rejects.toMatchObject({ code: "DEAD_WINDOW" });
      } finally {
        if (paintPid && pidAlive(paintPid)) {
          spawnSync("taskkill", ["/PID", String(paintPid), "/T", "/F"], { timeout: 15000 });
        }
        bridge.dispose();
      }
    },
  );
});
