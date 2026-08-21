import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { WebReplayDriver } from "./web-replay.js";
import { FindingEngine } from "@inspector/finding";
import type { Action } from "@inspector/protocol";

/**
 * External-target reproduction tests: a hunt discovers an anomaly on a REAL
 * external localhost app; WebReplayDriver({ targetUrl }) must reproduce it
 * against that SAME app (not the embedded seeded app). Mirrors the inline
 * http fixture from adapter-web's target-url tests. Test-only fixture.
 */
const PAGE = `<!doctype html><html><head><title>Crash App</title></head>
<body>
  <button id="crashBtn">Break</button>
  <script>
    document.getElementById('crashBtn').addEventListener('click', () => {
      console.error('intentional crash app error');
      throw new Error('crash app intentional failure');
    });
  </script>
</body></html>`;

function startApp(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
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

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 10000, idempotency: "safe-retry", input };
}

/** The action path a hunt would capture: click the crashing control. */
const huntActionPath = [act("h1", "click", { selector: "#crashBtn" })];

describe("WebReplayDriver external targetUrl", () => {
  it("reproduces the external app's crash when targetUrl is set", async () => {
    const app = await startApp();
    apps.push(app);
    const driver = new WebReplayDriver({ targetUrl: `${app.origin}/` });
    const result = await driver.replay(huntActionPath);

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.status).toBe("target-failure");
    expect(result.outcomes[0]!.error?.code).toBe("TARGET_FAILURE");
    expect(result.signals.some((s) => s.kind === "PAGE_ERROR")).toBe(true);

    // Hunt-style end-to-end: the anomaly reproduces through the finding
    // engine's reproduction policy against the same external app.
    const engine = new FindingEngine();
    const finding = engine.ingest(
      { kind: "PAGE_ERROR", detail: "crash app intentional failure" },
      { runId: "run-ext", title: "crash on #crashBtn", adapter: "web" },
    );
    const rep = await engine.reproduce(finding, huntActionPath, driver, {
      attempts: 2,
      minSuccesses: 1,
    });
    expect(rep.finding.status).toBe("CONFIRMED");
    expect(rep.stats.successes).toBeGreaterThanOrEqual(1);
  }, 90000);

  it("does NOT reproduce against the seeded app without targetUrl (no false positive)", async () => {
    const app = await startApp();
    apps.push(app);
    // Sanity: the external app really is crashing on its own.
    const extDriver = new WebReplayDriver({ targetUrl: `${app.origin}/` });
    expect((await extDriver.replay(huntActionPath)).signals.length).toBeGreaterThan(0);

    // Without targetUrl the driver replays against the seeded app, where
    // #crashBtn does not exist and nothing page-crashing happens.
    const seededDriver = new WebReplayDriver();
    const result = await seededDriver.replay(huntActionPath);
    expect(result.signals.some((s) => s.kind === "PAGE_ERROR")).toBe(false);
    // A missing selector is an automation failure (ACTION_FAILED), not an
    // application defect; only a real page crash carries TARGET_FAILURE.
    expect(
      result.outcomes.some((o) => o.error?.code === "TARGET_FAILURE"),
    ).toBe(false);
  }, 90000);
});
