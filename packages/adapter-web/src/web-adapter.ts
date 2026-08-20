import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import {
  PROTOCOL_VERSION,
  newId,
  protocolError,
  ProtocolError,
  type CapabilityDoc,
  type Observation,
  type ActionOutcome,
  type Action,
  type HealthResponse,
} from "@inspector/protocol";
import { ArtifactStore, type ArtifactMetadata } from "@inspector/artifact-store";
import { AdapterHandler, AdapterCrashError } from "@inspector/adapter-sdk";
import { startSeedServer, type SeedServer } from "./seeded-app.js";

export const WEB_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "web-playwright",
  capabilities: {
    observe: ["url", "title", "uiTree", "screenshot", "console", "network", "storage", "trace"],
    act: ["click", "fill", "press", "select", "navigate", "back", "forward", "reload", "wait"],
    lifecycle: ["create", "reset", "close"],
    faults: ["timeout", "crash"],
    coverage: [],
  },
};

export interface WebFaults {
  crashBrowser?: boolean;
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("password") || u.searchParams.has("token") || u.searchParams.has("secret")) {
      const clean = new URL(url);
      for (const k of ["password", "token", "secret"]) {
        if (clean.searchParams.has(k)) clean.searchParams.set(k, "***");
      }
      return clean.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export class WebAdapterHandler implements AdapterHandler {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private seed: SeedServer | undefined;
  private readonly artifacts: ArtifactStore;
  private consoleErrors: Array<{ text: string; ts: number }> = [];
  private pageErrors: Array<{ message: string; stack?: string }> = [];
  private network: Array<Record<string, unknown>> = [];
  private seq = 0;
  private traceIndex = 0;

  constructor(
    private readonly faults: WebFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-web-artifacts"),
  ) {
    mkdtempSync(artifactBaseDir); // ensure base exists
    this.artifacts = new ArtifactStore(artifactBaseDir);
  }

  async initialize(): Promise<CapabilityDoc> {
    return WEB_CAPABILITIES;
  }

  async lifecycle(params: { op: string }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create": {
        this.seed = startSeedServer();
        this.browser = await chromium.launch({ headless: true });
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 800 },
          locale: "en-US",
          timezoneId: "UTC",
        });
        this.page = await this.context.newPage();
        this.attachListeners();
        await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        await this.page.goto(this.seed.url);
        return { ok: true };
      }
      case "reset": {
        if (this.page) {
          await this.page.evaluate(() => localStorage.clear()).catch(() => {});
          await this.page.reload({ waitUntil: "load" });
          await this.page.waitForSelector("#loginBtn", { state: "visible" }).catch(() => {});
        }
        return { ok: true };
      }
      case "close": {
        await this.shutdown();
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }

  private attachListeners(): void {
    if (!this.page) return;
    this.page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push({ text: msg.text(), ts: Date.now() });
    });
    this.page.on("pageerror", (err) => this.pageErrors.push({ message: err.message, stack: err.stack }));
    this.page.on("request", (req) =>
      this.network.push({ type: "request", url: redact(req.url()), method: req.method() }),
    );
    this.page.on("response", (res) =>
      this.network.push({ type: "response", url: redact(res.url()), status: res.status() }),
    );
  }

  private allowedOrigin(target: string): boolean {
    try {
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      return u.hostname === "127.0.0.1" || u.hostname === "localhost";
    } catch {
      return false;
    }
  }

  async observe(): Promise<Observation> {
    if (!this.page) throw new Error("environment not created");
    const page = this.page;
    const url = page.url();
    const title = await page.title();
    const uiTree = await page.evaluate(
      (() => {
        const els = Array.from(
          document.querySelectorAll("a,button,input,select,textarea,[role=button]"),
        ) as Array<any>;
        return els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
          name: el.getAttribute("aria-label") ?? (el.textContent ?? "").trim(),
          id: el.id,
          hidden: el.offsetParent === null,
        }));
      }) as unknown as () => unknown,
    );
    const screenshot = await page.screenshot();
    const storage = await page
      .evaluate(
        (() => {
          const o: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) o[k] = localStorage.getItem(k) ?? "";
          }
          return o;
        }) as unknown as () => unknown,
      )
      .catch(() => ({}));

    const artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> = [];
    const shotMeta: ArtifactMetadata = this.artifacts.write({
      runId: "run",
      content: Buffer.from(screenshot),
      mime: "image/png",
      name: "screenshot.png",
    });
    artifacts.push({ sha256: shotMeta.sha256, mime: shotMeta.mime, size: shotMeta.size, path: shotMeta.path });

    const traceMeta = await this.flushTrace();
    if (traceMeta) {
      artifacts.push({ sha256: traceMeta.sha256, mime: traceMeta.mime, size: traceMeta.size, path: traceMeta.path });
    }

    const summary = {
      url,
      title,
      uiTree,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
      network: this.network,
      storage,
    };
    const obs: Observation = {
      id: newId("obs"),
      runId: "run",
      environmentId: "env",
      sequence: this.seq++,
      source: "adapter-web",
      capturedAt: new Date().toISOString(),
      summary,
      artifacts,
    };
    this.consoleErrors = [];
    this.pageErrors = [];
    this.network = [];
    return obs;
  }

  private async flushTrace(): Promise<ArtifactMetadata | undefined> {
    if (!this.context) return undefined;
    const path = join(tmpdir(), `inspector-trace-${this.traceIndex++}.zip`);
    try {
      await this.context.tracing.stop({ path });
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    } catch {
      return undefined;
    }
    return this.artifacts.write({ runId: "run", content: readFileSync(path), mime: "application/zip", name: "trace.zip" });
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    const action = params.action;
    if (this.faults.crashBrowser) {
      await this.browser?.close().catch(() => {});
      throw new AdapterCrashError("adapter-crash: browser crashed (injected fault)");
    }
    if (!this.page) throw protocolError("VALIDATION", "environment not created");
    const page = this.page;
    const sel = String(action.input?.selector ?? action.input?.target ?? "");
    const value = action.input?.value !== undefined ? String(action.input.value) : "";
    const timeout = action.deadlineMs;
    try {
      switch (action.kind) {
        case "click":
          await page.click(sel, { timeout });
          break;
        case "fill":
          await page.fill(sel, value, { timeout });
          break;
        case "press":
          await page.keyboard.press(value);
          break;
        case "select":
          await page.selectOption(sel, value, { timeout });
          break;
        case "navigate": {
          if (!this.allowedOrigin(value)) {
            throw protocolError("CAPABILITY_DENIED", `navigation to forbidden origin: ${value}`);
          }
          await page.goto(value, { timeout });
          break;
        }
        case "back":
          await page.goBack({ timeout });
          break;
        case "forward":
          await page.goForward({ timeout });
          break;
        case "reload":
          await page.reload({ timeout });
          break;
        case "wait":
          await page.waitForTimeout(Number(action.input?.ms ?? 500));
          break;
        default:
          throw protocolError("VALIDATION", `unknown web action: ${action.kind}`);
      }
      if (this.pageErrors.length > 0) {
        const err = this.pageErrors[this.pageErrors.length - 1]!;
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "target-failure",
          observedAt: new Date().toISOString(),
          stateAfter: page.url(),
          error: { code: "TARGET_FAILURE", message: err.message },
        };
      }
      return {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "success",
        observedAt: new Date().toISOString(),
        stateAfter: page.url(),
      };
    } catch (e) {
      if (this.faults.crashBrowser) throw new AdapterCrashError("adapter-crash: browser crashed (injected fault)");
      if (e instanceof ProtocolError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "target-failure",
        observedAt: new Date().toISOString(),
        stateAfter: page.url(),
        error: { code: "TARGET_FAILURE", message },
      };
    }
  }

  async health(): Promise<HealthResponse> {
    return { ok: !!this.page, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* best-effort; Playwright actions are not interruptible mid-flight */
  }

  private async shutdown(): Promise<void> {
    try {
      if (this.context) await this.context.tracing.stop().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await this.context?.close().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close().catch(() => {});
    } catch {
      /* ignore */
    }
    this.seed?.close();
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.seed = undefined;
  }
}
