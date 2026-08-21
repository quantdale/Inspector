import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AdapterClient } from "@inspector/adapter-sdk";
import type { Action } from "@inspector/protocol";

const webBin = join(dirname(fileURLToPath(import.meta.url)), "bin.ts");

/**
 * External-target support tests: an inline node http server plays the role of
 * a REAL independently developed local web app (multi-page, form, client-side
 * state, one intentional console error). This is a TEST fixture only — the
 * product ships no such server.
 */

const PAGE_INDEX = `<!doctype html><html><head><title>Dogfood App</title></head>
<body>
  <h1>Dogfood Home</h1>
  <input id="name" aria-label="name" />
  <button id="go">Go</button>
  <a id="toPage2" href="/page2.html">Page 2</a>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      localStorage.setItem('df-name', document.getElementById('name').value);
      location.href = '/page2.html';
    });
  </script>
</body></html>`;

const PAGE2 = `<!doctype html><html><head><title>Dogfood Page 2</title></head>
<body>
  <h1>Dogfood Page 2</h1>
  <p id="greeting"></p>
  <button id="stateBtn">Count</button>
  <span id="count">0</span>
  <button id="errorBtn">Break</button>
  <script>
    document.getElementById('greeting').textContent =
      'hello ' + (localStorage.getItem('df-name') || 'stranger');
    let n = Number(localStorage.getItem('df-count') || '0');
    document.getElementById('count').textContent = String(n);
    document.getElementById('stateBtn').addEventListener('click', () => {
      n += 1;
      localStorage.setItem('df-count', String(n));
      document.getElementById('count').textContent = String(n);
    });
    document.getElementById('errorBtn').addEventListener('click', () => {
      console.error('intentional dogfood error');
      throw new Error('dogfood intentional failure');
    });
  </script>
</body></html>`;

function startApp(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const body =
        path === "/page2.html"
          ? PAGE2
          : PAGE_INDEX;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) throw new Error("no addr");
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const apps: Array<{ server: Server }> = [];
afterAll(() => {
  for (const a of apps) a.server.close();
});

let client: AdapterClient | null = null;
async function closeClient(): Promise<void> {
  if (client) {
    await client.request("lifecycle", { op: "close" }, 15000).catch(() => {});
    await client.close().catch(() => {});
    client = null;
  }
}

async function startWeb(env: Record<string, string> = {}): Promise<AdapterClient> {
  return AdapterClient.spawn({
    command: process.execPath,
    args: ["--import", "tsx", webBin],
    env: { ...process.env, ...env },
  });
}

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 10000, idempotency: "safe-retry", input };
}

describe("web adapter external targetUrl", () => {
  it("create with targetUrl navigates and observe returns real page data", async () => {
    const app = await startApp();
    apps.push(app);
    client = await startWeb();
    await client.request("initialize", {});
    await client.request(
      "lifecycle",
      { op: "create", options: { targetUrl: `${app.origin}/` } },
      30000,
    );
    const obs = (await client.request(
      "observe",
      { observe: ["url", "title", "uiTree"] },
      20000,
    )) as { summary: { url: string; title: string; uiTree: Array<{ id: string }> } };
    expect(obs.summary.url).toBe(`${app.origin}/`);
    expect(obs.summary.title).toBe("Dogfood App");
    expect(obs.summary.uiTree.some((e) => e.id === "go")).toBe(true);
    await closeClient();
  }, 90000);

  it("act clicks/types work against the external page", async () => {
    const app = await startApp();
    apps.push(app);
    client = await startWeb();
    await client.request("lifecycle", { op: "create", options: { targetUrl: `${app.origin}/` } }, 30000);
    await client.request("act", { action: act("t1", "fill", { selector: "#name", value: "inspector" }) }, 15000);
    await client.request("act", { action: act("t2", "click", { selector: "#go" }) }, 15000);
    const obs = (await client.request("observe", { observe: ["url", "uiTree", "storage"] }, 20000)) as {
      summary: { url: string; uiTree: Array<{ id: string; text?: string }>; storage: Record<string, string> };
    };
    expect(obs.summary.url).toBe(`${app.origin}/page2.html`);
    expect(obs.summary.storage["df-name"]).toBe("inspector");
    expect(obs.summary.uiTree.some((e) => e.id === "stateBtn")).toBe(true);
    // Client-side state mutation via click.
    await client.request("act", { action: act("t3", "click", { selector: "#stateBtn" }) }, 15000);
    await client.request("act", { action: act("t4", "click", { selector: "#stateBtn" }) }, 15000);
    const obs2 = (await client.request("observe", { observe: ["storage"] }, 20000)) as {
      summary: { storage: Record<string, string> };
    };
    expect(obs2.summary.storage["df-count"]).toBe("2");
    await closeClient();
  }, 90000);

  it("intentional app error surfaces as target-failure / pageErrors", async () => {
    const app = await startApp();
    apps.push(app);
    client = await startWeb();
    await client.request("lifecycle", { op: "create", options: { targetUrl: `${app.origin}/page2.html` } }, 30000);
    const outcome = (await client.request("act", { action: act("e1", "click", { selector: "#errorBtn" }) }, 15000)) as {
      status: string;
      error?: { code: string };
    };
    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    await closeClient();
  }, 90000);

  it("origin policy denies a second localhost origin when targetUrl is set", async () => {
    const appA = await startApp();
    const appB = await startApp();
    apps.push(appA, appB);
    client = await startWeb();
    await client.request("lifecycle", { op: "create", options: { targetUrl: `${appA.origin}/` } }, 30000);
    // Navigation to another (even localhost) origin is denied.
    await expect(
      client.request("act", { action: act("o1", "navigate", { value: `${appB.origin}/` }) }, 15000),
    ).rejects.toThrow(/CAPABILITY_DENIED/);
    // Remote origins remain denied too.
    await expect(
      client.request("act", { action: act("o2", "navigate", { value: "https://evil.example.com/" }) }, 15000),
    ).rejects.toThrow(/CAPABILITY_DENIED/);
    // And remote targetUrls are rejected outright at create.
    await expect(
      client.request("lifecycle", { op: "create", options: { targetUrl: "https://example.com/" } }, 30000),
    ).rejects.toThrow(/localhost/i);
    await closeClient();
  }, 90000);

  it("reset clears storage and restores the target baseline; unreachable target reports failure", async () => {
    const app = await startApp();
    apps.push(app);
    client = await startWeb();
    await client.request("lifecycle", { op: "create", options: { targetUrl: `${app.origin}/page2.html` } }, 30000);
    await client.request("act", { action: act("r1", "click", { selector: "#stateBtn" }) }, 15000);
    await client.request("lifecycle", { op: "reset" }, 15000);
    const obs = (await client.request("observe", { observe: ["url", "storage"] }, 20000)) as {
      summary: { url: string; storage: Record<string, string> };
    };
    expect(obs.summary.url).toBe(`${app.origin}/page2.html`);
    expect(obs.summary.storage["df-count"]).toBeUndefined();

    // Honest reset: kill the server, reset must report ok:false.
    await closeClient();
    client = await startWeb();
    await client.request("lifecycle", { op: "create", options: { targetUrl: `${app.origin}/page2.html` } }, 30000);
    app.server.close();
    const res = (await client.request("lifecycle", { op: "reset" }, 30000)) as { ok: boolean };
    expect(res.ok).toBe(false);
    await closeClient();
  }, 120000);

  it("absence of targetUrl keeps seeded behavior unchanged", async () => {
    client = await startWeb();
    await client.request("lifecycle", { op: "create" }, 30000);
    const obs = (await client.request("observe", { observe: ["url", "title", "uiTree"] }, 20000)) as {
      summary: { title: string; uiTree: Array<{ id: string }> };
    };
    expect(obs.summary.title).toBe("SeedBank");
    expect(obs.summary.uiTree.some((e) => e.id === "loginBtn")).toBe(true);
    await closeClient();
  }, 90000);
});
