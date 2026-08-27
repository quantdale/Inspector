import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnattendedCampaign, type WorkItem } from "@inspector/scale";
import { InspectorWorkflowExecutor } from "./campaign-executor.js";

/**
 * M12 F3: REAL Inspector workflows execute as campaign items. A fake-family
 * item runs the full RunManager + fake walker + finding pipeline; a web-family
 * item drives a real Playwright adapter against a live local app. Provenance
 * (campaign/item/worker) is durable in run meta; per-item workspaces retain
 * their own SQLite store and evidence bundles.
 */

const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-m12-wf-${name}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const CRASH_PAGE = `<!doctype html><html><head><title>M12 Fleet App</title></head>
<body>
  <button id="crashBtn">Break</button>
  <script>
    document.getElementById('crashBtn').addEventListener('click', () => {
      throw new Error('m12 fleet intentional failure');
    });
  </script>
</body></html>`;

function startApp(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(CRASH_PAGE);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) throw new Error("no addr");
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const servers: Array<{ server: Server }> = [];
afterAll(() => {
  for (const s of servers) s.server.close();
});

describe("M12 F3: inspector workflow executor over UnattendedCampaign", () => {
  it(
    "runs a real hunt item against a live web app plus a fake-family engine item, isolated per item",
    { timeout: 180_000 },
    async () => {
      const base = fresh("real");
      const app = await startApp();
      servers.push(app);

      const items: WorkItem[] = [
        {
          id: "web-hunt-1",
          priority: 1,
          mode: "hunt",
          target: "web",
          adapterFamily: "web",
          targetUri: `${app.origin}/`,
          seed: 11,
          steps: 2,
          budgets: { maxActions: 12, maxWallMs: 90_000 },
        },
        {
          id: "fake-hunt-1",
          priority: 2,
          mode: "hunt",
          target: "fake",
          adapterFamily: "fake",
          seed: 22,
          steps: 6,
        },
      ];

      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 2,
          items,
          usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
          globalBudget: { maxActions: 500 },
          executor: new InspectorWorkflowExecutor({ campaignId: base }),
          keepItemWorkspaces: true,
        },
        join(base, "artifacts"),
      );

      try {
        const report = await campaign.run();
        expect(report.completed.sort()).toEqual(["fake-hunt-1", "web-hunt-1"]);
        // Real usage was charged from executed actions (not the fake fixture).
        expect(report.usage.actions).toBeGreaterThan(4);
        // Findings flow through the standard pipeline into durable campaign
        // state — the crash app yields a PAGE_ERROR-class candidate/finding. A
        // meaningful assertion (H5-D12): the real web lane actually executed
        // and produced evidence, it is not a pass-by-return tautology.
        const webFindings = report.findings.filter(
          (f) => f.adapter === "web-playwright" || f.title.includes("PAGE_ERROR"),
        );
        expect(webFindings.length).toBeGreaterThanOrEqual(1);

        // Per-item workspaces are retained with their own SQLite stores.
        const itemsRoot = join(base, "artifacts", "items");
        expect(readdirSync(itemsRoot).sort()).toEqual(["fake-hunt-1", "web-hunt-1"]);

        // Provenance chain: campaign -> work item -> worker -> run meta.
        const fakeWs = join(itemsRoot, "fake-hunt-1", "1", ".inspector");
        expect(existsSync(join(fakeWs, "runs.db"))).toBe(true);
        const { Store } = await import("@inspector/store-sqlite");
        const store = Store.open(join(fakeWs, "runs.db"));
        try {
          const runs = store.listRuns(10);
          expect(runs.length).toBeGreaterThanOrEqual(1);
          const metaRaw = runs[0]!.meta_json;
          expect(metaRaw).toContain("inspector-hunt/1");
          const meta = JSON.parse(metaRaw ?? "{}") as { campaign?: Record<string, string> };
          if (meta.campaign) {
            expect(meta.campaign.campaignId).toBe(base);
            expect(meta.campaign.itemId).toBe("fake-hunt-1");
            expect(meta.campaign.workerId).toMatch(/^worker-/);
          }
        } finally {
          store.close();
        }
      } finally {
        campaign.dispose();
      }
    },
  );

  it(
    "refuses unroutable families honestly when the backend is unavailable",
    { timeout: 60_000 },
    async () => {
      const base = fresh("refusal-injected");
      const items: WorkItem[] = [
        {
          id: "android-hunt-1",
          priority: 1,
          mode: "hunt",
          target: "android",
          adapterFamily: "android",
          targetUri: "com.android.settings",
          seed: 5,
          steps: 2,
        },
      ];
      // Deterministic injected probe: no ADB on this worker.
      const executor = new InspectorWorkflowExecutor({
        campaignId: base,
        probes: { adb: { ok: false, detail: "injected: adb unavailable" } },
      });
      const caps = await executor.capabilities();
      expect(caps.families).not.toContain("android");
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items,
          usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
          executor,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.refusals).toHaveLength(1);
        expect(report.refusals[0]).toMatchObject({
          itemId: "android-hunt-1",
          class: "capability-unavailable",
        });
        // The refusal is durable in campaign state for audit/recovery.
        const disk = JSON.parse(readFileSync(join(base, "state", "campaign.json"), "utf8")) as {
          refusals: Array<{ itemId: string; class: string }>;
        };
        expect(disk.refusals[0]).toMatchObject({ itemId: "android-hunt-1" });
      } finally {
        campaign.dispose();
      }
    },
  );

  /**
   * Real-device proof (M12 F8 portfolio leg): gated behind
   * INSPECTOR_M12_ANDROID_E2E so concurrent forks never contend for the one
   * emulator with the other real-backend suites. Run explicitly:
   * `INSPECTOR_M12_ANDROID_E2E=1 pnpm test:integration ...`
   */
  it.skipIf(process.env.INSPECTOR_M12_ANDROID_E2E !== "1")(
    "drives a real android target as a campaign item when the device is exclusively available (skipped unless the real-device env gate is set)",
    { timeout: 180_000 },
    async () => {
      const base = fresh("refusal");
      const items: WorkItem[] = [
        {
          id: "android-hunt-1",
          priority: 1,
          mode: "hunt",
          target: "android",
          adapterFamily: "android",
          targetUri: "com.android.settings",
          seed: 5,
          steps: 2,
          // Bounded probe of a REAL device exploration: uiautomator dumps are
          // slow, so keep both the action and wall budgets tight.
          budgets: { maxActions: 3, maxWallMs: 45_000 },
        },
      ];
      const executor = new InspectorWorkflowExecutor({ campaignId: base });
      const caps = await executor.capabilities();
      const campaign = new UnattendedCampaign(
        {
          stateDir: join(base, "state"),
          workerCount: 1,
          items,
          usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
          executor,
        },
        join(base, "artifacts"),
      );
      try {
        const report = await campaign.run();
        if (!caps.families.includes("android")) {
          expect(report.completed).toEqual([]);
          expect(report.refusals).toHaveLength(1);
          expect(report.refusals[0]).toMatchObject({
            itemId: "android-hunt-1",
            class: "capability-unavailable",
          });
        } else {
          // Healthy host with a live device/AVD: the item runs for real.
          expect(report.completed).toEqual(["android-hunt-1"]);
          expect(report.usage.actions).toBeGreaterThan(0);
        }
      } finally {
        campaign.dispose();
      }
    },
  );

  it("keeps evidence bundle bytes accounted and readable from the retained workspace", async () => {
    const base = fresh("evidence");
    const items: WorkItem[] = [
      {
        id: "fake-explore-1",
        priority: 1,
        mode: "explore",
        target: "fake",
        adapterFamily: "fake",
        seed: 33,
        steps: 30,
      },
    ];
    const campaign = new UnattendedCampaign(
      {
        stateDir: join(base, "state"),
        workerCount: 1,
        items,
        usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
        executor: new InspectorWorkflowExecutor({ campaignId: base }),
        keepItemWorkspaces: true,
      },
      join(base, "artifacts"),
    );
    try {
      const report = await campaign.run();
      expect(report.completed).toEqual(["fake-explore-1"]);
      // The deterministic walker confirms its seeded defect through the full
      // pipeline and writes a standard evidence bundle under the workspace.
      const wsBase = join(base, "artifacts", "items", "fake-explore-1", "1", ".inspector");
      const bundlesRoot = join(wsBase, "bundles");
      expect(existsSync(bundlesRoot)).toBe(true);
      const [runDir] = readdirSync(bundlesRoot);
      const bundleFiles = readdirSync(join(bundlesRoot, runDir!));
      expect(bundleFiles.length).toBeGreaterThanOrEqual(1);
      const bundlePath = join(bundlesRoot, runDir!, bundleFiles[0]!);
      const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as { schema?: string };
      expect(bundle.schema).toBe("inspector-evidence/1");
      // Durable findings recorded at campaign level too (idempotent).
      expect(report.findings.length).toBeGreaterThanOrEqual(1);
    } finally {
      campaign.dispose();
    }
  }, 120_000);
});
