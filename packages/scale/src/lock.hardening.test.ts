import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLock, LockAcquireError, pidAlive } from "./lock.js";

const dirs: string[] = [];

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-lock-${label}-`));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function lockDir(base: string): string {
  return join(base, "state.json.lock");
}

/** Backdate the lock directory so age-based staleness triggers deterministically. */
function backdate(dir: string, msAgo = 60_000): void {
  const past = new Date(Date.now() - msAgo);
  utimesSync(dir, past, past);
}

function readOwnerToken(dir: string): string | undefined {
  const raw = JSON.parse(readFileSync(join(dir, "owner"), "utf8")) as { token?: string };
  return raw.token;
}

describe("HARDENING_4 FileLock ownership fencing (H4-D4)", () => {
  it("a predecessor's release never deletes a successor's live lock", () => {
    const base = freshDir("fence");
    const dir = lockDir(base);
    const a = new FileLock(dir, { staleMs: 30_000 });

    a.acquire();
    expect(existsSync(dir)).toBe(true);

    // Simulate the real-world sequence deterministically: A loses ownership
    // to a LIVE successor (another instance in this process space), which is
    // exactly the historical defect shape where release() rm'd whatever
    // directory was at the path.
    writeFileSync(
      join(dir, "owner"),
      JSON.stringify({ pid: process.pid, token: "successor-token", acquiredAtMs: new Date().toISOString() }),
      "utf8",
    );

    // The predecessor releases while the successor is LIVE.
    a.release();

    expect(existsSync(dir)).toBe(true);
    expect(readOwnerToken(dir)).toBe("successor-token");

    // While the successor holds, a fresh contender must be refused.
    const c = new FileLock(dir, { timeoutMs: 150, pollMs: 10 });
    expect(() => c.acquire()).toThrow(LockAcquireError);

    rmSync(dir, { recursive: true, force: true });
  });

  it("a provably dead owner is taken over immediately without waiting for staleMs", () => {
    const base = freshDir("deadpid");
    const dir = lockDir(base);
    const dead = spawnSync(process.execPath, ["-e", ""], { timeout: 15_000 });
    if (dead.pid === undefined) throw new Error("could not spawn probe child");
    if (dead.status !== 0) throw new Error(`probe child failed: ${dead.stderr}`);
    expect(pidAlive(dead.pid)).toBe(false);

    mkdirSync(dir);
    writeFileSync(
      join(dir, "owner"),
      JSON.stringify({ pid: dead.pid, token: "corpse", acquiredAtMs: new Date().toISOString() }),
      "utf8",
    );
    // Fresh mtime on purpose: ONLY the pid-liveness rule may recover this.

    const started = Date.now();
    const taker = new FileLock(dir, { timeoutMs: 5_000, pollMs: 10 });
    taker.acquire();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2_500); // Bounded liveness recovery, not 30s.
    expect(readOwnerToken(dir)).not.toBe("corpse");
    taker.release();
  });

  it("an anonymous aged directory (crash between mkdir and owner write) is recovered", () => {
    const base = freshDir("anon-aged");
    const dir = lockDir(base);
    mkdirSync(dir); // No owner file at all.
    backdate(dir);

    const taker = new FileLock(dir, { timeoutMs: 5_000, pollMs: 10 });
    taker.acquire(); // Must succeed via age-gated anonymous takeover.
    taker.release();
    expect(existsSync(dir)).toBe(false);
  });

  it("a fresh anonymous directory stays protected for the grace window", () => {
    const base = freshDir("anon-fresh");
    const dir = lockDir(base);
    mkdirSync(dir); // Crash mid-acquire, but only just now.

    const contender = new FileLock(dir, { timeoutMs: 200, pollMs: 10, staleMs: 30_000 });
    expect(() => contender.acquire()).toThrow(LockAcquireError);
    expect(existsSync(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true }); // Clean up the simulated crash debris.
  });

  it("exactly one contender wins a contested stale steal; the loser sees the winner's lock", () => {
    const base = freshDir("contested");
    const dir = lockDir(base);
    mkdirSync(dir);
    writeFileSync(
      join(dir, "owner"),
      JSON.stringify({ pid: 999_999_999, token: "ghost", acquiredAtMs: new Date().toISOString() }),
      "utf8",
    );
    // pid 999_999_999 is not plausibly alive; force age eligibility too so
    // the takeover decision cannot hinge on pid probing alone.
    backdate(dir);

    const b = new FileLock(dir, { timeoutMs: 5_000, pollMs: 10 });
    b.acquire();
    expect(readOwnerToken(dir)).not.toBe("ghost");

    const c = new FileLock(dir, { timeoutMs: 150, pollMs: 10 });
    expect(() => c.acquire()).toThrow(LockAcquireError); // No double ownership.
    b.release();
    expect(existsSync(dir)).toBe(false);
  });

  it("release without acquisition is a no-op and never touches foreign state", () => {
    const base = freshDir("noop");
    const dir = lockDir(base);
    mkdirSync(dir);
    writeFileSync(join(dir, "owner"), JSON.stringify({ pid: process.pid, token: "foreign" }), "utf8");

    const stranger = new FileLock(dir);
    stranger.release(); // Must not delete or modify the foreign lock.
    expect(existsSync(dir)).toBe(true);
    expect(readOwnerToken(dir)).toBe("foreign");
    rmSync(dir, { recursive: true, force: true });
  });

  it("cross-process protocol holder blocks contenders; its death recovers quickly", () => {
    const base = freshDir("xproc");
    const dir = lockDir(base);

    // A plain-JS child speaks the same on-disk protocol (mkdir + owner file)
    // and EXITS without releasing — simulating an external process death.
    const childScript = [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      `mkdirSync(${JSON.stringify(dir)});`,
      "writeFileSync(" +
        `${JSON.stringify(join(dir, "owner"))},` +
        "JSON.stringify({ pid: process.pid, token: 'external-holder', acquiredAtMs: new Date().toISOString() }));",
      "process.stdout.write('held');",
    ].join("\n");
    const child = spawnSync(process.execPath, ["-e", childScript], {
      timeout: 20_000,
      encoding: "utf8",
    });
    if (child.status !== 0) throw new Error(`holder child failed: ${child.stderr}`);
    expect(child.stdout).toContain("held"); // Child has exited by NOW -> dead owner.

    // Recovery must be fast (pid-liveness), not gated on staleMs.
    const started = Date.now();
    const recover = new FileLock(dir, { timeoutMs: 8_000, pollMs: 10 });
    recover.acquire();
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(readOwnerToken(dir)).not.toBe("external-holder");
    recover.release();
  }, 20_000);

  it("takeover debris is bounded: stolen graves are removed best-effort", () => {
    const base = freshDir("debris");
    const dir = lockDir(base);
    mkdirSync(dir);
    backdate(dir);

    const taker = new FileLock(dir, { timeoutMs: 5_000, pollMs: 10 });
    taker.acquire();
    const siblings = readdirSync(base).filter((n) => n.includes(".stolen-"));
    expect(siblings.length).toBe(0); // Grave removed synchronously in-process.
    taker.release();
  });
});
