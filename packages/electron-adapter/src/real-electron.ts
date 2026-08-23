import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import {
  AdapterCrashError,
  redactFreeformText,
  redactRecord,
  redactUrl,
  type AdapterHandler,
} from "@inspector/adapter-sdk";
import { ArtifactStore, type ArtifactMetadata } from "@inspector/artifact-store";
import {
  type Action,
  type ActionOutcome,
  type CapabilityDoc,
  type HealthResponse,
  type Observation,
  newId,
  ProtocolError,
  protocolError,
} from "@inspector/protocol";
import { ELECTRON_CAPABILITIES } from "./capabilities.js";

export type ElectronBackendMode = "real" | "injectable" | "auto";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(here, "fixtures", "main.cjs");

/** Locate the downloaded Electron executable without importing Electron. */
export function electronExecutablePath(): string | undefined {
  try {
    const packageEntry = createRequire(import.meta.url).resolve("electron");
    const executable = join(dirname(packageEntry), "dist", process.platform === "win32" ? "electron.exe" : "electron");
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

export function resolveElectronBackendMode(): Exclude<ElectronBackendMode, "auto"> {
  const raw = process.env.INSPECTOR_ELECTRON_BACKEND;
  if (raw === "real" || raw === "injectable") return raw;
  return electronExecutablePath() ? "real" : "injectable";
}

interface PageErrorEvent {
  message: string;
  stack?: string;
  at: number;
  sequence: number;
}

/** Production Electron renderer handler driven through Playwright's Electron API. */
export class RealElectronHandler implements AdapterHandler {
  private app: ElectronApplication | undefined;
  private page: Page | undefined;
  private readonly artifactDir: string;
  private readonly artifacts: ArtifactStore;
  private readonly settleMs: number;
  private readonly fixturePath: string;
  private runId = "run";
  private environmentId = "env";
  private sequence = 0;
  private traceIndex = 0;
  private pageErrorSequence = 0;
  private consoleErrors: string[] = [];
  private pageErrors: PageErrorEvent[] = [];
  private network: Array<Record<string, unknown>> = [];
  private mainLog: string[] = [];

  constructor(
    artifactBaseDir: string = join(tmpdir(), "inspector-electron-artifacts"),
    fixturePath: string = DEFAULT_FIXTURE,
    settleMs = 50,
  ) {
    mkdirSync(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join(artifactBaseDir, "real-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
    this.fixturePath = fixturePath;
    this.settleMs = Math.max(0, settleMs);
  }

  async initialize(): Promise<CapabilityDoc> {
    return ELECTRON_CAPABILITIES;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create":
        await this.shutdown();
        this.applyAttribution(params.options);
        return this.create();
      case "reset":
        if (!this.page) return { ok: false };
        try {
          await this.page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
          await this.page.reload({ waitUntil: "load" });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      case "close":
        await this.shutdown();
        return { ok: true };
      default:
        return { ok: false };
    }
  }

  private async create(): Promise<{ ok: boolean }> {
    const executablePath = electronExecutablePath();
    if (!executablePath) {
      throw new Error(
        "production Electron runtime unavailable: install the Electron executable (the npm package alone is not enough; run its install-electron step)",
      );
    }
    if (!existsSync(this.fixturePath)) throw new Error(`Electron fixture not found: ${this.fixturePath}`);
    this.app = await _electron.launch({
      executablePath,
      args: [this.fixturePath],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    this.app.on("console", (message) => {
      this.mainLog.push(redactFreeformText(message.text()));
    });
    this.app.on("window", (page) => {
      if (!this.page) this.attachPage(page);
    });
    this.page = await this.app.firstWindow({ timeout: 15000 });
    this.attachPage(this.page);
    await this.app.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    return { ok: true };
  }

  private attachPage(page: Page): void {
    this.page = page;
    page.on("console", (message) => {
      if (message.type() === "error") this.consoleErrors.push(redactFreeformText(message.text()));
    });
    page.on("pageerror", (error) => {
      this.pageErrors.push({
        message: redactFreeformText(error.message),
        stack: error.stack ? redactFreeformText(error.stack) : undefined,
        at: Date.now(),
        sequence: ++this.pageErrorSequence,
      });
    });
    page.on("request", (request) => {
      this.network.push({ type: "request", url: redactUrl(request.url()), method: request.method() });
    });
    page.on("response", (response) => {
      this.network.push({ type: "response", url: redactUrl(response.url()), status: response.status() });
    });
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    if (!this.page) throw new Error("environment not created");
    const page = this.page;
    const want = new Set(params.observe ?? []);
    const uiTree = await page.evaluate(() => {
      const doc = (globalThis as unknown as {
        document: {
          querySelectorAll: (selector: string) => ArrayLike<{
            tagName: string;
            textContent: string | null;
            getAttribute: (name: string) => string | null;
            id: string;
            offsetParent: unknown;
            disabled: boolean;
            type: string;
            value: string;
          }>;
        };
      }).document;
      return Array.from(doc.querySelectorAll("a,button,input,select,textarea,[role=button]")).map((element) => {
      const el = element;
      const tag = el.tagName.toLowerCase();
      const field = tag === "input" || tag === "textarea" || tag === "select";
      const text = (el.textContent ?? "").trim().slice(0, 240);
      return {
        tag,
        role: el.getAttribute("role") ?? tag,
        name: el.getAttribute("aria-label") ?? text,
        id: el.id,
        hidden: el.offsetParent === null,
        disabled: el.disabled,
        value: field && el.type === "password" ? "***" : field ? el.value : undefined,
        text: field ? undefined : text,
      };
      });
    });
    const screenshot = want.has("screenshot") ? await page.screenshot() : undefined;
    const artifacts: Array<{ sha256: string; mime: string; size: number; path: string }> = [];
    if (screenshot) artifacts.push(this.writeArtifact(Buffer.from(screenshot), "image/png", "screenshot.png"));
    const trace = want.has("trace") ? await this.flushTrace() : undefined;
    if (trace) artifacts.push(trace);
    const rawStorage = await page.evaluate(() => {
      const values: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) values[key] = localStorage.getItem(key) ?? "";
      }
      return values;
    }).catch(() => ({} as Record<string, string>));
    const summary = {
      backend: "electron-real",
      url: page.url(),
      title: await page.title(),
      uiTree,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors.map(({ message, stack }) => ({ message, stack })),
      network: this.network,
      storage: redactRecord(rawStorage),
      mainLog: [...this.mainLog],
    };
    this.consoleErrors = [];
    this.pageErrors = [];
    this.network = [];
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.sequence++,
      source: "adapter-electron-real",
      capturedAt: new Date().toISOString(),
      summary,
      artifacts,
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    if (!this.page) throw protocolError("VALIDATION", "environment not created");
    const page = this.page;
    const action = params.action;
    const start = Date.now();
    const sequence = this.pageErrorSequence;
    try {
      const selector = String(action.input?.selector ?? action.input?.target ?? "");
      const value = action.input?.value === undefined ? "" : String(action.input.value);
      const timeout = Math.max(50, action.deadlineMs - 250);
      switch (action.kind) {
        case "click": await page.click(selector, { timeout }); break;
        case "fill": await page.fill(selector, value, { timeout }); break;
        case "press": await page.keyboard.press(value); break;
        case "select": await page.selectOption(selector, value, { timeout }); break;
        case "reload": await page.reload({ timeout }); break;
        case "back": await page.goBack({ timeout }); break;
        case "forward": await page.goForward({ timeout }); break;
        case "wait": await page.waitForTimeout(Number(action.input?.ms ?? 100)); break;
        case "navigate":
          if (!value.startsWith("file:")) throw protocolError("CAPABILITY_DENIED", "real Electron navigation is restricted to fixture file URLs");
          await page.goto(value, { timeout });
          break;
        case "fault":
          if (String(action.input?.fault ?? "") !== "crash") throw protocolError("CAPABILITY_DENIED", "fault not permitted");
          await this.app?.close();
          throw new AdapterCrashError("adapter-crash: electron app quit (fault)");
        default: throw protocolError("VALIDATION", `unknown Electron action: ${action.kind}`);
      }
      const error = await this.pageErrorForAction(page, start, sequence);
      if (error) return this.targetFailure(action, error.message, page);
      return this.success(action, page);
    } catch (error) {
      if (error instanceof AdapterCrashError || error instanceof ProtocolError) throw error;
      const event = await this.pageErrorForAction(page, start, sequence);
      return event ? this.targetFailure(action, event.message, page) : this.targetFailure(action, errorMessage(error), page, "ACTION_FAILED");
    }
  }

  async health(): Promise<HealthResponse> {
    return { ok: !!this.page, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {}

  async shutdown(): Promise<void> {
    try {
      await this.app?.context().tracing.stop().catch(() => {
        // The renderer may already have exited; cleanup remains best effort.
      });
    } catch {
      // The renderer may already have exited; cleanup remains best effort.
    }
    try {
      await this.app?.close().catch(() => {
        // The renderer may already have exited; cleanup remains best effort.
      });
    } catch {
      // The renderer may already have exited; cleanup remains best effort.
    }
    this.app = undefined;
    this.page = undefined;
  }

  private async pageErrorForAction(page: Page, start: number, sequence: number): Promise<PageErrorEvent | undefined> {
    const find = () => this.pageErrors.filter((error) => error.sequence > sequence && error.at >= start).at(-1);
    const current = find();
    if (current || this.settleMs === 0) return current;
    await page.waitForTimeout(this.settleMs).catch(() => undefined);
    return find();
  }

  private success(action: Action, page: Page): ActionOutcome {
    return {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      status: "success",
      observedAt: new Date().toISOString(),
      stateAfter: page.url(),
    };
  }

  private targetFailure(action: Action, message: string, page: Page, code: "TARGET_FAILURE" | "ACTION_FAILED" = "TARGET_FAILURE"): ActionOutcome {
    return {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      status: "target-failure",
      observedAt: new Date().toISOString(),
      stateAfter: page.url(),
      error: { code, message: redactFreeformText(message) },
    };
  }

  private writeArtifact(content: Buffer, mime: string, name: string): { sha256: string; mime: string; size: number; path: string } {
    const meta: ArtifactMetadata = this.artifacts.write({ runId: this.runId, content, mime, name });
    return { sha256: meta.sha256, mime: meta.mime, size: meta.size, path: meta.path };
  }

  private async flushTrace(): Promise<{ sha256: string; mime: string; size: number; path: string } | undefined> {
    if (!this.app) return undefined;
    const path = join(this.artifactDir, `trace-${this.traceIndex++}.zip`);
    try {
      await this.app.context().tracing.stop({ path });
      await this.app.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
      const result = this.writeArtifact(readFileSync(path), "application/zip", "trace.zip");
      rmSync(path, { force: true });
      return result;
    } catch {
      return undefined;
    }
  }

  private applyAttribution(options?: Record<string, unknown>): void {
    if (typeof options?.runId === "string" && options.runId) this.runId = options.runId;
    if (typeof options?.environmentId === "string" && options.environmentId) this.environmentId = options.environmentId;
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
