import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import {
  ArtifactStore,
  type ArtifactMetadata,
} from "@inspector/artifact-store";
import {
  type AdapterHandler,
  AdapterCrashError,
  redactRecord,
  redactUrl,
  redactFreeformText,
} from "@inspector/adapter-sdk";
import { startSeedServer, type SeedServer } from "./seeded-app.js";

export const WEB_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "web-playwright",
  capabilities: {
    observe: [
      "url",
      "title",
      "uiTree",
      "screenshot",
      "console",
      "network",
      "storage",
      "trace",
    ],
    act: [
      "click",
      "fill",
      "press",
      "select",
      "navigate",
      "back",
      "forward",
      "reload",
      "wait",
    ],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
  },
};

export interface WebFaults {
  crashBrowser?: boolean;
}

export interface WebAdapterOptions {
  faults?: WebFaults;
  artifactBaseDir?: string;
  /** Serve this HTML instead of the default seeded app (repair verification). */
  seedHtml?: string;
  /**
   * Settle window (ms) waited after an action resolves so a pageerror that
   * lands just after completion still classifies as target-failure. The
   * default is deliberately small; larger values trade latency for a wider
   * detection window. Residual race: throws arriving after the window are
   * missed by THIS action and surface on the next observation instead.
   */
  settleMs?: number;
  /** Serve a self-redirect loop at /loop from the seeded server (torture). */
  seedRedirectLoop?: boolean;
  /**
   * Drive an EXTERNAL local web app instead of the embedded seeded app.
   * Must be an http/https URL on localhost/127.0.0.1 (RC1 security posture);
   * remote origins are rejected. When set, the origin allowlist narrows to
   * EXACTLY this origin (scheme+host+port) and reset reloads this URL.
   */
  targetUrl?: string;
}

/** Validate and normalize a targetUrl into { url, origin }; throw on violation. */
export function resolveTargetUrl(
  raw: unknown,
): { url: string; origin: string } | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    throw protocolError("VALIDATION", "targetUrl must be a non-empty string");
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw protocolError("VALIDATION", `targetUrl is not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw protocolError(
      "VALIDATION",
      `targetUrl must be http or https, got: ${u.protocol}`,
    );
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    // SECURITY: RC1 dogfood targets are served locally; never allow remote
    // origins through the adapter's navigation/request policy.
    throw protocolError(
      "CAPABILITY_DENIED",
      `targetUrl must be a localhost origin for RC1, got: ${u.hostname}`,
    );
  }
  return { url: u.toString(), origin: u.origin };
}

/**
 * Playwright timeout for one action: keeps the historical headroom below the
 * wire deadline for generous deadlines while clamping strictly UNDER the
 * deadline for short ones (the old floor could meet or exceed it).
 */
export function actionTimeout(deadlineMs: number): number {
  const desired = Math.max(1000, deadlineMs - 1500);
  const ceiling = Math.max(deadlineMs - 250, 0);
  return Math.max(Math.min(desired, ceiling), 50);
}

export class WebAdapterHandler implements AdapterHandler {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private seed: SeedServer | undefined;
  private readonly artifacts: ArtifactStore;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  private readonly artifactDir: string;
  private readonly settleMs: number;
  private readonly seedRedirectLoop: boolean;
  /** Instance-level default external target (constructor option). */
  private readonly defaultTargetUrl?: string;
  /** Active external target for the current create; undefined = seeded app. */
  private targetUrl: string | undefined;
  /** Exact allowed origin (scheme+host+port) when an external target is set. */
  private targetOrigin: string | undefined;
  private runId = "run";
  private environmentId = "env";
  private consoleErrors: Array<{ text: string; ts: number }> = [];
  private pageErrors: Array<{ message: string; stack?: string; at: number; sequence: number }> = [];
  private pageErrorSequence = 0;
  private network: Array<Record<string, unknown>> = [];
  private seq = 0;
  private traceIndex = 0;

  constructor(
    private readonly faults: WebFaults = {},
    artifactBaseDir: string = join(tmpdir(), "inspector-web-artifacts"),
    private readonly seedHtml?: string,
    settleMs = 50,
    seedRedirectLoop = false,
    targetUrl?: string,
  ) {
    this.settleMs = Math.max(0, settleMs);
    this.seedRedirectLoop = seedRedirectLoop;
    // Validate the constructor-level default eagerly so misconfiguration
    // surfaces at construction, not mid-campaign.
    if (targetUrl !== undefined) {
      const resolved = resolveTargetUrl(targetUrl);
      this.defaultTargetUrl = resolved?.url;
    }
    mkdirSync(artifactBaseDir, { recursive: true });
    // Use the RETURNED unique directory so concurrent instances never share
    // one artifact tree (and trace temp files cannot collide across processes).
    this.artifactDir = mkdtempSync(join(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
  }

  async initialize(): Promise<CapabilityDoc> {
    return WEB_CAPABILITIES;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create": {
        // Refuse-or-replace: tear down any prior instance first so repeated
        // creates never leak a browser, context, or seed server.
        if (this.browser || this.context || this.page || this.seed) {
          await this.shutdown();
        }
        this.applyAttribution(params.options);
        // Per-create targetUrl overrides the constructor-level default.
        const rawTarget =
          params.options?.targetUrl !== undefined
            ? params.options.targetUrl
            : this.defaultTargetUrl;
        const resolved = resolveTargetUrl(rawTarget);
        this.targetUrl = resolved?.url;
        this.targetOrigin = resolved?.origin;
        try {
          if (!resolved) {
            this.seed = startSeedServer({
              html: this.seedHtml,
              redirectLoop: this.seedRedirectLoop,
            });
          }
          this.browser = await chromium.launch({ headless: true });
          this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 800 },
            locale: "en-US",
            timezoneId: "UTC",
          });
          this.page = await this.context.newPage();
          this.attachListeners();
          // Keep the disposable target isolated. With an external target the
          // allowlist narrows to EXACTLY that origin (scheme+host+port);
          // otherwise any http origin on loopback is permitted as before.
          const exactOrigin = this.targetOrigin;
          await this.page.route("**/*", (route) => {
            try {
              const u = new URL(route.request().url());
              if (
                u.protocol === "http:" &&
                (exactOrigin !== undefined
                  ? u.origin === exactOrigin
                  : u.hostname === "127.0.0.1" || u.hostname === "localhost")
              ) {
                return route.continue();
              }
            } catch {
              /* ignore malformed urls */
            }
            return route.abort();
          });
          await this.context.tracing.start({
            screenshots: true,
            snapshots: true,
            sources: false,
          });
          if (resolved) {
            await this.page.goto(resolved.url, { waitUntil: "load" });
          } else {
            await this.seed!.ready;
            await this.page.goto(this.seed!.url);
          }
          return { ok: true };
        } catch (e) {
          // Fail-safe: tear down whatever partial state was created before
          // surfacing the failure to the caller.
          await this.shutdown();
          throw e;
        }
      }
      case "reset": {
        if (this.page && this.targetUrl) {
          // External target: clear cookies + storage for the origin, then do a
          // fresh load of the target URL. Report failure honestly if the
          // target became unreachable or storage could not be cleared.
          let cleared = true;
          await this.context?.clearCookies().catch(() => {
            cleared = false;
          });
          await this.page
            .evaluate(() => {
              localStorage.clear();
              sessionStorage.clear();
            })
            .catch(() => {
              cleared = false;
            });
          try {
            await this.page.goto(this.targetUrl, { waitUntil: "load" });
          } catch {
            return { ok: false };
          }
          if (!cleared) return { ok: false };
        } else if (this.page) {
          let cleared = true;
          await this.page
            .evaluate(() => localStorage.clear())
            .catch(() => {
              cleared = false;
            });
          await this.page.reload({ waitUntil: "load" });
          await this.page
            .waitForSelector("#loginBtn", { state: "visible", timeout: 5000 })
            .catch(() => {});
          // Report storage-clear failure honestly instead of ok:true.
          if (!cleared) return { ok: false };
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
      if (msg.type() === "error")
        this.consoleErrors.push({
      text: redactFreeformText(msg.text()),
          ts: Date.now(),
        });
    });
    this.page.on("pageerror", (err) =>
      this.pageErrors.push({
        message: redactFreeformText(err.message),
        stack: err.stack ? redactFreeformText(err.stack) : undefined,
        at: Date.now(),
        sequence: ++this.pageErrorSequence,
      }),
    );
    this.page.on("request", (req) =>
      this.network.push({
        type: "request",
        url: redactUrl(req.url()),
        method: req.method(),
      }),
    );
    this.page.on("response", (res) =>
      this.network.push({
        type: "response",
        url: redactUrl(res.url()),
        status: res.status(),
      }),
    );
  }

  private allowedOrigin(target: string): boolean {
    try {
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      // With an external target, only that exact origin may be navigated to.
      if (this.targetOrigin !== undefined) return u.origin === this.targetOrigin;
      return u.hostname === "127.0.0.1" || u.hostname === "localhost";
    } catch {
      return false;
    }
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    if (!this.page) throw new Error("environment not created");
    const page = this.page;
    const want = new Set(params.observe ?? []);
    const url = page.url();
    const title = await page.title();
    const uiTree = await page.evaluate((() => {
      const els = Array.from(
        document.querySelectorAll(
          "a,button,input,select,textarea,[role=button]",
        ),
      ) as Array<any>;
      return els.map((el) => {
        const tag = el.tagName.toLowerCase();
        const isField =
          tag === "input" || tag === "textarea" || tag === "select";
        const textContent = (el.textContent ?? "").trim().slice(0, 240);
        return {
          tag,
          role: el.getAttribute("role") ?? tag,
          name: el.getAttribute("aria-label") ?? textContent,
          id: el.id,
          hidden: el.offsetParent === null,
          disabled: !!el.disabled,
          // Password-type values are masked IN PAGE so they never cross the
          // adapter boundary (SECURITY-MODEL: redact known secret values).
          value:
            isField && el.type === "password" ? "***" : isField ? el.value : undefined,
          text: isField ? undefined : textContent,
        };
      });
    }) as unknown as () => unknown);
    const screenshot = want.has("screenshot") ? await page.screenshot() : null;
    const rawStorage = (await page
      .evaluate((() => {
        const o: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) o[k] = localStorage.getItem(k) ?? "";
        }
        return o;
      }) as unknown as () => unknown)
      .catch(() => ({}))) as Record<string, string>;
    // Sensitive storage keys are masked before the dump can persist.
    const storage = redactRecord(rawStorage);

    const artifacts: Array<{
      sha256: string;
      mime: string;
      size: number;
      path: string;
    }> = [];
    if (screenshot) {
      const shotMeta: ArtifactMetadata = this.artifacts.write({
        runId: this.runId,
        content: Buffer.from(screenshot),
        mime: "image/png",
        name: "screenshot.png",
      });
      artifacts.push({
        sha256: shotMeta.sha256,
        mime: shotMeta.mime,
        size: shotMeta.size,
        path: shotMeta.path,
      });
    }

    const traceMeta = want.has("trace") ? await this.flushTrace() : undefined;
    if (traceMeta) {
      artifacts.push({
        sha256: traceMeta.sha256,
        mime: traceMeta.mime,
        size: traceMeta.size,
        path: traceMeta.path,
      });
    }

    const summary = {
      url,
      title,
      uiTree,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors.map(({ message, stack }) => ({ message, stack })),
      network: this.network,
      storage,
    };
    const obs: Observation = {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
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
    // Trace zips are written inside this instance's unique artifact dir and
    // removed after ingest: no inspector-trace-N.zip litter or cross-process
    // index collisions in the os tmpdir.
    const path = join(this.artifactDir, `trace-${this.traceIndex++}.zip`);
    try {
      await this.context.tracing.stop({ path });
      await this.context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
    } catch {
      return undefined;
    }
    try {
      const meta = this.artifacts.write({
        runId: this.runId,
        content: readFileSync(path),
        mime: "application/zip",
        name: "trace.zip",
      });
      rmSync(path, { force: true });
      return meta;
    } catch {
      return undefined;
    }
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    const action = params.action;
    if (this.faults.crashBrowser) {
      await this.browser?.close().catch(() => {});
      throw new AdapterCrashError(
        "adapter-crash: browser crashed (injected fault)",
      );
    }
    if (!this.page)
      throw protocolError("VALIDATION", "environment not created");
    const page = this.page;
    const sel = String(action.input?.selector ?? action.input?.target ?? "");
    const value =
      action.input?.value === undefined ? "" : String(action.input.value);
    // Keep the Playwright timeout strictly below the wire deadline so the
    // adapter always reports an outcome instead of losing the race to the
    // client-side deadline (which would surface as an adapter error).
    const timeout = actionTimeout(action.deadlineMs);
    // Attribute page errors by a timestamped action window and monotonic event
    // sequence, rather than by the current array length. A browser event can
    // be delivered after the action promise resolves; the bounded settle
    // window below gives that event a deterministic ownership check. An error
    // recorded before this action remains unrelated even if delivery is late.
    const actionStartedAt = Date.now();
    const pageErrorSequenceBefore = this.pageErrorSequence;
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
            throw protocolError(
              "CAPABILITY_DENIED",
              `navigation to forbidden origin: ${value}`,
            );
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
        case "fault": {
          const fault = String(action.input?.fault ?? "");
          const allowed = WEB_CAPABILITIES.capabilities.faults ?? [];
          if (!allowed.includes(fault)) {
            throw protocolError(
              "CAPABILITY_DENIED",
              `fault not permitted: ${fault}`,
            );
          }
          if (fault === "crash") {
            await this.browser?.close().catch(() => {});
            throw new AdapterCrashError("adapter-crash: injected fault");
          } else if (fault === "reload") {
            await page.reload({ timeout });
          } else if (fault === "storageReset") {
            await page.evaluate(() => localStorage.clear()).catch(() => {});
          }
          break;
        }
        default:
          throw protocolError(
            "VALIDATION",
            `unknown web action: ${action.kind}`,
          );
      }
      // A synchronous throw inside a click/fill handler is reported as a
      // pageerror, but the CDP notification can land just after the action
      // promise resolves. Wait only when the action has no owned event; the
      // timestamp/sequence filter keeps unrelated earlier errors out.
      const lateError = await this.pageErrorForAction(
        page,
        actionStartedAt,
        pageErrorSequenceBefore,
      );
      if (lateError) {
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "target-failure",
          observedAt: new Date().toISOString(),
          stateAfter: page.url(),
          error: { code: "TARGET_FAILURE", message: lateError.message },
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
      if (this.faults.crashBrowser)
        throw new AdapterCrashError(
          "adapter-crash: browser crashed (injected fault)",
        );
      if (e instanceof ProtocolError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      // A genuine application crash surfaces as a pageerror and is reported with
      // code TARGET_FAILURE. This includes errors that arrived during the
      // action window even when the automation call itself failed. A Playwright
      // automation error (missing element, timeout) is an ACTION_FAILED, not an
      // application defect, so the explorer must not treat it as a bug.
      const duringAction = await this.pageErrorForAction(
        page,
        actionStartedAt,
        pageErrorSequenceBefore,
      );
      if (duringAction) {
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "target-failure",
          observedAt: new Date().toISOString(),
          stateAfter: page.url(),
          error: { code: "TARGET_FAILURE", message: duringAction.message },
        };
      }
      return {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "target-failure",
        observedAt: new Date().toISOString(),
        stateAfter: page.url(),
        error: { code: "ACTION_FAILED", message },
      };
    }
  }

  private async pageErrorForAction(
    page: Page,
    actionStartedAt: number,
    pageErrorSequenceBefore: number,
  ): Promise<{ message: string; stack?: string; at: number; sequence: number } | undefined> {
    const owned = (): { message: string; stack?: string; at: number; sequence: number } | undefined =>
      this.pageErrors
        .filter(
          (error) =>
            error.sequence > pageErrorSequenceBefore && error.at >= actionStartedAt,
        )
        .at(-1);
    const current = owned();
    if (current || this.settleMs === 0) return current;
    await page.waitForTimeout(this.settleMs).catch(() => undefined);
    return owned();
  }

  async health(): Promise<HealthResponse> {
    return { ok: !!this.page, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* best-effort; Playwright actions are not interruptible mid-flight */
  }

  /**
   * Release every resource owned by this instance (tracing, context, browser,
   * seed server). Idempotent; public so entrypoints can shut down gracefully
   * on process signals.
   */
  async shutdown(): Promise<void> {
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
    this.targetUrl = undefined;
    this.targetOrigin = undefined;
  }

  /** Thread real run/environment attribution from lifecycle options. */
  private applyAttribution(options?: Record<string, unknown>): void {
    const runId = options?.runId;
    const environmentId = options?.environmentId;
    if (typeof runId === "string" && runId) this.runId = runId;
    if (typeof environmentId === "string" && environmentId) {
      this.environmentId = environmentId;
    }
  }
}
