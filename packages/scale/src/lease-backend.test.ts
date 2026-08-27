import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeaseManager } from "./leases.js";
import { MemoryLeaseStore } from "./lease-memory.js";

type Backend = "memory" | "sqlite" | "file";

const BACKENDS: Backend[] = ["memory", "sqlite", "file"];

const dirs: string[] = [];
const managers: LeaseManager[] = [];

afterEach(() => {
  for (const m of managers.splice(0)) {
    try {
      m.close();
    } catch {
      // ignore
    }
  }
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
    MemoryLeaseStore.__clearForTest(d);
  }
  MemoryLeaseStore.__clearAllForTest();
});

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lease-backend-${label}-`));
  dirs.push(dir);
  return dir;
}

function makeManager(dir: string, backend: Backend, now: () => number, ttlMs = 1000): LeaseManager {
  const m = new LeaseManager(dir, now, ttlMs, { backend });
  managers.push(m);
  return m;
}

function runParityScenario(backend: Backend): void {
  const dir = freshDir(backend);
  let nowMs = 1_000;
  const now = () => nowMs;
  const mgr = makeManager(dir, backend, now, 1000);

  // 1. acquire succeeds, generation 1, fencing baseline
  const a1 = mgr.acquire("item-a", "w1");
  expect(a1.ok).toBe(true);
  if (!a1.ok) throw new Error("a1 must succeed");
  expect(a1.lease.generation).toBe(1);
  expect(a1.lease.workerId).toBe("w1");

  // 2. second worker held while not expired
  const held = mgr.acquire("item-a", "w2");
  expect(held.ok).toBe(false);
  if (held.ok) throw new Error("held expected");
  expect(held.reason).toBe("held");

  // 3. list reflects live lease
  expect(mgr.list()).toHaveLength(1);
  expect(mgr.list()[0]?.itemId).toBe("item-a");
  expect(mgr.inFlight(nowMs)).toHaveLength(1);
  expect(mgr.inFlight(nowMs)[0]?.expired).toBe(false);

  // 4. renew with correct generation extends TTL
  nowMs += 500;
  const okRenew = mgr.renew("item-a", "w1", 1);
  expect(okRenew).toBe(true);
  // wrong worker cannot renew
  expect(mgr.renew("item-a", "w2", 1)).toBe(false);
  // stale generation cannot renew
  expect(mgr.renew("item-a", "w1", 999)).toBe(false);

  // 5. release removes lease; new worker can acquire (fresh generation after delete)
  mgr.release("item-a", "w1");
  expect(mgr.list()).toHaveLength(0);
  const a2 = mgr.acquire("item-a", "w2");
  expect(a2.ok).toBe(true);
  if (!a2.ok) throw new Error("a2 must succeed");
  // after release the stored lease was deleted, so generation restarts at 1
  expect(a2.lease.generation).toBe(1);
  expect(a2.lease.workerId).toBe("w2");
  mgr.release("item-a", "w2");

  // 6. TTL expiration + generation fencing
  nowMs = 5_000;
  // need fresh manager or same: acquire at new time
  const b1 = mgr.acquire("item-b", "w1");
  expect(b1.ok).toBe(true);
  if (!b1.ok) throw new Error("b1 must succeed");
  const gen1 = b1.lease.generation;
  expect(gen1).toBe(1);
  // not yet expired
  expect(mgr.inFlight(nowMs + 500)[0]?.expired).toBe(false);
  // advance past TTL
  nowMs += 1500;
  expect(mgr.inFlight(nowMs)[0]?.expired).toBe(true);
  // reclaim by w2 bumps generation (fencing)
  const reclaim = mgr.acquire("item-b", "w2");
  expect(reclaim.ok).toBe(true);
  if (!reclaim.ok) throw new Error("reclaim must succeed");
  expect(reclaim.lease.generation).toBe(gen1 + 1);
  expect(reclaim.lease.workerId).toBe("w2");
  // old owner fenced: renew and complete with stale generation fail
  expect(mgr.renew("item-b", "w1", gen1)).toBe(false);
  expect(mgr.complete("item-b", "w1", gen1)).toBe(false);
  // new owner can renew with current generation
  expect(mgr.renew("item-b", "w2", gen1 + 1)).toBe(true);
  // complete with current generation succeeds, moves to done
  expect(mgr.complete("item-b", "w2", gen1 + 1)).toBe(true);
  expect(mgr.isDone("item-b")).toBe(true);
  expect(mgr.list()).toHaveLength(0);
  // done items are fenced: further acquire returns done
  const doneAcquire = mgr.acquire("item-b", "w1");
  expect(doneAcquire.ok).toBe(false);
  if (!doneAcquire.ok) expect(doneAcquire.reason).toBe("done");
}

describe.each(BACKENDS)("lease backend parity: %s", (backend) => {
  it("same acquire / renew / release / fencing scenario", () => {
    runParityScenario(backend);
  });

  it("concurrent workers (≥2) see serialized leases", () => {
    const dir = freshDir(`${backend}-concurrent`);
    const nowMs = 0;
    const now = () => nowMs;
    const m1 = makeManager(dir, backend, now, 1000);
    const m2 = new LeaseManager(dir, now, 1000, { backend });
    managers.push(m2);

    const r1 = m1.acquire("item-x", "w1");
    expect(r1.ok).toBe(true);
    // m2 cannot steal while held
    const r2 = m2.acquire("item-x", "w2");
    expect(r2.ok).toBe(false);

    // different items can be held concurrently
    const r3 = m2.acquire("item-y", "w2");
    expect(r3.ok).toBe(true);

    // list via either manager shows both leases (filesystem/sqlite/memory shared)
    expect(m1.list().length).toBe(2);
    expect(m2.list().length).toBe(2);

    // cleanup
    m1.release("item-x", "w1");
    m2.release("item-y", "w2");
    expect(m1.list()).toHaveLength(0);
    void nowMs;
  });

  it("restart / recovery: controller restart while leases held", () => {
    const dir = freshDir(`${backend}-restart`);
    let nowMs = 100;
    const now = () => nowMs;
    const m1 = makeManager(dir, backend, now, 1000);
    const a = m1.acquire("item-r", "w1");
    expect(a.ok).toBe(true);
    const gen = a.ok ? a.lease.generation : 0;

    // simulate restart: new manager on same dir, same time
    const m2 = new LeaseManager(dir, now, 1000, { backend });
    managers.push(m2);
    expect(m2.list()).toHaveLength(1);
    expect(m2.list()[0]?.workerId).toBe("w1");
    // non-owner still cannot renew
    expect(m2.renew("item-r", "w2", gen)).toBe(false);
    // owner can still renew
    expect(m2.renew("item-r", "w1", gen)).toBe(true);

    // expire and reclaim after restart proves fencing survives restart
    nowMs += 2000;
    const re = m2.acquire("item-r", "w2");
    expect(re.ok).toBe(true);
    if (re.ok) expect(re.lease.generation).toBe(gen + 1);
    // stale completion fenced
    expect(m2.complete("item-r", "w1", gen)).toBe(false);
    expect(m2.complete("item-r", "w2", gen + 1)).toBe(true);
  });
});
