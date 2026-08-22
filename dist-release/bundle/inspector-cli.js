#!/usr/bin/env node


// packages/core/src/policy.ts
var RISK_CAPABILITY = {
  observe: "observe",
  interact: "interact",
  "mutate-test-state": "mutate_test_state",
  "modify-source": "modify_source",
  publish: "publish"
};
var DEFAULT_POLICY = {
  name: "default-local-safe",
  capabilities: {
    observe: true,
    interact: true,
    mutate_test_state: false,
    modify_source: false,
    publish: false
  },
  budgets: {
    wall_clock_minutes: 60,
    max_actions: 2e3,
    max_environment_resets: 100,
    max_concurrent_environments: 1,
    max_artifact_megabytes: 2048,
    max_model_requests: 1e3,
    max_repairs_per_finding: 0
  }
};
var PolicyEngine = class {
  constructor(policy = DEFAULT_POLICY) {
    this.policy = policy;
  }
  counters = {
    actions: 0,
    resets: 0,
    artifactBytes: 0,
    modelRequests: 0,
    repairs: 0,
    openEnvironments: 0
  };
  evaluate(action) {
    const capKey = RISK_CAPABILITY[action.risk];
    if (!this.policy.capabilities[capKey]) {
      return {
        allowed: false,
        code: "CAPABILITY_DENIED",
        reason: `capability '${capKey}' is not granted by policy '${this.policy.name}'`
      };
    }
    if (!action.deadlineMs || action.deadlineMs < 1) {
      return { allowed: false, code: "DEADLINE_MISSING", reason: "action has no positive deadline" };
    }
    if (this.counters.actions + 1 > this.policy.budgets.max_actions) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "max_actions budget exhausted" };
    }
    return { allowed: true };
  }
  /** Record that an action was admitted and executed. */
  recordAction() {
    this.counters.actions += 1;
  }
  /**
   * Seed the action counter from durable state (committed action count for a
   * run). A restart with a fresh engine must not reset max_actions, or
   * crash-looping runs could evade the budget forever. Takes the maximum so
   * an engine shared across runs stays monotonic.
   */
  seedActionCount(count) {
    this.counters.actions = Math.max(this.counters.actions, count);
  }
  recordReset() {
    if (this.counters.resets + 1 > this.policy.budgets.max_environment_resets) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "max_environment_resets exhausted" };
    }
    this.counters.resets += 1;
    return { allowed: true };
  }
  recordArtifactBytes(bytes) {
    const limit = this.policy.budgets.max_artifact_megabytes * 1024 * 1024;
    if (this.counters.artifactBytes + bytes > limit) {
      return { allowed: false, code: "BUDGET_EXHAUSTED", reason: "artifact megabyte budget exhausted" };
    }
    this.counters.artifactBytes += bytes;
    return { allowed: true };
  }
  openEnvironment() {
    if (this.counters.openEnvironments + 1 > this.policy.budgets.max_concurrent_environments) {
      return { allowed: false, code: "CONCURRENCY_EXCEEDED", reason: "max_concurrent_environments exceeded" };
    }
    this.counters.openEnvironments += 1;
    return { allowed: true };
  }
  closeEnvironment() {
    if (this.counters.openEnvironments > 0) this.counters.openEnvironments -= 1;
  }
};

// packages/adapter-sdk/src/bin-resolve.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
function pickAdapterBinFile(fromDir, bundledFileName, ...devSegments) {
  const bundled = join(fromDir, bundledFileName);
  if (existsSync(bundled)) return { kind: "bundled", binFile: bundled };
  const stem = join(fromDir, ...devSegments);
  const compiled2 = `${stem}.js`;
  if (existsSync(compiled2)) return { kind: "compiled", binFile: compiled2 };
  const source = `${stem}.ts`;
  if (existsSync(source)) return { kind: "source", binFile: source };
  throw new Error(`adapter binary not found: tried ${bundled}, ${compiled2}, ${source}`);
}
function resolveAdapterBin(fromUrl, bundledFileName, ...devSegments) {
  const fromDir = dirname(fileURLToPath(fromUrl));
  const pick = pickAdapterBinFile(fromDir, bundledFileName, ...devSegments);
  if (pick.kind === "source") {
    const tsxHref = pathToFileURL(createRequire(fromUrl).resolve("tsx")).href;
    return { command: process.execPath, args: ["--import", tsxHref, pick.binFile], binFile: pick.binFile };
  }
  return { command: process.execPath, args: [pick.binFile], binFile: pick.binFile };
}

// packages/adapter-sdk/src/jsonrpc.ts
var JSON_RPC_PARSE_ERROR = -32700;
var LineProtocolError = class extends Error {
  kind;
  constructor(kind, message) {
    super(message);
    this.name = "LineProtocolError";
    this.kind = kind;
  }
};
var DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var LineChannel = class {
  constructor(readable, writable, options = {}) {
    this.readable = readable;
    this.writable = writable;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.readable.on("data", (chunk) => this.onData(chunk));
    this.readable.on("close", () => this.onEnd());
    this.readable.on("end", () => this.onEnd());
    this.readable.on("error", () => {
      this.closed = true;
      this.onEnd();
    });
  }
  buffer = "";
  decoder = new TextDecoder();
  maxLineBytes;
  messageHandler = null;
  errorHandler = null;
  closed = false;
  ended = false;
  /** True while we are discarding an oversized line up to its newline. */
  discarding = false;
  onMessage(handler) {
    this.messageHandler = handler;
  }
  onError(handler) {
    this.errorHandler = handler;
  }
  get isClosed() {
    return this.closed;
  }
  close() {
    this.closed = true;
    try {
      if (typeof this.writable.end === "function") {
        this.writable.end();
      }
    } catch {
    }
  }
  /** Returns false when the channel is closed or the write failed. A false
   * from backpressure still counts as accepted (the chunk is queued). */
  send(msg) {
    if (this.closed) return false;
    try {
      this.writable.write(JSON.stringify(msg) + "\n");
      return true;
    } catch (err) {
      this.closed = true;
      this.emitError(
        new LineProtocolError(
          "write-failed",
          `write failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      return false;
    }
  }
  emitError(err) {
    if (this.errorHandler) this.errorHandler(err);
  }
  onData(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.discarding) {
      const nl2 = this.buffer.indexOf("\n");
      if (nl2 < 0) {
        this.buffer = "";
        return;
      }
      this.buffer = this.buffer.slice(nl2 + 1);
      this.discarding = false;
    }
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      this.handleLine(line);
    }
    if (this.buffer.length > this.maxLineBytes) {
      this.emitError(
        new LineProtocolError(
          "line-overflow",
          `line exceeds ${this.maxLineBytes} bytes; discarding until next newline`
        )
      );
      this.discarding = true;
      this.buffer = "";
    }
  }
  handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.send({
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_PARSE_ERROR, message: "parse error" }
      });
      return;
    }
    if (!isPlainObject(parsed)) {
      this.emitError(
        new LineProtocolError("invalid-message", `dropped non-object payload: ${line.slice(0, 64)}`)
      );
      return;
    }
    if (this.messageHandler) this.messageHandler(parsed);
  }
  /** Flush the decoder and deliver/surface any trailing unterminated data. */
  onEnd() {
    this.closed = true;
    if (this.ended) return;
    this.ended = true;
    this.discarding = false;
    this.buffer += this.decoder.decode();
    const trailing = this.buffer.trim();
    this.buffer = "";
    if (!trailing) return;
    let parsed;
    try {
      parsed = JSON.parse(trailing);
    } catch {
      this.emitError(
        new LineProtocolError("invalid-trailing", `unparsable trailing data: ${trailing.slice(0, 64)}`)
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      this.emitError(
        new LineProtocolError("invalid-trailing", `non-object trailing data: ${trailing.slice(0, 64)}`)
      );
      return;
    }
    if (this.messageHandler) this.messageHandler(parsed);
  }
};

// packages/protocol/src/version.ts
var PROTOCOL_VERSION = "0.1";

// packages/protocol/src/ids.ts
import { randomUUID } from "node:crypto";
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
var PREFIXES = {
  run: "run",
  env: "env",
  step: "step",
  action: "act",
  act: "act",
  obs: "obs",
  artifact: "art",
  finding: "find",
  find: "find",
  checkpoint: "ckpt",
  ckpt: "ckpt"
};
function newId(kind) {
  if (kind !== void 0 && !Object.hasOwn(PREFIXES, kind)) {
    throw new Error(`unknown id kind: ${String(kind)}`);
  }
  const raw = randomUUID().replace(/-/g, "");
  const prefix = kind ? `${PREFIXES[kind]}_` : "";
  return `${prefix}${raw}`;
}

// packages/protocol/src/errors.ts
var ProtocolError = class extends Error {
  code;
  detail;
  constructor(error) {
    super(`[${error.code}] ${error.message}`);
    this.name = "ProtocolError";
    this.code = error.code;
    this.detail = error.detail;
  }
  toIapError() {
    return { code: this.code, message: this.message, detail: this.detail };
  }
};
function protocolError(code, message, detail) {
  return new ProtocolError({ code, message, detail });
}

// packages/protocol/src/schema.ts
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
var Ajv = AjvModule.default ?? AjvModule;
var addFormats = addFormatsModule.default ?? addFormatsModule;
var ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);
var actionSchema = {
  $id: "https://inspector.local/schema/action-0.1.json",
  type: "object",
  required: ["id", "runId", "environmentId", "kind", "risk", "deadlineMs", "idempotency"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN.source },
    runId: { type: "string", pattern: ID_PATTERN.source },
    environmentId: { type: "string", pattern: ID_PATTERN.source },
    kind: { type: "string", minLength: 1 },
    risk: {
      enum: ["observe", "interact", "mutate-test-state", "modify-source", "publish"]
    },
    deadlineMs: { type: "integer", minimum: 1 },
    idempotency: {
      enum: ["safe-retry", "observe-before-retry", "never-retry"]
    },
    target: { type: ["object", "null"] },
    input: { type: ["object", "null"] },
    metadata: { type: "object" }
  },
  additionalProperties: false
};
var observationSchema = {
  $id: "https://inspector.local/schema/observation-0.1.json",
  type: "object",
  required: ["id", "runId", "environmentId", "sequence", "source", "capturedAt", "summary"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN.source },
    runId: { type: "string", pattern: ID_PATTERN.source },
    environmentId: { type: "string", pattern: ID_PATTERN.source },
    stepId: { type: ["string", "null"] },
    sequence: { type: "integer", minimum: 0 },
    source: { type: "string", minLength: 1 },
    capturedAt: { type: "string", format: "date-time" },
    summary: { type: "object" },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        required: ["sha256", "mime", "size", "path"],
        properties: {
          sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          mime: { type: "string" },
          size: { type: "integer", minimum: 0 },
          path: { type: "string" }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};
var observeRequestSchema = {
  $id: "https://inspector.local/schema/observe-request-0.1.json",
  type: "object",
  required: ["observe"],
  properties: {
    observe: { type: "array", items: { type: "string", minLength: 1 } },
    options: { type: "object" }
  }
};
var capabilityDocSchema = {
  $id: "https://inspector.local/schema/capability-0.1.json",
  type: "object",
  required: ["protocolVersion", "adapter", "capabilities"],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    adapter: { type: "string", pattern: ID_PATTERN.source },
    capabilities: {
      type: "object",
      required: ["observe", "act", "lifecycle"],
      properties: {
        observe: { type: "array", items: { type: "string", minLength: 1 } },
        act: { type: "array", items: { type: "string", minLength: 1 } },
        lifecycle: { type: "array", items: { type: "string", minLength: 1 } },
        faults: { type: "array", items: { type: "string", minLength: 1 } },
        coverage: { type: "array", items: { type: "string", minLength: 1 } }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
var adapterEventSchema = {
  $id: "https://inspector.local/schema/adapter-event-0.1.json",
  type: "object",
  required: ["sequence", "runId", "environmentId", "type", "timestamp", "payload"],
  properties: {
    sequence: { type: "integer", minimum: 0 },
    runId: { type: "string", pattern: ID_PATTERN.source },
    environmentId: { type: "string", pattern: ID_PATTERN.source },
    stepId: { type: ["string", "null"] },
    type: {
      enum: ["observation", "action-outcome", "health", "log", "artifact", "lifecycle"]
    },
    timestamp: { type: "string", format: "date-time" },
    payload: {}
  },
  additionalProperties: false
};
var envelopeSchema = {
  $id: "https://inspector.local/schema/envelope-0.1.json",
  type: "object",
  required: ["protocol", "protocolVersion", "id", "direction", "timestamp", "payload"],
  properties: {
    protocol: { const: "iap" },
    protocolVersion: { const: PROTOCOL_VERSION },
    id: { type: "string", pattern: ID_PATTERN.source },
    direction: { enum: ["request", "response", "event"] },
    method: { type: "string", minLength: 1 },
    inReplyTo: { type: "string", pattern: ID_PATTERN.source },
    timestamp: { type: "string", format: "date-time" },
    deadlineMs: { type: "integer", minimum: 1 },
    payload: {},
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        detail: {}
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
var compiled = {
  action: ajv.compile(actionSchema),
  observation: ajv.compile(observationSchema),
  observeRequest: ajv.compile(observeRequestSchema),
  capabilityDoc: ajv.compile(capabilityDocSchema),
  adapterEvent: ajv.compile(adapterEventSchema),
  envelope: ajv.compile(envelopeSchema)
};
function run(validate, data) {
  const ok = validate(data);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`
  );
  return { ok: false, errors };
}
function validateObservation(data) {
  return run(compiled.observation, data);
}
function validateCapabilityDoc(data) {
  return run(compiled.capabilityDoc, data);
}

// packages/adapter-sdk/src/server.ts
var AdapterCrashError = class extends Error {
  constructor(message = "adapter crashed") {
    super(message);
    this.name = "AdapterCrashError";
  }
};

// packages/adapter-sdk/src/client.ts
import { spawn } from "node:child_process";
var AdapterClientError = class extends Error {
  reason;
  constructor(reason, message) {
    super(message);
    this.name = "AdapterClientError";
    this.reason = reason;
  }
};
var AdapterProtocolError = class extends Error {
  details;
  constructor(message, details) {
    super(message);
    this.name = "AdapterProtocolError";
    this.details = details;
  }
};
var CLOSE_GRACE_MS = 2e3;
var SPAWN_SETTLE_MS = 50;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var AdapterClient = class _AdapterClient {
  channel = null;
  proc = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  eventHandler = null;
  closed = false;
  /** First fatal error observed via the global watchers, if any. */
  deathErr = null;
  deathSignalResolve = null;
  deathWaiter = null;
  closePromise = null;
  constructor() {
  }
  onEvent(handler) {
    this.eventHandler = handler;
  }
  static async spawn(opts) {
    const client = new _AdapterClient();
    const proc = spawn(opts.command, opts.args ?? [], {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "inherit"]
    });
    client.proc = proc;
    client.attach(proc.stdout, proc.stdin);
    await Promise.race([sleep(SPAWN_SETTLE_MS), client.deathSignal()]);
    if (client.deathErr) {
      await client.close();
      throw client.deathErr;
    }
    return client;
  }
  static overStreams(readable, writable) {
    const client = new _AdapterClient();
    client.attach(readable, writable);
    return client;
  }
  attach(readable, writable) {
    this.channel = new LineChannel(readable, writable);
    this.channel.onMessage((msg) => this.onMessage(msg));
    void this.deathSignal();
    readable.on("close", () => this.markDead(crashError()));
    readable.on("error", () => this.markDead(crashError()));
    if (this.proc) {
      this.proc.once(
        "error",
        (err) => this.markDead(new AdapterClientError("spawn-failed", `adapter spawn failed: ${err.message}`))
      );
      this.proc.once("close", () => this.markDead(crashError()));
    }
  }
  deathSignal() {
    if (!this.deathWaiter) {
      this.deathWaiter = new Promise((resolve2) => {
        this.deathSignalResolve = resolve2;
      });
    }
    return this.deathWaiter;
  }
  markDead(err) {
    if (this.deathErr) return;
    this.deathErr = err;
    this.failPending(err);
    this.deathSignalResolve?.();
  }
  failPending(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
  onMessage(msg) {
    if ("id" in msg && msg.id !== null && msg.id !== void 0) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message);
        err.code = msg.error.code;
        err.data = msg.error.data;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (!("id" in msg) && typeof msg.method === "string") {
      if (this.eventHandler) this.eventHandler(msg.method, msg.params);
    }
  }
  /** Typed error to throw immediately, if the client cannot carry requests. */
  immediateFailure() {
    if (this.closed) return new AdapterClientError("closed", "adapter client is closed");
    if (this.deathErr) return this.deathErr;
    if (!this.channel) return new AdapterClientError("closed", "adapter client not connected");
    return null;
  }
  async request(method, params, deadlineMs = 1e4) {
    const failure = this.immediateFailure();
    if (failure) throw failure;
    const id = this.nextId++;
    const promise = new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`deadline-exceeded: ${method}`));
        this.cancelOnDeadline(method, params);
      }, deadlineMs);
      this.pending.set(id, {
        resolve: resolve2,
        reject,
        timer
      });
    });
    const sent = this.channel.send({ jsonrpc: "2.0", id, method, params });
    if (!sent) {
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
      }
      throw this.deathErr ?? new AdapterClientError("crashed", "adapter-crash");
    }
    const result = await promise;
    if (method === "initialize") this.assertInitializeResult(result);
    return result;
  }
  /** Best-effort cancel notification when an act request runs out of time. */
  cancelOnDeadline(method, params) {
    if (method !== "act") return;
    const actionId = params?.action?.id;
    if (typeof actionId === "string") void this.notify("cancel", { actionId });
  }
  /** ADR 0002: the initialize result must be a current-version capability doc. */
  assertInitializeResult(result) {
    const version = result?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      throw new AdapterProtocolError(
        `protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`,
        [`protocolVersion: expected ${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`]
      );
    }
    const v = validateCapabilityDoc(result);
    if (!v.ok) {
      throw new AdapterProtocolError(
        `invalid capability document: ${v.errors.join("; ")}`,
        v.errors
      );
    }
  }
  async notify(method, params) {
    if (this.closed || this.deathErr || !this.channel) return;
    this.channel.send({ jsonrpc: "2.0", method, params });
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.failPending(new AdapterClientError("closed", "adapter client is closed"));
    this.channel?.close();
    const proc = this.proc;
    this.proc = null;
    if (!proc) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    this.closePromise = this.terminate(proc);
    return this.closePromise;
  }
  /** Await child exit within a grace window, then escalate to SIGKILL.
   * SIGKILL is Windows-safe: Node maps it to TerminateProcess. */
  async terminate(proc) {
    const exited = new Promise((resolve2) => proc.once("close", () => resolve2()));
    try {
      proc.kill();
    } catch {
    }
    const finished = await Promise.race([
      exited.then(() => true),
      sleep(CLOSE_GRACE_MS).then(() => false)
    ]);
    if (!finished) {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
      await Promise.race([exited, sleep(CLOSE_GRACE_MS)]);
    }
  }
  get isClosed() {
    return this.closed;
  }
};
function crashError() {
  return new AdapterClientError("crashed", "adapter-crash");
}

// packages/adapter-sdk/src/redaction.ts
var REDACTED = "***";
var SENSITIVE_KEY_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "credential"
];
var URL_RE = /https?:\/\/[^\s"'<>()[\]]+/g;
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUFFIXES.some((w) => lower === w || lower.endsWith(w));
}
function redactRecord(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = isSensitiveKey(k) ? REDACTED : v;
  }
  return out;
}
function stripUrlCredentials(url) {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}
function redactUrl(url) {
  try {
    const u = new URL(stripUrlCredentials(url));
    let changed = false;
    for (const [k, v] of Array.from(u.searchParams.entries())) {
      if (isSensitiveKey(k)) {
        u.searchParams.set(k, REDACTED);
        changed = true;
      } else if (v === REDACTED) {
        changed = true;
      }
    }
    return changed ? u.toString() : stripUrlCredentials(url);
  } catch {
    return url;
  }
}
function rewriteUrls(text, fn) {
  return text.replace(URL_RE, (match) => fn(match));
}
function redactUrlsInText(text) {
  return rewriteUrls(text, redactUrl);
}

// packages/core/src/validation.ts
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseAdapterObservation(raw) {
  const result = validateObservation(raw);
  if (!result.ok) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed observation: ${result.errors.join("; ")}`,
      detail: result.errors
    });
  }
  return raw;
}
var OUTCOME_STATUSES = [
  "success",
  "target-failure",
  "adapter-crash",
  "cancelled",
  "deadline-exceeded",
  "unknown"
];
function parseActionOutcome(raw) {
  const errors = [];
  if (!isPlainObject2(raw)) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed action outcome: expected object, got ${raw === null ? "null" : typeof raw}`,
      detail: []
    });
  }
  for (const key of ["actionId", "runId", "environmentId"]) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) {
      errors.push(`${key}: must be a non-empty string`);
    }
  }
  if (typeof raw.status !== "string" || !OUTCOME_STATUSES.includes(raw.status)) {
    errors.push(`status: must be one of ${OUTCOME_STATUSES.join(", ")}`);
  }
  if (typeof raw.observedAt !== "string" || Number.isNaN(Date.parse(raw.observedAt))) {
    errors.push("observedAt: must be an ISO date-time string");
  }
  if (raw.stateAfter !== void 0 && typeof raw.stateAfter !== "string") {
    errors.push("stateAfter: must be a string when present");
  }
  if (raw.artifactRefs !== void 0) {
    if (!Array.isArray(raw.artifactRefs) || !raw.artifactRefs.every((ref) => typeof ref === "string")) {
      errors.push("artifactRefs: must be an array of strings when present");
    }
  }
  if (raw.error !== void 0) {
    if (!isPlainObject2(raw.error)) {
      errors.push("error: must be an object when present");
    } else {
      if (typeof raw.error.code !== "string") errors.push("error.code: must be a string");
      if (typeof raw.error.message !== "string") errors.push("error.message: must be a string");
    }
  }
  if (errors.length > 0) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter returned a malformed action outcome: ${errors.join("; ")}`,
      detail: errors
    });
  }
  return raw;
}

// packages/core/src/run-manager.ts
function adapterLabel(command) {
  const base = command.split(/[\\/]/).pop() ?? "";
  return base.length > 0 ? base : "unknown";
}
function outcomeFromRecord(rec) {
  const outcome = {
    actionId: rec.id,
    runId: rec.run_id,
    environmentId: rec.environment_id,
    status: rec.status,
    observedAt: rec.decided_at ?? rec.requested_at
  };
  if (rec.state_after) outcome.stateAfter = rec.state_after;
  if (rec.error_json) {
    try {
      outcome.error = JSON.parse(rec.error_json);
    } catch {
    }
  }
  return outcome;
}
var RunController = class {
  constructor(store, artifactStore, engine, ctx) {
    this.store = store;
    this.artifactStore = artifactStore;
    this.engine = engine;
    this.ctx = ctx;
    this.caps = ctx.caps;
    const latest = store.getLatestCheckpoint(ctx.runId);
    if (latest) {
      try {
        const payload = JSON.parse(latest.payload_json);
        this.stepSeq = payload.stepSeq ?? 0;
      } catch {
        this.stepSeq = 0;
      }
    }
    this.engine.seedActionCount(store.countRunActions(ctx.runId));
  }
  stepSeq = 0;
  caps;
  get runId() {
    return this.ctx.runId;
  }
  get environmentId() {
    return this.ctx.envId;
  }
  async observe(observe) {
    const obs = parseAdapterObservation(
      await this.ctx.adapter.request("observe", { observe }, 1e4)
    );
    const nextSeq = this.stepSeq + 1;
    const stepId = newId("step");
    this.store.commitObservationStep({
      stepId,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: nextSeq,
      observations: [
        {
          id: this.uniqueObservationId(obs.id || newId("obs")),
          stepId,
          sequence: nextSeq,
          source: obs.source,
          capturedAt: obs.capturedAt,
          summary: obs.summary
        }
      ]
    });
    this.stepSeq = nextSeq;
    this.checkpoint();
    return obs;
  }
  /**
   * Evaluate policy, then (if allowed) persist a pending action and request the
   * outcome from the adapter. A crash/timeout leaves the action pending so it
   * can be recovered without blind re-submission.
   */
  async submitAction(action) {
    const decision = this.engine.evaluate(action);
    if (!decision.allowed) {
      return { kind: "rejected", decision };
    }
    const admission = this.store.insertPendingAction({
      id: action.id,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      kind: action.kind,
      risk: action.risk,
      deadlineMs: action.deadlineMs,
      idempotency: action.idempotency
    });
    if (!admission.inserted) {
      const existing = admission.existing;
      if (existing.status === "pending" || existing.status === "unknown") {
        return { kind: "duplicate", action: existing };
      }
      return { kind: "outcome", outcome: outcomeFromRecord(existing) };
    }
    let rawOutcome;
    try {
      rawOutcome = await this.ctx.adapter.request("act", { action }, action.deadlineMs);
    } catch (err) {
      this.checkpoint();
      return { kind: "adapter-error", error: err instanceof Error ? err.message : String(err) };
    }
    const outcome = parseActionOutcome(rawOutcome);
    const nextSeq = this.stepSeq + 1;
    const stepId = newId("step");
    this.store.commitStep({
      stepId,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: nextSeq,
      action: {
        id: action.id,
        kind: action.kind,
        risk: action.risk,
        deadlineMs: action.deadlineMs,
        idempotency: action.idempotency,
        status: outcome.status,
        stateAfter: outcome.stateAfter ?? null,
        errorCode: outcome.error?.code ?? null,
        error: outcome.error ?? null
      },
      observations: [
        {
          id: newId("obs"),
          stepId,
          sequence: nextSeq,
          source: this.ctx.caps.adapter,
          capturedAt: outcome.observedAt,
          summary: { stateAfter: outcome.stateAfter, status: outcome.status }
        }
      ]
    });
    this.stepSeq = nextSeq;
    this.engine.recordAction();
    this.accountArtifactBytes(outcome);
    this.checkpoint();
    return { kind: "outcome", outcome };
  }
  async reset() {
    await this.ctx.adapter.request("lifecycle", { op: "reset" }, 1e4);
    this.engine.recordReset();
    await this.observe(["state"]);
  }
  /** Regenerate a deterministic, pattern-valid observation id when the
   * adapter supplied one that is already persisted; external data must not be
   * able to abort the step transaction via a primary-key collision. */
  uniqueObservationId(preferred) {
    if (!this.store.observationExists(preferred)) return preferred;
    const base = preferred.slice(0, 120);
    for (let n = 1; ; n++) {
      const candidate = `${base}-r${n}`;
      if (!this.store.observationExists(candidate)) return candidate;
    }
  }
  /** Charge artifact bytes referenced by a committed outcome against the
   * policy budget. Sizes come from the artifact store's metadata. */
  accountArtifactBytes(outcome) {
    if (!outcome.artifactRefs?.length) return;
    let bytes = 0;
    for (const ref of outcome.artifactRefs) {
      bytes += this.artifactStore.meta(this.ctx.runId, ref)?.size ?? 0;
    }
    if (bytes > 0) this.engine.recordArtifactBytes(bytes);
  }
  checkpoint() {
    this.store.writeCheckpoint({
      id: newId("ckpt"),
      runId: this.ctx.runId,
      payload: { stepSeq: this.stepSeq }
    });
  }
  async close() {
    let teardownError = null;
    try {
      await this.ctx.adapter.request("lifecycle", { op: "close" }, 5e3);
    } catch (err) {
      teardownError = err;
    }
    try {
      await this.ctx.adapter.close();
    } catch (err) {
      teardownError = teardownError ?? err;
    }
    this.engine.closeEnvironment();
    if (teardownError) {
      this.store.setEnvironmentStatus(this.ctx.envId, "crashed");
      this.store.setRunStatus(this.ctx.runId, "failed");
    } else {
      this.store.setEnvironmentStatus(this.ctx.envId, "closed");
      this.store.setRunStatus(this.ctx.runId, "closed");
    }
  }
};
var RunManager = class {
  constructor(store, artifactStore, engine = new PolicyEngine(DEFAULT_POLICY)) {
    this.store = store;
    this.artifactStore = artifactStore;
    this.engine = engine;
  }
  async startRun(opts) {
    const runId = newId("run");
    const envId = newId("env");
    const provisional = adapterLabel(opts.adapterCommand);
    this.store.createRun({ id: runId, adapter: provisional });
    this.store.createEnvironment({ id: envId, runId, adapter: provisional });
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      throw new Error(opened.reason ?? "environment concurrency budget exceeded");
    }
    let adapter = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: opts.adapterEnv
      });
      const caps = await adapter.request("initialize", {});
      await adapter.request(
        "lifecycle",
        opts.createOptions ? { op: "create", options: opts.createOptions } : { op: "create" },
        3e4
      );
      this.store.recordAdapterIdentity(runId, envId, caps.adapter);
      return new RunController(this.store, this.artifactStore, this.engine, {
        runId,
        envId,
        adapter,
        caps
      });
    } catch (err) {
      if (adapter) await adapter.close().catch(() => {
      });
      this.engine.closeEnvironment();
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      throw err;
    }
  }
  /**
   * Reopen an existing run on a new process: re-establish the adapter, mark any
   * in-flight actions `unknown`, and re-observe rather than blindly resubmit.
   */
  async resumeRun(runId, opts) {
    const run2 = this.store.getRun(runId);
    if (!run2) throw new Error(`run not found: ${runId}`);
    const env = this.store.raw.prepare(`SELECT * FROM environments WHERE run_id = ? LIMIT 1`).get(runId);
    if (!env) throw new Error(`no environment for run: ${runId}`);
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      throw new Error(opened.reason ?? "environment concurrency budget exceeded");
    }
    let adapter = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: opts.adapterEnv
      });
      const caps = await adapter.request("initialize", {});
      const controller = new RunController(this.store, this.artifactStore, this.engine, {
        runId,
        envId: env.id,
        adapter,
        caps
      });
      const inFlight = this.store.markInFlightUnknown(runId);
      for (let i = 0; i < inFlight.length; i++) {
        await controller.observe(["state"]);
      }
      return controller;
    } catch (err) {
      if (adapter) await adapter.close().catch(() => {
      });
      this.engine.closeEnvironment();
      this.store.setEnvironmentStatus(env.id, "failed");
      throw err;
    }
  }
};

// packages/cli/src/args.ts
var CliError = class extends Error {
  constructor(kind, detail) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.name = "CliError";
  }
};
var GLOBAL_BOOL_FLAGS = /* @__PURE__ */ new Set(["--json", "--help", "-h", "--version", "-v", "--debug"]);
var GLOBAL_VALUE_FLAGS = /* @__PURE__ */ new Set(["--workspace"]);
function normalizeFlag(token) {
  if (token === "-h") return "--help";
  if (token === "-v") return "--version";
  return token;
}
function parseArgs(argv, valueFlags = [], boolFlags = []) {
  const valueSet = /* @__PURE__ */ new Set([...GLOBAL_VALUE_FLAGS, ...valueFlags]);
  const boolSet = /* @__PURE__ */ new Set([...GLOBAL_BOOL_FLAGS, ...boolFlags]);
  const flags = {};
  const positionals = [];
  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!onlyPositionals && token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (!onlyPositionals && token.length > 1 && token.startsWith("-")) {
      const name = normalizeFlag(token);
      if (valueSet.has(name)) {
        if (flags[name] !== void 0) {
          throw new CliError("duplicate-flag", `${token} given more than once`);
        }
        const raw = argv[i + 1];
        if (raw === void 0 || raw.startsWith("--") && raw.length > 2) {
          throw new CliError("missing-value", `${token} requires a value`);
        }
        flags[name] = raw;
        i += 1;
      } else if (boolSet.has(name)) {
        flags[name] = true;
      } else {
        throw new CliError("unknown-flag", token);
      }
    } else {
      positionals.push(token);
    }
  }
  return {
    positionals,
    flags,
    json: flags["--json"] === true,
    workspace: typeof flags["--workspace"] === "string" ? flags["--workspace"] : void 0,
    help: flags["--help"] === true,
    version: flags["--version"] === true
  };
}
function intFlag(flags, name, fallback) {
  const raw = flags[name];
  if (raw === void 0 || raw === true) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError("invalid-value", `${name} expects a non-negative integer, got '${raw}'`);
  }
  return n;
}
function requirePositional(positionals, index, usage) {
  const value = positionals[index];
  if (value === void 0 || value === "") {
    throw new CliError("missing-argument", `missing-argument: ${usage}`);
  }
  return value;
}

// packages/cli/src/help.ts
var WORKSPACE_NOTE = [
  "Workspace:",
  "  --workspace <dir> is THE isolation mechanism: each isolated directory",
  "  gets its own runs.db and artifacts. Resolution order when --workspace",
  "  is absent: $INSPECTOR_WORKSPACE, then the process working directory",
  "  (note: `pnpm run` re-cwd's to the package directory, so prefer an",
  "  explicit --workspace). A warning is printed when the resolved workspace",
  "  is the Inspector repository root."
].join("\n");
var GLOBAL = [
  "Global flags:",
  "  --json                Machine-readable JSON output",
  "  --workspace <dir>     Workspace directory (see Workspace below; default:",
  "                        $INSPECTOR_WORKSPACE, else <cwd>/.inspector)",
  "  --debug               Print raw stack traces after errors",
  "  --version, -v         Print the Inspector version",
  "  --help, -h            Show help for a command"
].join("\n");
function generalUsage() {
  return [
    "inspector - autonomous, durable environment inspection and defect discovery",
    "",
    "Usage: inspector <command> [flags]",
    "",
    "Commands:",
    "  doctor                   Probe platform capabilities and workspace health",
    "  hunt                     Unscripted autonomous exploration against a target",
    "  run                      Scripted demonstration scenario (fake|web adapters)",
    "  runs list|show|resume    Inspect and re-attach to recorded runs",
    "  findings list|show       Inspect discovered findings and evidence bundles",
    "  help [command]           Show help",
    "",
    GLOBAL,
    "",
    WORKSPACE_NOTE,
    "",
    "Examples:",
    "  inspector doctor --json",
    "  inspector hunt --adapter web --max-actions 100 --max-minutes 5",
    "  inspector hunt --adapter web --url http://127.0.0.1:3000/ --seed 7",
    "  inspector hunt --adapter fake --max-actions 60 --json",
    "  inspector findings list --limit 20",
    "  inspector findings show find_abc123",
    "  inspector runs list",
    "  inspector runs resume run_abc123"
  ].join("\n");
}
var COMMAND_HELP = {
  doctor: [
    "Usage: inspector doctor [--json] [--workspace <dir>]",
    "",
    "Probes the local platform and reports {ok, detail, remediation} per check.",
    "Core checks (node >= 22, workspace writable, store opens, fake adapter",
    "resolvable) must pass; optional capability probes (web/Playwright, pty,",
    "android adb, windows-uia, electron) are reported as WARN when missing.",
    "",
    "Exit code 0 only when all core checks pass.",
    "",
    WORKSPACE_NOTE
  ].join("\n"),
  hunt: [
    "Usage: inspector hunt [--adapter web|fake] [options]",
    "",
    "Unscripted autonomous exploration: discovers anomalies, reproduces them,",
    "and writes evidence bundles under <workspace>/bundles/<runId>/.",
    "",
    "Options:",
    "  --adapter web|fake     Target adapter (default: web)",
    "  --url <u>              Web only: external localhost http(s) target",
    "                         (validated; forwarded via WEB_TARGET_URL)",
    "  --seed <n>             Deterministic exploration seed (default: 7)",
    "  --max-actions <n>      Action budget (default: 200)",
    "  --max-minutes <m>      Wall-clock budget in minutes (default: 10)",
    "  --max-findings <n>     Stop after N confirmed findings (default: 4)",
    "",
    "Exit code 1 on adapter-error / initial-observe-failed stops or any",
    "error-level finding outcome; otherwise 0.",
    "",
    WORKSPACE_NOTE
  ].join("\n"),
  run: [
    "Usage: inspector run --adapter fake|web [--json]",
    "",
    "Scripted demonstration scenario against the chosen adapter. Records a",
    "durable run in the workspace store.",
    "",
    WORKSPACE_NOTE
  ].join("\n"),
  runs: [
    "Usage: inspector runs list [--limit n]",
    "       inspector runs show <id>",
    "       inspector runs resume <id>",
    "",
    "  list     Most recent runs (id, status, adapter, created). Empty stores",
    "           print 'no runs recorded'.",
    "  show     Steps and outcomes for one run.",
    "  resume   Re-attach a fresh adapter process to a recorded run, mark",
    "           in-flight actions unknown, and print a re-observed summary.",
    "           Fails honestly when the original adapter kind is not",
    "           recoverable from the stored record.",
    "",
    WORKSPACE_NOTE
  ].join("\n"),
  findings: [
    "Usage: inspector findings list [--run <id>] [--limit n]",
    "       inspector findings show <id>",
    "",
    "  list     Findings (newest first), optionally filtered by run.",
    "  show     One finding with status history, reproduction stats, artifact",
    "           refs count, and the evidence bundle path when it exists on disk.",
    "",
    WORKSPACE_NOTE
  ].join("\n"),
  help: ["Usage: inspector help [command]", "", "Show help for a command."].join("\n")
};
function commandHelp(command) {
  return COMMAND_HELP[command] ?? generalUsage();
}

// packages/cli/src/version.ts
import { readFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var here = dirname2(fileURLToPath2(import.meta.url));
function resolveVersion() {
  for (const candidate of [
    join2(here, "..", "..", "..", "package.json"),
    join2(here, "..", "package.json"),
    // Installed artifact: the build stamps the release version next to the
    // bundles; absent in dev checkouts.
    join2(here, "inspector-version.txt")
  ]) {
    try {
      if (candidate.endsWith(".txt")) {
        const raw = readFileSync(candidate, "utf8").trim();
        if (raw.length > 0) return raw;
        continue;
      }
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
    }
  }
  return "0.0.0-dev";
}

// packages/cli/src/doctor.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, writeFileSync, rmSync } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { dirname as dirname4, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath3, pathToFileURL as pathToFileURL2 } from "node:url";

// packages/store-sqlite/src/migrations.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname as dirname3 } from "node:path";
var MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    adapter TEXT,
    policy_json TEXT,
    meta_json TEXT
  );

  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    adapter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created'
  );

  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    sequence INTEGER NOT NULL,
    action_id TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    kind TEXT NOT NULL,
    risk TEXT NOT NULL,
    deadline_ms INTEGER NOT NULL,
    idempotency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    error_code TEXT,
    error_json TEXT,
    state_after TEXT,
    step_id TEXT
  );

  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    environment_id TEXT NOT NULL REFERENCES environments(id),
    step_id TEXT,
    sequence INTEGER NOT NULL,
    source TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observation_artifacts (
    observation_id TEXT NOT NULL REFERENCES observations(id),
    sha256 TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY(observation_id, sha256)
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    step_id TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_steps_run_seq ON steps(run_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id);
  CREATE INDEX IF NOT EXISTS idx_observations_seq ON observations(run_id, sequence);
  `,
  `
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    severity TEXT,
    revision TEXT,
    oracle_ids TEXT,
    reproduction_json TEXT,
    artifact_refs TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
  `,
  // Rebuild schema_version with a primary key: the original table had none,
  // so every open inserted another row and reads relied on undefined order.
  `
  CREATE TABLE schema_version_rebuilt (version INTEGER NOT NULL PRIMARY KEY);
  INSERT INTO schema_version_rebuilt(version) SELECT COALESCE(MAX(version), 0) FROM schema_version;
  DROP TABLE schema_version;
  ALTER TABLE schema_version_rebuilt RENAME TO schema_version;
  `,
  // Wave-1 finding extensions (signature/minimization/lastTransition/adapter)
  // plus uniqueness of the idempotency key among unresolved actions.
  `
  ALTER TABLE findings ADD COLUMN signature TEXT;
  ALTER TABLE findings ADD COLUMN minimization_json TEXT;
  ALTER TABLE findings ADD COLUMN last_transition_json TEXT;
  ALTER TABLE findings ADD COLUMN adapter TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_idempotency
    ON actions(idempotency) WHERE status IN ('pending', 'unknown');
  `,
  // Oracle evaluation records (docs/ORACLE-SYSTEM.md): one row per oracle
  // evaluated per evaluation event (reproduction attempts, minimization
  // verifications, repair verification), so evidence bundles can answer
  // "which oracles ran, what did they see, and why was this promoted".
  `
  CREATE TABLE IF NOT EXISTS oracle_evaluations (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    step_id TEXT,
    finding_id TEXT,
    subject_key TEXT,
    phase TEXT NOT NULL,
    oracle_id TEXT NOT NULL,
    oracle_kind TEXT,
    oracle_strength TEXT,
    oracle_class TEXT,
    reproduced INTEGER NOT NULL,
    confidence REAL,
    expected TEXT,
    observed TEXT,
    explanation TEXT,
    version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oracle_evaluations_run ON oracle_evaluations(run_id);
  CREATE INDEX IF NOT EXISTS idx_oracle_evaluations_finding ON oracle_evaluations(finding_id);
  `
];
function applyMigrations(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const tx = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
    const current = db.prepare(`SELECT version FROM schema_version`).get()?.version ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]);
    }
    db.prepare(`DELETE FROM schema_version`).run();
    db.prepare(`INSERT INTO schema_version(version) VALUES(?)`).run(MIGRATIONS.length);
  });
  tx();
}
function openStore(path) {
  if (path !== ":memory:") {
    mkdirSync(dirname3(path), { recursive: true });
  }
  const db = new Database(path);
  applyMigrations(db);
  return db;
}

// packages/store-sqlite/src/store.ts
var DuplicateActionIdempotencyError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicateActionIdempotencyError";
  }
};
var FINDING_SELECT = `SELECT id, run_id AS runId, status, title, confidence, severity, revision,
  oracle_ids AS oracleIds, reproduction_json AS reproductionJson, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt, signature,
  minimization_json AS minimizationJson, last_transition_json AS lastTransitionJson, adapter
  FROM findings`;
var Store = class _Store {
  constructor(db) {
    this.db = db;
  }
  static open(path) {
    return new _Store(openStore(path));
  }
  get raw() {
    return this.db;
  }
  close() {
    this.db.close();
  }
  createRun(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO runs(id, created_at, status, adapter, policy_json, meta_json)
         VALUES(?, ?, 'created', ?, ?, ?)`
    ).run(
      input.id,
      now,
      input.adapter ?? null,
      input.policy ? JSON.stringify(input.policy) : null,
      input.meta ? JSON.stringify(input.meta) : null
    );
    return this.getRun(input.id);
  }
  getRun(id) {
    return this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
  }
  listRuns(limit = 100) {
    return this.db.prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit);
  }
  setRunStatus(id, status) {
    this.db.prepare(`UPDATE runs SET status = ? WHERE id = ?`).run(status, id);
  }
  createEnvironment(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO environments(id, run_id, adapter, created_at, status)
         VALUES(?, ?, ?, ?, 'created')`
    ).run(input.id, input.runId, input.adapter, now);
    return this.getEnvironment(input.id);
  }
  getEnvironment(id) {
    return this.db.prepare(`SELECT * FROM environments WHERE id = ?`).get(id);
  }
  /**
   * Atomically commit a step: the action request, its final outcome, and all
   * observations are written in one transaction so a crash cannot leave the
   * step half-committed.
   */
  commitStep(input) {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO steps(id, run_id, environment_id, sequence, action_id, status, created_at)
           VALUES(?, ?, ?, ?, ?, 'committed', ?)`
      ).run(
        input.stepId,
        input.runId,
        input.environmentId,
        input.sequence,
        input.action.id,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      this.db.prepare(
        `INSERT INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
             status, requested_at, decided_at, error_code, error_json, state_after, step_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             decided_at = excluded.decided_at,
             error_code = excluded.error_code,
             error_json = excluded.error_json,
             state_after = excluded.state_after,
             step_id = excluded.step_id`
      ).run(
        input.action.id,
        input.runId,
        input.environmentId,
        input.action.kind,
        input.action.risk,
        input.action.deadlineMs,
        input.action.idempotency,
        input.action.status,
        (/* @__PURE__ */ new Date()).toISOString(),
        (/* @__PURE__ */ new Date()).toISOString(),
        input.action.errorCode ?? null,
        input.action.error ? JSON.stringify(input.action.error) : null,
        input.action.stateAfter ?? null,
        input.stepId
      );
      const insertObs = this.db.prepare(
        `INSERT INTO observations(id, run_id, environment_id, step_id, sequence, source, captured_at, summary_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertArtifact = this.db.prepare(
        `INSERT INTO observation_artifacts(observation_id, sha256, mime, size, path)
         VALUES(?, ?, ?, ?, ?)`
      );
      for (const o of input.observations) {
        insertObs.run(
          o.id,
          input.runId,
          input.environmentId,
          o.stepId ?? null,
          o.sequence,
          o.source,
          o.capturedAt,
          JSON.stringify(o.summary)
        );
        for (const a of o.artifacts ?? []) {
          insertArtifact.run(o.id, a.sha256, a.mime, a.size, a.path);
        }
      }
    });
    tx();
  }
  /**
   * Insert an action that has been requested but not yet decided (in-flight).
   * Idempotent: re-inserting a known action id returns the existing row
   * instead of crashing on the primary key, so an adapter error followed by a
   * resubmission can never escape as SQLITE_CONSTRAINT. A *different* action
   * claiming an idempotency key that is already held by a pending/unknown
   * action raises DuplicateActionIdempotencyError.
   */
  insertPendingAction(input) {
    const existing = this.getAction(input.id);
    if (existing) return { inserted: false, existing };
    try {
      this.db.prepare(
        `INSERT INTO actions(id, run_id, environment_id, kind, risk, deadline_ms, idempotency,
             status, requested_at, step_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        input.id,
        input.runId,
        input.environmentId,
        input.kind,
        input.risk,
        input.deadlineMs,
        input.idempotency,
        (/* @__PURE__ */ new Date()).toISOString(),
        input.stepId ?? null
      );
      return { inserted: true, existing: null };
    } catch (err) {
      if (err instanceof Error && err.message.includes("idx_actions_pending_idempotency")) {
        throw new DuplicateActionIdempotencyError(
          `idempotency key '${input.idempotency}' is already held by an unresolved action in run ${input.runId}`
        );
      }
      throw err;
    }
  }
  finalizeAction(id, outcome) {
    this.db.prepare(
      `UPDATE actions SET status = ?, decided_at = ?, state_after = ?, error_code = ?, error_json = ?
         WHERE id = ?`
    ).run(
      outcome.status,
      (/* @__PURE__ */ new Date()).toISOString(),
      outcome.stateAfter ?? null,
      outcome.errorCode ?? null,
      outcome.error ? JSON.stringify(outcome.error) : null,
      id
    );
  }
  getAction(id) {
    return this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id);
  }
  /**
   * On restart, any action still in `pending` state means the adapter response
   * was never persisted (adapter loss / crash). Mark these `unknown` so the
   * core re-observes/resets instead of blindly retrying. Only NEWLY lost
   * actions are returned: actions already marked `unknown` by an earlier
   * recovery pass stay untouched, so repeated resumes cannot multiply
   * synthetic recovery observations.
   */
  markInFlightUnknown(runId) {
    const newlyLost = this.db.prepare(`SELECT * FROM actions WHERE run_id = ? AND status = 'pending' ORDER BY requested_at`).all(runId);
    const tx = this.db.transaction((ids) => {
      const stmt = this.db.prepare(
        `UPDATE actions SET status = 'unknown', decided_at = ? WHERE id = ?`
      );
      for (const id of ids) stmt.run((/* @__PURE__ */ new Date()).toISOString(), id);
    });
    tx(newlyLost.map((a) => a.id));
    return newlyLost;
  }
  getInFlightActions(runId) {
    return this.db.prepare(`SELECT * FROM actions WHERE run_id = ? AND status IN ('pending', 'unknown') ORDER BY requested_at`).all(runId);
  }
  /** Number of actions ever admitted for a run, regardless of outcome. Used
   * to re-derive the max_actions budget from durable state after a restart. */
  countRunActions(runId) {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM actions WHERE run_id = ?`).get(runId);
    return row.c;
  }
  /** True when an observation with this id is already persisted. */
  observationExists(id) {
    return this.db.prepare(`SELECT 1 FROM observations WHERE id = ?`).get(id) !== void 0;
  }
  setEnvironmentStatus(id, status) {
    this.db.prepare(`UPDATE environments SET status = ? WHERE id = ?`).run(status, id);
  }
  /** Record the adapter's self-reported identity on its run and environment
   * rows once initialize has answered. */
  recordAdapterIdentity(runId, envId, adapter) {
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE runs SET adapter = ? WHERE id = ?`).run(adapter, runId);
      this.db.prepare(`UPDATE environments SET adapter = ? WHERE id = ?`).run(adapter, envId);
    });
    tx();
  }
  writeCheckpoint(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO checkpoints(id, run_id, step_id, created_at, payload_json)
         VALUES(?, ?, ?, ?, ?)`
    ).run(input.id, input.runId, input.stepId ?? null, now, JSON.stringify(input.payload));
    return this.db.prepare(`SELECT * FROM checkpoints WHERE id = ?`).get(input.id);
  }
  getLatestCheckpoint(runId) {
    return this.db.prepare(`SELECT * FROM checkpoints WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`).get(runId);
  }
  getCheckpoint(id) {
    return this.db.prepare(`SELECT * FROM checkpoints WHERE id = ?`).get(id);
  }
  getStepObservations(stepId) {
    const obs = this.db.prepare(`SELECT * FROM observations WHERE step_id = ? ORDER BY sequence`).all(stepId);
    const getArtifacts = this.db.prepare(
      `SELECT sha256, mime, size, path FROM observation_artifacts WHERE observation_id = ?`
    );
    return obs.map((o) => ({
      ...o,
      artifacts: getArtifacts.all(o.id)
    }));
  }
  /** Commit a step that only records observations (no action). */
  commitObservationStep(input) {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO steps(id, run_id, environment_id, sequence, action_id, status, created_at)
           VALUES(?, ?, ?, ?, NULL, 'committed', ?)`
      ).run(input.stepId, input.runId, input.environmentId, input.sequence, (/* @__PURE__ */ new Date()).toISOString());
      const insertObs = this.db.prepare(
        `INSERT INTO observations(id, run_id, environment_id, step_id, sequence, source, captured_at, summary_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertArtifact = this.db.prepare(
        `INSERT INTO observation_artifacts(observation_id, sha256, mime, size, path)
         VALUES(?, ?, ?, ?, ?)`
      );
      for (const o of input.observations) {
        insertObs.run(
          o.id,
          input.runId,
          input.environmentId,
          o.stepId ?? null,
          o.sequence,
          o.source,
          o.capturedAt,
          JSON.stringify(o.summary)
        );
        for (const a of o.artifacts ?? []) {
          insertArtifact.run(o.id, a.sha256, a.mime, a.size, a.path);
        }
      }
    });
    tx();
  }
  getRunSteps(runId) {
    const steps = this.db.prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY sequence`).all(runId);
    return steps.map((s) => {
      const action = s.action_id ? this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(s.action_id) : null;
      return {
        step: { id: s.id, sequence: s.sequence, actionId: s.action_id, status: s.status },
        action,
        observations: this.getStepObservations(s.id)
      };
    });
  }
  putFinding(f) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO findings(id, run_id, status, title, confidence, severity, revision,
           oracle_ids, reproduction_json, artifact_refs, created_at, updated_at,
           signature, minimization_json, last_transition_json, adapter)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           title = excluded.title,
           confidence = excluded.confidence,
           severity = excluded.severity,
           revision = excluded.revision,
           oracle_ids = excluded.oracle_ids,
           reproduction_json = excluded.reproduction_json,
           artifact_refs = excluded.artifact_refs,
           signature = excluded.signature,
           minimization_json = excluded.minimization_json,
           last_transition_json = excluded.last_transition_json,
           adapter = excluded.adapter,
           updated_at = excluded.updated_at`
    ).run(
      f.id,
      f.runId,
      f.status,
      f.title,
      f.confidence,
      f.severity,
      f.revision,
      f.oracleIds,
      f.reproductionJson,
      f.artifactRefs,
      f.createdAt,
      now,
      f.signature,
      f.minimizationJson,
      f.lastTransitionJson,
      f.adapter
    );
  }
  getFinding(id) {
    return this.db.prepare(`${FINDING_SELECT} WHERE id = ?`).get(id);
  }
  listFindings(limit = 100) {
    return this.db.prepare(`${FINDING_SELECT} ORDER BY updated_at DESC LIMIT ?`).all(limit);
  }
  /** Append one oracle evaluation record. Insert-only: evaluation history is
   * immutable evidence and is never updated in place. */
  putOracleEvaluation(r) {
    this.db.prepare(
      `INSERT INTO oracle_evaluations(id, run_id, step_id, finding_id, subject_key, phase,
           oracle_id, oracle_kind, oracle_strength, oracle_class, reproduced, confidence,
           expected, observed, explanation, version, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.id,
      r.runId,
      r.stepId,
      r.findingId,
      r.subjectKey,
      r.phase,
      r.oracleId,
      r.oracleKind,
      r.oracleStrength,
      r.oracleClass,
      r.reproduced ? 1 : 0,
      r.confidence,
      r.expected,
      r.observed,
      r.explanation,
      r.version,
      r.createdAt
    );
  }
  selectOracleEvaluations(where) {
    return `SELECT id, run_id AS runId, step_id AS stepId, finding_id AS findingId,
      subject_key AS subjectKey, phase, oracle_id AS oracleId, oracle_kind AS oracleKind,
      oracle_strength AS oracleStrength, oracle_class AS oracleClass, reproduced,
      confidence, expected, observed, explanation, version, created_at AS createdAt
      FROM oracle_evaluations ${where}`;
  }
  /** Evaluation history for a finding in insertion order (rowid breaks
   * same-millisecond ties). */
  listOracleEvaluationsForFinding(findingId) {
    const rows = this.db.prepare(`${this.selectOracleEvaluations("WHERE finding_id = ?")} ORDER BY created_at, rowid`).all(findingId);
    return rows.map((r) => ({ ...r, reproduced: r.reproduced !== 0 }));
  }
  /** Evaluation history for a whole run in insertion order. */
  listOracleEvaluationsForRun(runId) {
    const rows = this.db.prepare(`${this.selectOracleEvaluations("WHERE run_id = ?")} ORDER BY created_at, rowid`).all(runId);
    return rows.map((r) => ({ ...r, reproduced: r.reproduced !== 0 }));
  }
};

// packages/cli/src/doctor.ts
function fakeAdapterBin() {
  try {
    return resolveAdapterBin(
      import.meta.url,
      "inspector-adapter-fake.js",
      "..",
      "..",
      "adapter-fake",
      "src",
      "bin"
    );
  } catch {
    return null;
  }
}
var here2 = dirname4(fileURLToPath3(import.meta.url));
var PACKAGE_CONTEXTS = [
  "cli",
  "adapter-web",
  "cli-adapter",
  "electron-adapter"
].map((pkg) => join3(here2, "..", "..", pkg));
function resolveFromContexts(spec) {
  for (const dir of PACKAGE_CONTEXTS) {
    try {
      const resolved = createRequire2(join3(dir, "package.json")).resolve(spec);
      return { path: resolved, via: dir };
    } catch {
    }
  }
  return null;
}
function resolvable(spec) {
  if (resolveFromContexts(spec) !== null) return true;
  try {
    createRequire2(import.meta.url).resolve(spec);
    return true;
  } catch {
    return false;
  }
}
async function importOptional(spec) {
  let mod = null;
  try {
    mod = await import(spec);
  } catch {
  }
  if (!mod) {
    const resolved = resolveFromContexts(spec);
    if (!resolved) return null;
    try {
      mod = await import(pathToFileURL2(resolved.path).href);
    } catch {
      return null;
    }
  }
  const interop = mod.default;
  if (mod.chromium === void 0 && interop !== null && typeof interop === "object") {
    return interop;
  }
  return mod;
}
function execProbe(command, args, timeoutMs) {
  return new Promise((resolve2) => {
    const child = spawn2(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        spawn2("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true
        });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout?.on("data", (d) => stdout += d.toString());
    child.stderr?.on("data", (d) => stderr += d.toString());
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve2({
        code: null,
        stdout,
        stderr: `${stderr}${err.message}`,
        timedOut
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve2({ code, stdout, stderr, timedOut });
    });
  });
}
function probeNode() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "node >= 22",
    ok: major >= 22,
    required: true,
    detail: `node ${process.versions.node}`,
    remediation: major >= 22 ? void 0 : "install Node.js 22 or newer"
  };
}
function probeWorkspaceWritable(base) {
  try {
    mkdirSync2(base, { recursive: true });
    const probeFile = join3(base, ".doctor-write-probe");
    writeFileSync(probeFile, "probe");
    rmSync(probeFile);
    return {
      name: "workspace writable",
      ok: true,
      required: true,
      detail: base
    };
  } catch (e) {
    return {
      name: "workspace writable",
      ok: false,
      required: true,
      detail: e instanceof Error ? e.message : String(e),
      remediation: `grant write access to ${base} or pass --workspace <dir>`
    };
  }
}
function probeStore(base) {
  let store = null;
  try {
    store = Store.open(join3(base, "runs.db"));
    store.listRuns(1);
    return {
      name: "sqlite store opens",
      ok: true,
      required: true,
      detail: join3(base, "runs.db")
    };
  } catch (e) {
    return {
      name: "sqlite store opens",
      ok: false,
      required: true,
      detail: e instanceof Error ? e.message : String(e),
      remediation: "check disk health and that the workspace path is not read-only"
    };
  } finally {
    try {
      store?.close();
    } catch {
    }
  }
}
function probeFakeAdapter() {
  const bin3 = fakeAdapterBin();
  const ok = bin3 !== null;
  return {
    name: "fake adapter resolvable",
    ok,
    required: true,
    detail: bin3 ? bin3.binFile : "fake adapter binary not found in this installation",
    remediation: ok ? void 0 : "fake adapter missing; reinstall Inspector (dev: pnpm install at the repo root)"
  };
}
async function probeWeb() {
  const pw = await importOptional("playwright");
  if (!pw || typeof pw.chromium !== "object" || pw.chromium === null) {
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: "playwright package not resolvable",
      remediation: "run pnpm install at the repository root"
    };
  }
  try {
    const chromium2 = pw.chromium;
    const exePath = chromium2.executablePath();
    if (typeof exePath === "string" && exePath.length > 0 && existsSync2(exePath)) {
      return {
        name: "web adapter (Playwright + Chromium)",
        ok: true,
        required: false,
        detail: exePath
      };
    }
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: `chromium executable not present at ${String(exePath)}`,
      remediation: "pnpm exec playwright install chromium"
    };
  } catch (e) {
    return {
      name: "web adapter (Playwright + Chromium)",
      ok: false,
      required: false,
      detail: e instanceof Error ? e.message : String(e),
      remediation: "pnpm exec playwright install chromium"
    };
  }
}
function probePty() {
  const ok = resolvable("@lydell/node-pty");
  return {
    name: "pty support (@lydell/node-pty)",
    ok,
    required: false,
    detail: ok ? "@lydell/node-pty resolvable" : "@lydell/node-pty not resolvable",
    remediation: ok ? void 0 : "install workspace dependencies (@lydell/node-pty powers the terminal adapters)"
  };
}
async function probeAndroid() {
  const outcome = await execProbe("adb", ["version"], 2e3);
  if (outcome.timedOut) {
    return {
      name: "android adb on PATH",
      ok: false,
      required: false,
      detail: "adb version timed out after 2s",
      remediation: "ensure Android platform-tools are installed and adb responds"
    };
  }
  if (outcome.code !== 0) {
    return {
      name: "android adb on PATH",
      ok: false,
      required: false,
      detail: outcome.code === null ? "adb not found on PATH" : `adb version exited ${outcome.code}`,
      remediation: "install Android platform-tools and put adb on PATH"
    };
  }
  const firstLine = outcome.stdout.split("\n")[0]?.trim() ?? "adb";
  return {
    name: "android adb on PATH",
    ok: true,
    required: false,
    detail: firstLine
  };
}
var UIA_PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  "$root = [System.Windows.Automation.AutomationElement]::RootElement",
  "$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)",
  "$n = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond).Count",
  "Write-Output ('UIA_OK count=' + $n)"
].join("; ");
async function probeWindowsUia() {
  if (process.platform !== "win32") {
    return {
      name: "windows-uia automation",
      ok: false,
      required: false,
      detail: `unsupported platform: ${process.platform}`,
      remediation: "the windows-uia adapter requires Windows"
    };
  }
  const encoded = Buffer.from(UIA_PROBE_SCRIPT, "utf16le").toString("base64");
  const outcome = await execProbe(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    5e3
  );
  if (outcome.timedOut) {
    return {
      name: "windows-uia automation",
      ok: false,
      required: false,
      detail: "powershell UIA probe timed out after 5s",
      remediation: "verify Windows PowerShell and UIAutomationClient availability"
    };
  }
  const match = /UIA_OK count=(\d+)/.exec(outcome.stdout);
  if (outcome.code === 0 && match && Number(match[1]) >= 1) {
    return {
      name: "windows-uia automation",
      ok: true,
      required: false,
      detail: `${match[1]} top-level window(s) enumerated`
    };
  }
  const detail = match && Number(match[1]) === 0 ? "UIA loaded but zero top-level windows enumerable" : outcome.stderr.split("\n")[0]?.trim() || `powershell exited ${outcome.code}`;
  return {
    name: "windows-uia automation",
    ok: false,
    required: false,
    detail,
    remediation: "verify Windows PowerShell and UIAutomationClient availability"
  };
}
function electronAdapterBinFile() {
  try {
    return resolveAdapterBin(
      import.meta.url,
      "inspector-adapter-electron.js",
      "..",
      "..",
      "electron-adapter",
      "src",
      "bin"
    ).binFile;
  } catch {
    return null;
  }
}
async function probeElectron() {
  const adapterSrc = electronAdapterBinFile();
  const adapterPresent = adapterSrc !== null && existsSync2(adapterSrc);
  if (resolvable("electron")) {
    return {
      name: "electron runtime",
      ok: true,
      required: false,
      detail: `electron package resolvable${adapterPresent ? "; electron-adapter present" : ""}`
    };
  }
  return {
    name: "electron runtime",
    ok: false,
    required: false,
    detail: adapterPresent ? "electron-adapter binary present but the electron package is not installed" : "electron package not resolvable",
    remediation: "install electron (see packages/electron-adapter) to use the electron adapter"
  };
}
async function runDoctorProbes(base) {
  const results = [
    probeNode(),
    probeWorkspaceWritable(base),
    probeStore(base),
    probeFakeAdapter()
  ];
  results.push(await probeWeb());
  results.push(probePty());
  results.push(await probeAndroid());
  results.push(await probeWindowsUia());
  results.push(await probeElectron());
  return results;
}
function renderDoctorReport(checks) {
  const lines = checks.map((c) => {
    const status = c.ok ? "PASS" : c.required ? "FAIL" : "WARN";
    const line = `${status}  ${c.name}  (${c.detail})`;
    return c.ok || !c.remediation ? line : `${line}
      -> ${c.remediation}`;
  });
  const failedRequired = checks.filter((c) => !c.ok && c.required).length;
  const failedOptional = checks.filter((c) => !c.ok && !c.required).length;
  if (failedRequired === 0) {
    lines.push(
      failedOptional === 0 ? "doctor: OK" : `doctor: core checks OK (${failedOptional} optional capability warning(s))`
    );
  } else {
    lines.push(`doctor: ${failedRequired} core check(s) failed`);
  }
  return lines.join("\n");
}

// packages/cli/src/hunt.ts
import { mkdirSync as mkdirSync5, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join8 } from "node:path";

// packages/finding/src/engine.ts
var CRASH_CLASS_OUTCOME_CODES = /* @__PURE__ */ new Set(["TARGET_FAILURE"]);
var TargetFailureOracle = class {
  id = "target-failure";
  detect(result) {
    return result.outcomes.some(
      (o) => o.status === "target-failure" && CRASH_CLASS_OUTCOME_CODES.has(o.error?.code ?? "")
    );
  }
};
var CrashOracle = class {
  id = "page-error";
  detect(result) {
    return result.signals.some((s) => s.kind === "PAGE_ERROR");
  }
};
var ExplicitSignalOracle = class {
  id;
  signalKind;
  constructor(kind) {
    this.signalKind = kind;
    this.id = `signal:${kind}`;
  }
  detect(result) {
    return result.signals.some((s) => s.kind === this.signalKind);
  }
};
var defaultSignatureExtractor = (result) => {
  const kinds = [...new Set(result.signals.map((s) => s.kind))].sort();
  return kinds.length > 0 ? kinds.join("|") : null;
};
var OracleEngine = class _OracleEngine {
  oracles;
  signatureExtractor;
  constructor(oracles, opts = {}) {
    this.oracles = oracles;
    this.signatureExtractor = opts.signatureExtractor ?? defaultSignatureExtractor;
  }
  static defaults() {
    return new _OracleEngine([
      new TargetFailureOracle(),
      new CrashOracle(),
      new ExplicitSignalOracle("DEFECT_SUBMIT_INVALID"),
      new ExplicitSignalOracle("IMPOSSIBLE_STATE"),
      new ExplicitSignalOracle("ADAPTER_CRASH")
    ]);
  }
  evaluate(result) {
    const matched = this.oracles.filter((o) => o.detect(result));
    return {
      reproduced: matched.length > 0,
      signals: result.signals,
      matchedOracleIds: matched.map((o) => o.id),
      evaluations: this.oracles.map((o) => ({
        oracleId: o.id,
        reproduced: matched.includes(o),
        kind: o.kind ?? null,
        strength: o.strength ?? null,
        confidence: typeof o.confidence === "number" ? o.confidence : null,
        description: o.description ?? null
      }))
    };
  }
  /** The defect signature of a replay result under this engine's extractor. */
  signatureOf(result) {
    return this.signatureExtractor(result);
  }
  /**
   * Oracle ids that can fire on a replay exhibiting this signal alone.
   * Falls back to every registered oracle when none discriminates the signal
   * shape, so findings never lose oracle coverage silently.
   */
  relevantOracleIds(signal) {
    const probe = { outcomes: [], signals: [signal], observations: [] };
    const relevant = this.oracles.filter((o) => o.detect(probe)).map((o) => o.id);
    return relevant.length > 0 ? relevant : this.ids;
  }
  get ids() {
    return this.oracles.map((o) => o.id);
  }
};

// packages/finding/src/finding-engine.ts
var VALID_TRANSITIONS = {
  OBSERVED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["REPRODUCING", "REJECTED", "FLAKY", "CONFIRMED", "NEEDS_HUMAN_ORACLE"],
  REPRODUCING: ["MINIMIZED", "CONFIRMED", "FLAKY", "REJECTED", "CANDIDATE"],
  MINIMIZED: ["CONFIRMED", "FLAKY", "REJECTED"],
  CONFIRMED: ["MINIMIZED", "PATCHING", "VERIFYING", "RESOLVED", "REGRESSED"],
  PATCHING: ["VERIFYING", "CONFIRMED", "REGRESSED"],
  VERIFYING: ["RESOLVED", "REGRESSED", "CONFIRMED"],
  RESOLVED: ["REGRESSED"],
  REGRESSED: ["CONFIRMED", "PATCHING"],
  REJECTED: [],
  FLAKY: ["CANDIDATE", "CONFIRMED", "REJECTED"],
  NEEDS_HUMAN_ORACLE: ["CONFIRMED", "REJECTED"]
};
var InvalidReproductionPolicyError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidReproductionPolicyError";
  }
};
var ORACLE_EVALUATION_VERSION = "oracle-eval/1";
var ORACLE_CLASSES = /* @__PURE__ */ new Set([
  "invariant",
  "metamorphic",
  "structural",
  "persistence",
  "semantic-suspicion"
]);
function validatePolicy(policy) {
  const { attempts, minSuccesses } = policy;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new InvalidReproductionPolicyError(
      `invalid reproduction policy: attempts must be an integer >= 1 (got ${attempts})`
    );
  }
  if (!Number.isInteger(minSuccesses) || minSuccesses < 1 || minSuccesses > attempts) {
    throw new InvalidReproductionPolicyError(
      `invalid reproduction policy: minSuccesses must be an integer in [1, attempts] (got ${minSuccesses}, attempts ${attempts})`
    );
  }
}
function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    Object.freeze(value);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
function subjectKeyOf(actions) {
  return actions.map((a) => a.id).join(">");
}
function summarizeObserved(result) {
  const parts = result.signals.map((s) => s.kind);
  for (const o of result.outcomes) {
    if (o.status === "target-failure" && o.error?.code) parts.push(String(o.error.code));
  }
  return parts.length > 0 ? [...new Set(parts)].sort().join(",") : "(none)";
}
var FindingEngine = class _FindingEngine {
  constructor(oracle = OracleEngine.defaults(), store, opts = {}) {
    this.oracle = oracle;
    this.store = store;
    this.signatureExtractor = opts.signatureExtractor ?? defaultSignatureExtractor;
  }
  signatureExtractor;
  ingest(signal, opts = {}) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const finding = {
      id: newId("find"),
      runId: opts.runId ?? null,
      status: "CANDIDATE",
      title: opts.title ?? `Candidate defect: ${signal.kind}`,
      confidence: 0,
      severity: "unknown",
      revision: opts.revision ?? null,
      // Record only the oracles relevant to this signal so evidence names
      // the detectors that can actually fire, not the whole registry.
      oracleIds: this.oracle.relevantOracleIds(signal),
      reproduction: null,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
      signature: signal.kind,
      minimization: null,
      lastTransition: null,
      adapter: opts.adapter ?? null
    };
    this.persist(finding);
    return finding;
  }
  transition(finding, next, meta = {}) {
    const allowed = VALID_TRANSITIONS[finding.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`invalid finding transition ${finding.status} -> ${next}`);
    }
    const from = finding.status;
    finding.status = next;
    finding.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const recorded = { from, to: next, at: finding.updatedAt };
    if (meta.reason !== void 0) recorded.reason = meta.reason;
    if (meta.actor !== void 0) recorded.actor = meta.actor;
    finding.lastTransition = recorded;
    this.persist(finding);
    return finding;
  }
  // PART3
  async reproduce(finding, actions, driver, policy) {
    validatePolicy(policy);
    this.transition(finding, "REPRODUCING");
    let successes = 0;
    let errors = 0;
    let lastError = null;
    let lastSignals = [];
    const matchedOracleIds = /* @__PURE__ */ new Set();
    let stats = { attempts: policy.attempts, successes: 0, errors: 0, lastError: null };
    try {
      for (let i = 0; i < policy.attempts; i++) {
        let result;
        try {
          result = await _FindingEngine.replayBounded(driver, actions, policy.perAttemptTimeoutMs);
        } catch (e) {
          errors += 1;
          lastError = e instanceof Error ? e.message : String(e);
          continue;
        }
        lastSignals = result.signals;
        const evaluation = this.oracle.evaluate(result);
        this.persistOracleEvaluations(evaluation.evaluations, {
          phase: "reproduce",
          findingId: finding.id,
          runId: finding.runId,
          subjectKey: subjectKeyOf(actions),
          expected: "no defect signal on replay",
          observed: summarizeObserved(result)
        });
        if (evaluation.reproduced) {
          successes += 1;
          for (const id of evaluation.matchedOracleIds) matchedOracleIds.add(id);
        }
      }
      stats = {
        attempts: policy.attempts,
        successes,
        errors,
        lastError,
        // Name the deciding oracles so confirmed findings are auditable.
        ...matchedOracleIds.size > 0 ? { matchedOracleIds: [...matchedOracleIds].sort() } : {}
      };
      finding.reproduction = stats;
      const ratio = successes / policy.attempts;
      finding.confidence = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
      if (successes >= policy.minSuccesses) {
        finding.severity = successes === policy.attempts ? "high" : "medium";
        this.transition(finding, "CONFIRMED");
      } else if (successes === 0) {
        this.transition(finding, "REJECTED");
      } else {
        this.transition(finding, "FLAKY");
      }
    } catch (e) {
      if (finding.status === "REPRODUCING") {
        this.transition(finding, "CANDIDATE", {
          reason: "internal error during reproduction",
          actor: "finding-engine"
        });
      }
      throw e;
    }
    this.persist(finding);
    return { finding, stats, lastSignals };
  }
  async minimize(finding, actions, driver, opts = {}) {
    let replaysLeft = opts.maxReplays ?? 20;
    let probes = 0;
    let removals = 0;
    let current = actions.slice();
    const usingDefaultExtractor = this.signatureExtractor === defaultSignatureExtractor;
    let originalSignature = usingDefaultExtractor ? finding.signature ?? null : null;
    let verified = false;
    if (replaysLeft > 0) {
      replaysLeft -= 1;
      probes += 1;
      const baseResult = await driver.replay(current);
      const baseSig = this.signatureExtractor(baseResult);
      if (originalSignature === null) originalSignature = baseSig;
      const baseEvaluation = this.oracle.evaluate(baseResult);
      this.persistOracleEvaluations(baseEvaluation.evaluations, {
        phase: "minimize",
        findingId: finding.id,
        runId: finding.runId,
        subjectKey: subjectKeyOf(current),
        expected: `baseline replay reproduces signature ${originalSignature ?? "(unknown)"}`,
        observed: summarizeObserved(baseResult)
      });
      verified = baseSig !== null && baseSig === originalSignature && baseEvaluation.reproduced;
    }
    if (!verified) {
      finding.minimization = { probes, removals: 0, verifiedReproduction: false };
      this.persist(finding);
      return current;
    }
    let changed = true;
    while (changed && replaysLeft > 0) {
      changed = false;
      const granularity = Math.max(1, Math.floor(current.length / 2));
      for (let i = 0; i < current.length; i += granularity) {
        if (replaysLeft <= 0) break;
        const candidate = current.filter((_, idx) => idx < i || idx >= i + granularity);
        if (candidate.length === 0) continue;
        const result = await driver.replay(candidate);
        replaysLeft -= 1;
        probes += 1;
        const candidateSig = this.signatureExtractor(result);
        const candidateEvaluation = this.oracle.evaluate(result);
        this.persistOracleEvaluations(candidateEvaluation.evaluations, {
          phase: "minimize",
          findingId: finding.id,
          runId: finding.runId,
          subjectKey: subjectKeyOf(candidate),
          expected: `reduced replay reproduces signature ${originalSignature ?? "(unknown)"}`,
          observed: summarizeObserved(result)
        });
        if (candidateSig !== null && candidateSig === originalSignature && candidateEvaluation.reproduced) {
          removals += current.length - candidate.length;
          current = candidate;
          changed = true;
          break;
        }
      }
    }
    finding.minimization = { probes, removals, verifiedReproduction: true };
    if (finding.status === "REPRODUCING" || finding.status === "CONFIRMED") {
      this.transition(finding, "MINIMIZED");
    }
    this.persist(finding);
    return current;
  }
  // PART4
  buildBundle(finding, original, minimized, opts = {}) {
    const artifactRefs = [
      .../* @__PURE__ */ new Set([...opts.artifactRefs ?? [], ...finding.artifactRefs])
    ];
    const bundle = {
      schema: "inspector-evidence/1",
      finding: deepFreeze(structuredClone(finding)),
      revision: opts.revision ?? finding.revision,
      environment: deepFreeze(structuredClone(opts.environment ?? {})),
      originalSteps: deepFreeze(structuredClone(original)),
      minimizedSteps: deepFreeze(structuredClone(minimized)),
      oracleEvidence: deepFreeze(structuredClone(opts.signals ?? [])),
      // Evaluation history comes from the durable store so bundles answer
      // "which oracles ran, what did they see, why promoted". Snapshotted
      // (cloned + frozen) like every other bundle field.
      evaluations: deepFreeze(
        structuredClone(this.store?.listOracleEvaluationsForFinding(finding.id) ?? [])
      ),
      // Frozen snapshot; the EvidenceBundle field predates readonly typing.
      artifactRefs: Object.freeze(artifactRefs),
      replayCommand: opts.replayCommand ?? `inspector replay --finding ${finding.id}`
    };
    return deepFreeze(bundle);
  }
  exportRegression(finding, minimized, expectOracle, opts = {}) {
    return {
      schema: "inspector-regression/1",
      findingId: finding.id,
      adapter: opts.adapter ?? finding.adapter ?? "adapter-fake",
      steps: minimized,
      expectOracle
    };
  }
  // PART5
  /** Awaits one replay attempt, optionally bounded by a wall-clock timeout. */
  static async replayBounded(driver, actions, timeoutMs) {
    if (timeoutMs === void 0 || timeoutMs <= 0) return driver.replay(actions);
    let timer;
    try {
      return await Promise.race([
        driver.replay(actions),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`replay attempt timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Persist one oracle-evaluation record per descriptor for a single
   * evaluation event. Used by the repair pipeline (repair-verify phase) so
   * verification-phase oracle outcomes are auditable like reproduction ones.
   * Persistence failures are contained: provenance must never break repair.
   */
  recordRepairVerification(input) {
    const matched = new Set(input.matchedIds);
    this.persistOracleEvaluations(
      input.descriptors.map((d) => ({
        oracleId: d.id,
        reproduced: matched.has(d.id),
        kind: d.kind ?? null,
        strength: d.strength ?? null,
        confidence: typeof d.confidence === "number" ? d.confidence : null,
        description: d.description ?? null
      })),
      {
        phase: "repair-verify",
        findingId: input.finding.id,
        runId: input.finding.runId,
        expected: input.expected,
        observed: input.observed
      }
    );
  }
  /** Failure-contained evaluation-record persistence (log-and-continue). */
  persistOracleEvaluations(evaluations, opts) {
    if (!this.store || evaluations.length === 0) return;
    try {
      for (const e of evaluations) {
        const record = {
          id: newId(),
          runId: opts.runId,
          stepId: null,
          findingId: opts.findingId,
          subjectKey: opts.subjectKey ?? null,
          phase: opts.phase,
          oracleId: e.oracleId,
          oracleKind: e.kind,
          oracleStrength: e.strength,
          oracleClass: e.kind !== null && ORACLE_CLASSES.has(e.kind) ? e.kind : null,
          reproduced: e.reproduced,
          confidence: e.confidence,
          expected: opts.expected,
          observed: opts.observed,
          explanation: e.description ?? `${e.oracleId} ${e.reproduced ? "matched" : "did not match"} on replay`,
          version: ORACLE_EVALUATION_VERSION,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.store.putOracleEvaluation(record);
      }
    } catch (err) {
      console.warn(
        `[finding-engine] failed to persist oracle evaluation records: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  persist(finding) {
    if (!this.store) return;
    const record = {
      id: finding.id,
      runId: finding.runId,
      status: finding.status,
      title: finding.title,
      confidence: finding.confidence,
      severity: finding.severity,
      revision: finding.revision,
      oracleIds: JSON.stringify(finding.oracleIds),
      reproductionJson: finding.reproduction ? JSON.stringify(finding.reproduction) : null,
      artifactRefs: JSON.stringify(finding.artifactRefs),
      createdAt: finding.createdAt,
      updatedAt: finding.updatedAt,
      // Wave-1 fields must survive restarts, not live in memory only.
      signature: finding.signature ?? null,
      minimizationJson: finding.minimization ? JSON.stringify(finding.minimization) : null,
      lastTransitionJson: finding.lastTransition ? JSON.stringify(finding.lastTransition) : null,
      adapter: finding.adapter ?? null
    };
    this.store.putFinding(record);
  }
};

// packages/adapter-fake/src/state-machine.ts
var INVALID_TRANSITION = {
  status: "success",
  nextState: "home",
  summary: { ignored: true, reason: "invalid-transition" }
};
var FakeStateMachine = class {
  state = "home";
  fields = {};
  flag = false;
  artifactCount = 0;
  reset() {
    this.state = "home";
    this.fields = {};
    this.flag = false;
    this.artifactCount = 0;
  }
  get artifactTotal() {
    return this.artifactCount;
  }
  apply(action) {
    switch (action.kind) {
      case "openForm":
        if (this.state !== "home") return INVALID_TRANSITION;
        this.state = "form";
        return this.ok();
      case "fillField":
        if (this.state !== "form") return INVALID_TRANSITION;
        this.fields[String(action.input?.name ?? "default")] = String(action.input?.value ?? "");
        return this.ok();
      case "submit": {
        if (this.state !== "form") return INVALID_TRANSITION;
        this.state = "submitting";
        const value = this.fields["default"] ?? "";
        if (value === "BAD") {
          this.state = "error";
          return {
            status: "target-failure",
            nextState: "error",
            oracleSignal: "DEFECT_SUBMIT_INVALID",
            summary: { value, reason: "deterministic oracle: invalid submit" }
          };
        }
        this.state = "done";
        return this.ok({ value });
      }
      case "retry":
        if (this.state !== "error") return INVALID_TRANSITION;
        this.state = "form";
        return this.ok();
      case "goHome":
        this.state = "home";
        return this.ok();
      case "toggleFlag":
        this.flag = !this.flag;
        return this.ok({ flag: this.flag });
      case "createArtifact":
        this.artifactCount += 1;
        return this.ok({ artifact: `stub-${this.artifactCount}` });
      case "reset":
        this.reset();
        return this.ok();
      default:
        return INVALID_TRANSITION;
    }
  }
  ok(extra = {}) {
    return {
      status: "success",
      nextState: this.state,
      summary: { ...this.snapshot(), ...extra }
    };
  }
  snapshot() {
    return { state: this.state, fields: { ...this.fields }, flag: this.flag };
  }
};

// packages/artifact-store/src/artifact-store.ts
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync2,
  realpathSync,
  renameSync,
  rmSync as rmSync2,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { dirname as dirname5, isAbsolute, join as join4, relative, resolve, sep } from "node:path";
var ArtifactStoreError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactStoreError";
  }
};
var PathPolicyError = class extends ArtifactStoreError {
  constructor(message) {
    super(message);
    this.name = "PathPolicyError";
  }
};
var CorruptionError = class extends ArtifactStoreError {
  constructor(message) {
    super(message);
    this.name = "CorruptionError";
  }
};
var RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
var SHA256_PATTERN = /^[0-9a-f]{64}$/;
var NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new PathPolicyError(`unsafe runId: ${JSON.stringify(runId)}`);
  }
}
function assertSha256(sha256) {
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    throw new PathPolicyError(`unsafe sha256: ${JSON.stringify(sha256)}`);
  }
}
function assertName(name) {
  if (!NAME_PATTERN.test(name)) {
    throw new PathPolicyError(`unsafe artifact name: ${JSON.stringify(name)}`);
  }
}
function lstatType(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return "absent";
  }
  if (st.isFile()) return "file";
  if (st.isDirectory()) return "dir";
  return "other";
}
var ArtifactStore = class {
  constructor(baseDir, opts = {}) {
    this.opts = opts;
    if (typeof baseDir !== "string" || baseDir.length === 0) {
      throw new PathPolicyError("baseDir must be a non-empty string");
    }
    const resolved = resolve(baseDir);
    if (dirname5(resolved) === resolved) {
      throw new PathPolicyError(`baseDir must not be a filesystem root: ${resolved}`);
    }
    this.baseAbs = resolved;
  }
  index = /* @__PURE__ */ new Map();
  baseAbs;
  /** Refuse any resolved path that is not strictly inside the store base. */
  contain(p) {
    const resolved = resolve(p);
    const rel = relative(this.baseAbs, resolved);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PathPolicyError(`artifact path escapes store base: ${p}`);
    }
    return resolved;
  }
  runDir(runId) {
    assertRunId(runId);
    return this.contain(join4(this.baseAbs, runId, "artifacts"));
  }
  /**
   * Refuse a run directory that exists but is not a real directory inside the
   * store (e.g. a symlink pointing elsewhere), before anything is created in it.
   */
  ensureRunDirSafe(runId) {
    const dir = this.runDir(runId);
    const runPath = join4(this.baseAbs, runId);
    const t = lstatType(runPath);
    if (t === "dir") {
      this.contain(realpathSync(runPath));
    } else if (t !== "absent") {
      throw new PathPolicyError(`refusing non-directory run path: ${runPath}`);
    }
    return dir;
  }
  /**
   * Write content to a unique temp file ('wx' guards against planted temp
   * paths) and atomically rename it onto the destination.
   */
  atomicWrite(dest, content) {
    const tmp = `${dest}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync2(tmp, content, { flag: "wx" });
      renameSync(tmp, dest);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
      }
    }
  }
  write(options) {
    assertRunId(options.runId);
    if (options.name !== void 0) assertName(options.name);
    if (this.opts.maxBytes !== void 0 && options.content.byteLength > this.opts.maxBytes) {
      throw new ArtifactStoreError(
        `artifact size ${options.content.byteLength} exceeds limit ${this.opts.maxBytes}`
      );
    }
    const sha256 = createHash("sha256").update(options.content).digest("hex");
    const dir = this.ensureRunDirSafe(options.runId);
    const fileName = options.name ? `${sha256}-${options.name}` : sha256;
    const absPath = this.contain(join4(dir, fileName));
    const destType = lstatType(absPath);
    if (destType === "file") {
      const disk = readFileSync2(absPath);
      const diskSha = createHash("sha256").update(disk).digest("hex");
      if (disk.byteLength !== options.content.byteLength || diskSha !== sha256) {
        this.atomicWrite(absPath, options.content);
      }
    } else {
      if (destType !== "absent") {
        throw new PathPolicyError(`refusing non-regular artifact destination: ${absPath}`);
      }
      mkdirSync3(dir, { recursive: true });
      this.contain(realpathSync(dir));
      this.atomicWrite(absPath, options.content);
    }
    const meta = {
      sha256,
      mime: options.mime,
      size: statSync(absPath).size,
      // disk truth, not requested length
      path: absPath,
      runId: options.runId,
      storedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.index.set(this.key(options.runId, sha256), meta);
    return meta;
  }
  key(runId, sha256) {
    return `${runId}:${sha256}`;
  }
  read(runId, sha256, opts = {}) {
    const meta = this.meta(runId, sha256);
    if (!meta) throw new ArtifactStoreError(`artifact not found: ${sha256}`);
    const content = readFileSync2(meta.path);
    if (opts.verify !== false) {
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== sha256) {
        throw new CorruptionError(`artifact corruption detected on read: ${sha256}`);
      }
    }
    return content;
  }
  meta(runId, sha256) {
    assertRunId(runId);
    assertSha256(sha256);
    const cached = this.index.get(this.key(runId, sha256));
    if (cached) return cached;
    const absPath = this.contain(join4(this.runDir(runId), sha256));
    let stat;
    try {
      stat = statSync(absPath);
    } catch {
      return void 0;
    }
    this.contain(realpathSync(absPath));
    if (!stat.isFile()) return void 0;
    return {
      sha256,
      mime: "application/octet-stream",
      size: stat.size,
      path: absPath,
      runId,
      storedAt: new Date(stat.mtimeMs).toISOString()
    };
  }
  /** Recompute the hash of stored content and compare to the recorded sha256. */
  verify(runId, sha256) {
    const meta = this.meta(runId, sha256);
    if (!meta) return false;
    const content = readFileSync2(meta.path);
    const actual = createHash("sha256").update(content).digest("hex");
    return actual === sha256;
  }
  /** Detect corruption by reading; throws if the stored hash does not match content. */
  verifyStrict(runId, sha256) {
    const meta = this.meta(runId, sha256);
    if (!meta) throw new ArtifactStoreError(`artifact not found: ${sha256}`);
    if (!this.verify(runId, sha256)) {
      throw new CorruptionError(`artifact corruption detected: ${sha256}`);
    }
  }
  relativePath(runId, sha256) {
    const meta = this.meta(runId, sha256);
    if (!meta) return void 0;
    return relative(this.baseAbs, meta.path);
  }
  clear() {
    if (dirname5(this.baseAbs) === this.baseAbs) {
      throw new PathPolicyError(`refusing to clear filesystem root: ${this.baseAbs}`);
    }
    rmSync2(this.baseAbs, { recursive: true, force: true });
    this.index.clear();
  }
};

// packages/adapter-fake/src/index.ts
var bin = resolveAdapterBin(import.meta.url, "inspector-adapter-fake.js", "bin");

// packages/finding/src/drivers.ts
var FakeStateMachineDriver = class {
  async replay(actions) {
    const sm = new FakeStateMachine();
    const outcomes = [];
    const signals = [];
    for (const a of actions) {
      const r = sm.apply({ kind: a.kind, input: a.input });
      const outcome = {
        actionId: a.id,
        runId: a.runId,
        environmentId: a.environmentId,
        status: r.status === "target-failure" ? "target-failure" : "success",
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        stateAfter: r.nextState
      };
      if (r.status === "target-failure") {
        outcome.error = {
          code: "TARGET_FAILURE",
          message: r.oracleSignal ?? "failure",
          detail: r.summary
        };
        signals.push({ kind: r.oracleSignal ?? "TARGET_FAILURE", detail: r.summary });
      }
      outcomes.push(outcome);
    }
    return { outcomes, signals, observations: [] };
  }
};

// packages/explore/src/rng.ts
import { createHash as createHash2 } from "node:crypto";
var EmptyPickError = class extends Error {
  constructor() {
    super("Rng.pick called with an empty array");
    this.name = "EmptyPickError";
  }
};
function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (items) => {
      if (items.length === 0) throw new EmptyPickError();
      return items[Math.floor(next() * items.length)];
    },
    fork: (salt) => mulberry32((seed ^ Math.imul(salt + 1, 2654435761)) >>> 0)
  };
  return rng;
}
function strongHash(s) {
  return createHash2("sha256").update(s).digest("hex").slice(0, 32);
}

// packages/explore/src/state.ts
function uiTreeOf(obs) {
  const summary = obs.summary;
  return Array.isArray(summary?.uiTree) ? summary.uiTree : [];
}
function screenFingerprint(obs) {
  const els = uiTreeOf(obs).filter((e) => !e.hidden && !e.disabled).map((e) => `${e.tag}|${e.id ?? ""}|${e.name ?? ""}|${e.role ?? ""}`).sort();
  return `scr|${els.join(",")}`;
}
function stateFingerprint(obs) {
  const summary = obs.summary;
  const screen = screenFingerprint(obs);
  const dyn = uiTreeOf(obs).filter((e) => !e.hidden).map((e) => {
    if (e.value !== void 0) return `${e.id || e.name}:v=${e.value}`;
    if (e.text !== void 0) return `${e.id || e.name}:t=${e.text}`;
    return null;
  }).filter(Boolean).sort().join(",");
  const storage = strongHash(
    Object.entries(summary?.storage ?? {}).map(([k, v]) => `${k}=${v}`).sort().join(",")
  );
  return `${screen}#${dyn}#st:${storage}`;
}
var StateGraph = class {
  nodes = /* @__PURE__ */ new Map();
  edges = /* @__PURE__ */ new Map();
  screenCounts = /* @__PURE__ */ new Map();
  visitState(fingerprint, screen, actionIndex) {
    const existing = this.nodes.get(fingerprint);
    if (existing) {
      existing.visits += 1;
      existing.lastSeenActionIndex = actionIndex;
      this.screenCounts.set(screen, (this.screenCounts.get(screen) ?? 0) + 1);
      return false;
    }
    this.nodes.set(fingerprint, {
      fingerprint,
      screen,
      firstSeenActionIndex: actionIndex,
      visits: 1,
      lastSeenActionIndex: actionIndex
    });
    this.screenCounts.set(screen, (this.screenCounts.get(screen) ?? 0) + 1);
    return true;
  }
  recordEdge(fromState, actionKey, toState, actionIndex) {
    const key = `${fromState}::${actionKey}`;
    const e = this.edges.get(key);
    if (e) {
      e.count += 1;
      e.lastSeenActionIndex = actionIndex;
    } else {
      this.edges.set(key, {
        fromState,
        actionKey,
        count: 1,
        lastSeenActionIndex: actionIndex,
        leadsToState: toState
      });
    }
  }
  edgeCount(fromState, actionKey) {
    return this.edges.get(`${fromState}::${actionKey}`)?.count ?? 0;
  }
  get stateCount() {
    return this.nodes.size;
  }
};

// packages/explore/src/inputs.ts
function boundaryValues(field) {
  const base = ["", "admin", "A".repeat(80), "CRASH", "<b>x</b>", "12345"];
  if (field.toLowerCase().includes("user")) {
    base.push("user@example.com");
  }
  return base;
}
var DEFAULT_SEQUENCE_LENGTHS = [2, 3, 5, 8, 12];

// packages/explore/src/inventory.ts
function escapeAttrValue(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
function selectorFor(el, tagIndex) {
  if (el.id) return `#${el.id}`;
  const label = (el.name ?? "").trim();
  if (label) {
    if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") {
      return `[aria-label="${escapeAttrValue(label)}"]`;
    }
    return `text="${escapeAttrValue(label)}"`;
  }
  return `${el.tag} >> nth=${tagIndex}`;
}
var PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight"
];
function buildInventory(uiTree, caps, opts) {
  const out = [];
  const actCaps = new Set(caps.capabilities.act ?? []);
  const tagCounts = /* @__PURE__ */ new Map();
  const tagIndexOf = /* @__PURE__ */ new Map();
  for (const el of uiTree) {
    const i = tagCounts.get(el.tag) ?? 0;
    tagIndexOf.set(el, i);
    tagCounts.set(el.tag, i + 1);
  }
  const visible = uiTree.filter((e) => !e.hidden && !e.disabled);
  for (const el of visible) {
    const sel = selectorFor(el, tagIndexOf.get(el) ?? 0);
    if (!sel) continue;
    const isInteractive = el.tag === "button" || el.role === "button" || el.tag === "a" || el.tag === "input" || el.tag === "textarea" || el.tag === "select";
    if (el.tag === "button" || el.role === "button" || el.tag === "a") {
      if (actCaps.has("click")) {
        out.push({
          id: `c_${el.id || el.name}`,
          kind: "click",
          selector: sel,
          risk: "interact",
          actionKey: `click:${sel}`,
          sourceElementId: el.id,
          priority: 5
        });
      }
    } else if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") {
      const values = boundaryValues(el.id || el.name || el.tag);
      if (actCaps.has("fill")) {
        for (const v of values) {
          const boundary = v.length >= 64 || v === "CRASH" || v.includes("<");
          out.push({
            id: `f_${el.id}_${strongHash(v)}`,
            kind: "fill",
            selector: sel,
            value: v,
            risk: "interact",
            actionKey: `fill:${sel}:${strongHash(v)}`,
            sourceElementId: el.id,
            isBoundary: boundary,
            priority: boundary ? 8 : 4
          });
        }
      }
      if (actCaps.has("press") && el.tag === "input") {
        for (const key of PRESS_KEYS) {
          out.push({
            id: `p_${el.id}_${key}`,
            kind: "press",
            selector: sel,
            value: key,
            risk: "interact",
            actionKey: `press:${sel}:${key}`,
            sourceElementId: el.id,
            priority: 2
          });
        }
      }
      if (actCaps.has("select") && el.tag === "select") {
        out.push({
          id: `s_${el.id}`,
          kind: "select",
          selector: sel,
          value: "0",
          risk: "interact",
          actionKey: `select:${sel}`,
          sourceElementId: el.id,
          priority: 3
        });
      }
    }
    void isInteractive;
  }
  if (actCaps.has("reload")) {
    out.push({
      id: "g_reload",
      kind: "reload",
      risk: "interact",
      actionKey: "reload",
      priority: 1
    });
  }
  if (actCaps.has("back")) {
    out.push({
      id: "g_back",
      kind: "back",
      risk: "interact",
      actionKey: "back",
      priority: 1
    });
  }
  if (actCaps.has("forward")) {
    out.push({
      id: "g_forward",
      kind: "forward",
      risk: "interact",
      actionKey: "forward",
      priority: 1
    });
  }
  if (actCaps.has("wait")) {
    out.push({
      id: "g_wait",
      kind: "wait",
      risk: "observe",
      actionKey: "wait",
      priority: 0
    });
  }
  if (opts.allowFaults) {
    for (const f of caps.capabilities.faults ?? []) {
      out.push({
        id: `fault_${f}`,
        kind: "fault",
        fault: f,
        risk: "mutate-test-state",
        actionKey: `fault:${f}`,
        priority: 3
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return out.filter((c) => {
    if (seen.has(c.actionKey)) return false;
    seen.add(c.actionKey);
    return true;
  });
}

// packages/explore/src/scoring.ts
var DEFAULT_WEIGHTS = {
  novelty: 1,
  unvisitedEdge: 0.8,
  boundary: 0.6,
  rarity: 0.5,
  cyclePenalty: 1.2,
  riskPenalty: 0.2
};
function scoreAction(c, ctx) {
  const w = { ...DEFAULT_WEIGHTS, ...ctx.weights ?? {} };
  let s = 0;
  const edgeTried = ctx.graph.edgeCount(ctx.currentState, c.actionKey) > 0;
  s += (w.novelty + w.unvisitedEdge) * (edgeTried ? 0 : 1);
  s += w.boundary * (c.isBoundary ? 1 : 0);
  const screenVisits = ctx.graph.screenCounts.get(ctx.currentScreen) ?? 0;
  s += w.rarity * (screenVisits <= 1 ? 1 : 0);
  const recentRepeats = ctx.recentActionKeys.filter(
    (k) => k === c.actionKey
  ).length;
  s -= w.cyclePenalty * Math.min(recentRepeats, 3);
  s -= w.riskPenalty * (c.risk === "mutate-test-state" ? 1 : 0);
  s += c.priority * 0.05;
  return s;
}

// packages/explore/src/anomaly.ts
var DefaultAnomalyDetector = class {
  detect({
    action,
    outcome,
    before,
    after,
    actionPath,
    stateBefore
  }) {
    if (outcome && outcome.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE") {
      const msg = outcome.error?.message ?? "application crash";
      return {
        key: `crash:${stateBefore}:${action.kind}:${action.input?.selector ?? ""}:${msg.slice(0, 40)}`,
        classKey: `PAGE_ERROR:${msg.slice(0, 40)}`,
        kind: "PAGE_ERROR",
        message: msg,
        stateBefore,
        actionPath: actionPath.slice(),
        outcome,
        severityHint: "high"
      };
    }
    if (after) {
      const impossible = findImpossibleState(before, after);
      if (impossible) {
        return {
          key: `impossible:${stateBefore}:${action.kind}:${action.input?.selector ?? ""}:${impossible}`,
          classKey: `IMPOSSIBLE_STATE:${impossible}`,
          kind: "IMPOSSIBLE_STATE",
          message: impossible,
          stateBefore,
          actionPath: actionPath.slice(),
          severityHint: "high"
        };
      }
    }
    return null;
  }
};
var IMPOSSIBLE_TEXTS = /* @__PURE__ */ new Set([
  "NaN",
  "undefined",
  "null",
  "Infinity",
  "-Infinity"
]);
function elementKey(el) {
  return el.id || el.name || `${el.tag}:${el.role}`;
}
function findImpossibleState(before, after) {
  const beforeText = /* @__PURE__ */ new Map();
  for (const el of uiTreeOf(before)) {
    if (el.text != null) beforeText.set(elementKey(el), el.text);
  }
  for (const el of uiTreeOf(after)) {
    const t = el.text?.trim();
    if (t === void 0 || !IMPOSSIBLE_TEXTS.has(t)) continue;
    const prev = beforeText.get(elementKey(el));
    if (prev === void 0) continue;
    const prevTrim = prev.trim();
    if (prevTrim === t) continue;
    if (!Number.isFinite(Number(prevTrim))) continue;
    return `${elementKey(el)} shows impossible value: ${t}`;
  }
  return null;
}

// packages/explore/src/planner.ts
var NoopPlanner = class {
  propose(_ctx) {
    return null;
  }
};

// packages/explore/src/faults.ts
var FaultController = class {
  constructor(caps, policy) {
    this.caps = caps;
    this.policy = policy;
  }
  get allowed() {
    return this.policy.enableFaultInjection && this.policy.disposable && (this.caps.capabilities.faults?.length ?? 0) > 0;
  }
  permittedFaults() {
    if (!this.allowed) return [];
    return this.caps.capabilities.faults ?? [];
  }
};

// packages/explore/src/web-replay.ts
import { tmpdir as tmpdir2 } from "node:os";
import { join as join6 } from "node:path";

// packages/adapter-web/src/seeded-app.ts
import { createServer } from "node:http";
function startSeedServer(opts = {}) {
  const body = opts.html ?? SEED_HTML;
  const server = createServer((req, res) => {
    if (opts.redirectLoop && req.url && req.url.startsWith("/loop")) {
      res.writeHead(302, { location: "/loop" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  let url = "";
  let localAddress = "";
  const ready = new Promise((resolve2, reject) => {
    server.once("listening", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        localAddress = addr.address;
        url = `http://127.0.0.1:${addr.port}/`;
      }
      resolve2();
    });
    server.once("error", reject);
  });
  server.listen(0, "127.0.0.1");
  return {
    get url() {
      return url;
    },
    get localAddress() {
      return localAddress;
    },
    ready,
    close: () => {
      server.close();
    }
  };
}
var SEED_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>SeedBank</title></head>
<body>
  <h1>SeedBank Demo</h1>
  <section id="login">
    <input id="username" aria-label="username" />
    <input id="password" aria-label="password" type="password" />
    <button id="loginBtn" role="button">Log in</button>
    <p id="loginMsg" aria-live="polite"></p>
  </section>
  <section id="dashboard" hidden>
    <p id="welcome">Welcome</p>
    <button id="increment" role="button">Increment</button>
    <span id="count">0</span>
    <button id="save" role="button">Save preference</button>
    <button id="boom" role="button">Trigger crash</button>
    <a id="forbidden" href="https://evil.example.com/secret">External link</a>
  </section>
  <script>
    const $ = (id) => document.getElementById(id);
    let count = 0;
    $("loginBtn").addEventListener("click", () => {
      const u = $("username").value, p = $("password").value;
      // Hidden defect: a boundary username value crashes validation.
      if (u.length >= 64 || u === "CRASH") {
        throw new Error("HiddenValidationCrash");
      }
      if (u && p) {
        $("login").hidden = true;
        $("dashboard").hidden = false;
        $("welcome").textContent = "Welcome " + (u || "");
      } else {
        $("loginMsg").textContent = "invalid credentials";
      }
    });
    $("increment").addEventListener("click", () => {
      count += 1;
      // Hidden defect: the counter overflows at a boundary and corrupts state.
      if (count >= 8) {
        $("count").textContent = "NaN";
        throw new Error("IncrementOverflowCrash");
      }
      $("count").textContent = String(count);
    });
    $("save").addEventListener("click", () => {
      try { localStorage.setItem("pref", "saved-" + count); } catch (e) {}
    });
    $("boom").addEventListener("click", () => {
      // Deterministic application (target) crash defect.
      throw new Error("IntentionalAppCrash: boom button");
    });
    // Hidden defect: submitting a specific value crashes the handler.
    window.__seedSubmit = (v) => {
      if (v === "CRASH") { throw new Error("HiddenValidationCrash"); }
      return "ok:" + v;
    };
  </script>
</body>
</html>`;

// packages/adapter-web/src/web-adapter.ts
import {
  chromium
} from "playwright";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";
import { mkdirSync as mkdirSync4, mkdtempSync, readFileSync as readFileSync3, rmSync as rmSync3 } from "node:fs";
var WEB_CAPABILITIES = {
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
      "trace"
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
      "wait"
    ],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: []
  }
};
function resolveTargetUrl(raw) {
  if (raw === void 0) return void 0;
  if (typeof raw !== "string" || !raw.trim()) {
    throw protocolError("VALIDATION", "targetUrl must be a non-empty string");
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw protocolError("VALIDATION", `targetUrl is not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw protocolError(
      "VALIDATION",
      `targetUrl must be http or https, got: ${u.protocol}`
    );
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw protocolError(
      "CAPABILITY_DENIED",
      `targetUrl must be a localhost origin for RC1, got: ${u.hostname}`
    );
  }
  return { url: u.toString(), origin: u.origin };
}
function actionTimeout(deadlineMs) {
  const desired = Math.max(1e3, deadlineMs - 1500);
  const ceiling = Math.max(deadlineMs - 250, 0);
  return Math.max(Math.min(desired, ceiling), 50);
}
var WebAdapterHandler = class {
  constructor(faults = {}, artifactBaseDir = join5(tmpdir(), "inspector-web-artifacts"), seedHtml, settleMs = 50, seedRedirectLoop = false, targetUrl) {
    this.faults = faults;
    this.seedHtml = seedHtml;
    this.settleMs = Math.max(0, settleMs);
    this.seedRedirectLoop = seedRedirectLoop;
    if (targetUrl !== void 0) {
      const resolved = resolveTargetUrl(targetUrl);
      this.defaultTargetUrl = resolved?.url;
    }
    mkdirSync4(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join5(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
  }
  browser;
  context;
  page;
  seed;
  artifacts;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  artifactDir;
  settleMs;
  seedRedirectLoop;
  /** Instance-level default external target (constructor option). */
  defaultTargetUrl;
  /** Active external target for the current create; undefined = seeded app. */
  targetUrl;
  /** Exact allowed origin (scheme+host+port) when an external target is set. */
  targetOrigin;
  runId = "run";
  environmentId = "env";
  consoleErrors = [];
  pageErrors = [];
  network = [];
  seq = 0;
  traceIndex = 0;
  async initialize() {
    return WEB_CAPABILITIES;
  }
  async lifecycle(params) {
    switch (params.op) {
      case "create": {
        if (this.browser || this.context || this.page || this.seed) {
          await this.shutdown();
        }
        this.applyAttribution(params.options);
        const rawTarget = params.options?.targetUrl !== void 0 ? params.options.targetUrl : this.defaultTargetUrl;
        const resolved = resolveTargetUrl(rawTarget);
        this.targetUrl = resolved?.url;
        this.targetOrigin = resolved?.origin;
        try {
          if (!resolved) {
            this.seed = startSeedServer({
              html: this.seedHtml,
              redirectLoop: this.seedRedirectLoop
            });
          }
          this.browser = await chromium.launch({ headless: true });
          this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 800 },
            locale: "en-US",
            timezoneId: "UTC"
          });
          this.page = await this.context.newPage();
          this.attachListeners();
          const exactOrigin = this.targetOrigin;
          await this.page.route("**/*", (route) => {
            try {
              const u = new URL(route.request().url());
              if (u.protocol === "http:" && (exactOrigin !== void 0 ? u.origin === exactOrigin : u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
                return route.continue();
              }
            } catch {
            }
            return route.abort();
          });
          await this.context.tracing.start({
            screenshots: true,
            snapshots: true,
            sources: false
          });
          if (resolved) {
            await this.page.goto(resolved.url, { waitUntil: "load" });
          } else {
            await this.seed.ready;
            await this.page.goto(this.seed.url);
          }
          return { ok: true };
        } catch (e) {
          await this.shutdown();
          throw e;
        }
      }
      case "reset": {
        if (this.page && this.targetUrl) {
          let cleared = true;
          await this.context?.clearCookies().catch(() => {
            cleared = false;
          });
          await this.page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          }).catch(() => {
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
          await this.page.evaluate(() => localStorage.clear()).catch(() => {
            cleared = false;
          });
          await this.page.reload({ waitUntil: "load" });
          await this.page.waitForSelector("#loginBtn", { state: "visible", timeout: 5e3 }).catch(() => {
          });
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
  attachListeners() {
    if (!this.page) return;
    this.page.on("console", (msg) => {
      if (msg.type() === "error")
        this.consoleErrors.push({
          text: redactUrlsInText(msg.text()),
          ts: Date.now()
        });
    });
    this.page.on(
      "pageerror",
      (err) => this.pageErrors.push({
        message: redactUrlsInText(err.message),
        stack: err.stack ? redactUrlsInText(err.stack) : void 0
      })
    );
    this.page.on(
      "request",
      (req) => this.network.push({
        type: "request",
        url: redactUrl(req.url()),
        method: req.method()
      })
    );
    this.page.on(
      "response",
      (res) => this.network.push({
        type: "response",
        url: redactUrl(res.url()),
        status: res.status()
      })
    );
  }
  allowedOrigin(target) {
    try {
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      if (this.targetOrigin !== void 0) return u.origin === this.targetOrigin;
      return u.hostname === "127.0.0.1" || u.hostname === "localhost";
    } catch {
      return false;
    }
  }
  async observe(params = {}) {
    if (!this.page) throw new Error("environment not created");
    const page = this.page;
    const want = new Set(params.observe ?? []);
    const url = page.url();
    const title = await page.title();
    const uiTree = await page.evaluate((() => {
      const els = Array.from(
        document.querySelectorAll(
          "a,button,input,select,textarea,[role=button]"
        )
      );
      return els.map((el) => {
        const tag = el.tagName.toLowerCase();
        const isField = tag === "input" || tag === "textarea" || tag === "select";
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
          value: isField && el.type === "password" ? "***" : isField ? el.value : void 0,
          text: isField ? void 0 : textContent
        };
      });
    }));
    const screenshot = want.has("screenshot") ? await page.screenshot() : null;
    const rawStorage = await page.evaluate((() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) o[k] = localStorage.getItem(k) ?? "";
      }
      return o;
    })).catch(() => ({}));
    const storage = redactRecord(rawStorage);
    const artifacts = [];
    if (screenshot) {
      const shotMeta = this.artifacts.write({
        runId: this.runId,
        content: Buffer.from(screenshot),
        mime: "image/png",
        name: "screenshot.png"
      });
      artifacts.push({
        sha256: shotMeta.sha256,
        mime: shotMeta.mime,
        size: shotMeta.size,
        path: shotMeta.path
      });
    }
    const traceMeta = want.has("trace") ? await this.flushTrace() : void 0;
    if (traceMeta) {
      artifacts.push({
        sha256: traceMeta.sha256,
        mime: traceMeta.mime,
        size: traceMeta.size,
        path: traceMeta.path
      });
    }
    const summary = {
      url,
      title,
      uiTree,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
      network: this.network,
      storage
    };
    const obs = {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-web",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      summary,
      artifacts
    };
    this.consoleErrors = [];
    this.pageErrors = [];
    this.network = [];
    return obs;
  }
  async flushTrace() {
    if (!this.context) return void 0;
    const path = join5(this.artifactDir, `trace-${this.traceIndex++}.zip`);
    try {
      await this.context.tracing.stop({ path });
      await this.context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false
      });
    } catch {
      return void 0;
    }
    try {
      const meta = this.artifacts.write({
        runId: this.runId,
        content: readFileSync3(path),
        mime: "application/zip",
        name: "trace.zip"
      });
      rmSync3(path, { force: true });
      return meta;
    } catch {
      return void 0;
    }
  }
  async act(params) {
    const action = params.action;
    if (this.faults.crashBrowser) {
      await this.browser?.close().catch(() => {
      });
      throw new AdapterCrashError(
        "adapter-crash: browser crashed (injected fault)"
      );
    }
    if (!this.page)
      throw protocolError("VALIDATION", "environment not created");
    const page = this.page;
    const sel = String(action.input?.selector ?? action.input?.target ?? "");
    const value = action.input?.value === void 0 ? "" : String(action.input.value);
    const timeout = actionTimeout(action.deadlineMs);
    const errorsBefore = this.pageErrors.length;
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
              `navigation to forbidden origin: ${value}`
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
              `fault not permitted: ${fault}`
            );
          }
          if (fault === "crash") {
            await this.browser?.close().catch(() => {
            });
            throw new AdapterCrashError("adapter-crash: injected fault");
          } else if (fault === "reload") {
            await page.reload({ timeout });
          } else if (fault === "storageReset") {
            await page.evaluate(() => localStorage.clear()).catch(() => {
            });
          }
          break;
        }
        default:
          throw protocolError(
            "VALIDATION",
            `unknown web action: ${action.kind}`
          );
      }
      if (this.pageErrors.length === errorsBefore) {
        await page.waitForTimeout(this.settleMs);
      }
      const lateError = this.pageErrors.slice(errorsBefore).at(-1);
      if (lateError) {
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "target-failure",
          observedAt: (/* @__PURE__ */ new Date()).toISOString(),
          stateAfter: page.url(),
          error: { code: "TARGET_FAILURE", message: lateError.message }
        };
      }
      return {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "success",
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        stateAfter: page.url()
      };
    } catch (e) {
      if (this.faults.crashBrowser)
        throw new AdapterCrashError(
          "adapter-crash: browser crashed (injected fault)"
        );
      if (e instanceof ProtocolError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      const duringAction = this.pageErrors.slice(errorsBefore).at(-1);
      if (duringAction) {
        return {
          actionId: action.id,
          runId: action.runId,
          environmentId: action.environmentId,
          status: "target-failure",
          observedAt: (/* @__PURE__ */ new Date()).toISOString(),
          stateAfter: page.url(),
          error: { code: "TARGET_FAILURE", message: duringAction.message }
        };
      }
      return {
        actionId: action.id,
        runId: action.runId,
        environmentId: action.environmentId,
        status: "target-failure",
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        stateAfter: page.url(),
        error: { code: "ACTION_FAILED", message }
      };
    }
  }
  async health() {
    return { ok: !!this.page, uptimeMs: 0, now: (/* @__PURE__ */ new Date()).toISOString() };
  }
  async cancel() {
  }
  /**
   * Release every resource owned by this instance (tracing, context, browser,
   * seed server). Idempotent; public so entrypoints can shut down gracefully
   * on process signals.
   */
  async shutdown() {
    try {
      if (this.context) await this.context.tracing.stop().catch(() => {
      });
    } catch {
    }
    try {
      await this.context?.close().catch(() => {
      });
    } catch {
    }
    try {
      await this.browser?.close().catch(() => {
      });
    } catch {
    }
    this.seed?.close();
    this.page = void 0;
    this.context = void 0;
    this.browser = void 0;
    this.seed = void 0;
    this.targetUrl = void 0;
    this.targetOrigin = void 0;
  }
  /** Thread real run/environment attribution from lifecycle options. */
  applyAttribution(options) {
    const runId = options?.runId;
    const environmentId = options?.environmentId;
    if (typeof runId === "string" && runId) this.runId = runId;
    if (typeof environmentId === "string" && environmentId) {
      this.environmentId = environmentId;
    }
  }
};

// packages/adapter-web/src/index.ts
var bin2 = resolveAdapterBin(import.meta.url, "inspector-adapter-web.js", "bin");

// packages/explore/src/web-replay.ts
var WebReplayDriver = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  async replay(actions) {
    const base = this.opts.artifactBaseDir ?? join6(tmpdir2(), `inspector-web-replay-${process.pid}`);
    const handler = new WebAdapterHandler({}, base, this.opts.seedHtml);
    const outcomes = [];
    const signals = [];
    try {
      await handler.lifecycle(
        this.opts.targetUrl !== void 0 ? { op: "create", options: { targetUrl: this.opts.targetUrl } } : { op: "create" }
      );
      for (const a of actions) {
        const outcome = await handler.act({ action: a });
        outcomes.push(outcome);
        if (outcome.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE") {
          signals.push({ kind: "PAGE_ERROR", detail: outcome.error?.message });
        }
      }
    } finally {
      await handler.lifecycle({ op: "close" }).catch(() => {
      });
    }
    return { outcomes, signals, observations: [] };
  }
};

// packages/explore/src/campaign.ts
var DEFAULT_OBSERVE = ["url", "uiTree", "storage", "pageErrors", "title"];
var ExploreController = class {
  rng;
  graph = new StateGraph();
  config;
  run;
  caps;
  faults;
  detector;
  planner;
  sequenceLengths;
  anomalies = [];
  anomalyClassKeys = /* @__PURE__ */ new Set();
  /** Action keys whose execution lost the environment (deadline/crash). */
  toxicActionKeys = /* @__PURE__ */ new Set();
  /** Action keys the policy refused; they never executed and must not retry. */
  rejectedActionKeys = /* @__PURE__ */ new Set();
  /** Degradation notices recorded verbatim for the run result. */
  warnings = [];
  actionPath = [];
  recentActionKeys = [];
  actionsExecuted = 0;
  actionsSinceNewState = 0;
  resets = 0;
  consecutiveObserveFailures = 0;
  startMs = 0;
  lastObs = null;
  currentState = "";
  currentScreen = "";
  findingEngine;
  replayDriverFactory;
  store;
  constructor(deps) {
    this.run = deps.run;
    this.config = deps.config;
    this.caps = deps.caps ?? deps.run.caps;
    this.rng = mulberry32(deps.config.seed >>> 0);
    this.faults = new FaultController(this.caps, {
      enableFaultInjection: !!deps.config.enableFaultInjection,
      disposable: deps.config.disposable ?? false
    });
    this.detector = new DefaultAnomalyDetector();
    this.planner = new NoopPlanner();
    this.sequenceLengths = deps.config.sequenceLengths ?? DEFAULT_SEQUENCE_LENGTHS;
    this.findingEngine = deps.findingEngine;
    this.replayDriverFactory = deps.replayDriverFactory;
    this.store = deps.store;
  }
  get plateauWindow() {
    return this.config.plateauWindow ?? 12;
  }
  get noveltyPlateauLimit() {
    return this.config.noveltyPlateauLimit ?? 40;
  }
  get observeFailureLimit() {
    return this.config.observeFailureLimit ?? 3;
  }
  makeAction(c) {
    const isFault = c.kind === "fault";
    const input = isFault ? { fault: c.fault } : c.selector ? { selector: c.selector, value: c.value } : c.value === void 0 ? {} : { value: c.value };
    return {
      id: newId("act"),
      runId: this.run.runId,
      environmentId: this.run.environmentId,
      kind: c.kind,
      risk: c.risk,
      deadlineMs: 6e3,
      idempotency: c.risk === "mutate-test-state" ? "never-retry" : "observe-before-retry",
      target: c.selector ? { selector: c.selector } : null,
      input,
      metadata: {
        actionKey: c.actionKey,
        sourceElementId: c.sourceElementId ?? null,
        isBoundary: !!c.isBoundary
      }
    };
  }
  async run_() {
    this.startMs = Date.now();
    return this.loop();
  }
  async loop() {
    const actionKindSequence = [];
    const first = await this.observeSafe();
    if (!first) {
      return this.finish(actionKindSequence, "initial-observe-failed");
    }
    this.lastObs = first;
    this.currentState = stateFingerprint(first);
    this.currentScreen = screenFingerprint(first);
    this.graph.visitState(this.currentState, this.currentScreen, 0);
    let obs = this.lastObs;
    while (this.actionsExecuted < this.config.maxActions) {
      if (this.config.maxWallMs && Date.now() - this.startMs > this.config.maxWallMs) {
        return this.finish(actionKindSequence, "wall-budget");
      }
      if (this.config.maxFindings && this.anomalies.length >= this.config.maxFindings) {
        return this.finish(actionKindSequence, "finding-cap");
      }
      const uiTree = uiTreeOf(obs);
      const inventory = buildInventory(uiTree, this.caps, {
        allowFaults: this.faults.allowed
      });
      const candidates = this.expandCandidates(inventory);
      const chosen = this.select(candidates);
      if (!chosen) {
        if (this.canReset() && await this.doReset()) {
          obs = this.lastObs;
          continue;
        }
        return this.finish(actionKindSequence, "no-candidates");
      }
      const executed = await this.step(chosen);
      this.actionsExecuted += executed.count;
      for (const k of executed.kinds) actionKindSequence.push(k);
      obs = this.lastObs;
      if (executed.stopReason === "adapter-error") {
        if (this.canReset()) {
          if (!await this.doReset()) {
            return this.finish(actionKindSequence, "reset-failed");
          }
          continue;
        }
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (executed.stopReason) {
        return this.finish(actionKindSequence, executed.stopReason);
      }
      if (this.consecutiveObserveFailures >= this.observeFailureLimit) {
        return this.finish(actionKindSequence, "observer-degraded");
      }
      if (this.config.maxFindings && this.anomalies.length >= this.config.maxFindings) {
        return this.finish(actionKindSequence, "finding-cap");
      }
      if (executed.crashed && this.canReset()) {
        if (!await this.doReset()) {
          return this.finish(actionKindSequence, "reset-failed");
        }
        obs = this.lastObs;
        continue;
      }
      if (this.actionsSinceNewState > this.noveltyPlateauLimit && this.canReset()) {
        if (!await this.doReset()) {
          return this.finish(actionKindSequence, "reset-failed");
        }
        obs = this.lastObs;
        this.actionsSinceNewState = 0;
      }
    }
    return this.finish(actionKindSequence, "action-budget");
  }
  expandCandidates(inventory) {
    const out = inventory.slice();
    const clickables = inventory.filter(
      (c) => c.kind === "click" && c.sourceElementId
    );
    for (const b of clickables) {
      for (const len of this.sequenceLengths) {
        out.push({
          ...b,
          id: `${b.id}_seq${len}`,
          actionKey: `seq:${b.actionKey}:${len}`,
          repeat: len,
          priority: (b.priority ?? 5) + 1
        });
      }
    }
    return out;
  }
  select(candidates) {
    if (candidates.length === 0) return null;
    const usable = candidates.filter((c) => !this.isBlocked(c.actionKey));
    if (usable.length === 0) return null;
    const ctx = {
      graph: this.graph,
      currentState: this.currentState,
      currentScreen: this.currentScreen,
      recentActionKeys: this.recentActionKeys,
      totalActions: this.actionsExecuted,
      weights: this.config.weights
    };
    const scored = usable.map((c) => ({ c, s: scoreAction(c, ctx) }));
    let best = -Infinity;
    for (const x of scored) if (x.s > best) best = x.s;
    const top = scored.filter((x) => x.s >= best - 1e-9).map((x) => x.c);
    if (top.length === 0 || top.length === 1 && this.recentActionKeys.filter((k) => k === top[0].actionKey).length >= 3) {
      const planned = this.planner.propose(this.plannerCtx());
      if (planned) return planned;
    }
    return this.rng.pick(top);
  }
  /**
   * A key is blocked when it was blacklisted as toxic (directly or via its
   * sequence family) or when the policy already rejected it.
   */
  isBlocked(actionKey) {
    if (this.toxicActionKeys.has(actionKey)) return true;
    if (this.rejectedActionKeys.has(actionKey)) return true;
    const base = baseActionKey(actionKey);
    return base !== actionKey && this.toxicActionKeys.has(base);
  }
  plannerCtx() {
    return {
      screen: this.currentScreen,
      uiTree: this.lastObs ? uiTreeOf(this.lastObs) : [],
      recentActionKeys: this.recentActionKeys,
      discoveredKinds: this.anomalies.map((a) => a.kind)
    };
  }
  async step(chosen) {
    const repeats = chosen.repeat ?? 1;
    const kinds = [];
    let crashed = false;
    let stopReason;
    for (let i = 0; i < repeats; i++) {
      const remaining = this.config.maxActions - this.actionsExecuted - kinds.length;
      if (remaining <= 0) {
        stopReason = "action-budget";
        break;
      }
      if (this.config.maxWallMs && Date.now() - this.startMs > this.config.maxWallMs) {
        stopReason = "wall-budget";
        break;
      }
      const action = this.makeAction({ ...chosen, id: `c_${newId("act")}` });
      const before = this.lastObs;
      const submit = await this.run.submitAction(action);
      if (submit.kind === "rejected") {
        this.rejectedActionKeys.add(chosen.actionKey);
        break;
      }
      if (submit.kind === "duplicate") {
        this.warnings.push(
          `duplicate submission for ${action.id}; outcome unresolved, skipping`
        );
        break;
      }
      kinds.push(chosen.kind);
      this.recentActionKeys.push(chosen.actionKey);
      if (this.recentActionKeys.length > this.plateauWindow)
        this.recentActionKeys.shift();
      this.actionPath.push(action);
      if (submit.kind === "adapter-error") {
        this.toxicActionKeys.add(chosen.actionKey);
        const base = baseActionKey(chosen.actionKey);
        if (base !== chosen.actionKey) this.toxicActionKeys.add(base);
        crashed = true;
        stopReason = "adapter-error";
        break;
      }
      const outcome = submit.outcome;
      const after = await this.observeSafe();
      const stateBefore = this.currentState;
      const anomaly = this.detector.detect({
        action,
        outcome,
        before,
        after,
        actionPath: this.actionPath,
        stateBefore
      });
      if (anomaly && !this.anomalyClassKeys.has(anomaly.classKey)) {
        this.anomalyClassKeys.add(anomaly.classKey);
        this.anomalies.push(anomaly);
      }
      let isNew = false;
      if (after) {
        const sa = stateFingerprint(after);
        const sc = screenFingerprint(after);
        isNew = this.graph.visitState(sa, sc, this.actionsExecuted);
        this.graph.recordEdge(
          stateBefore,
          chosen.actionKey,
          sa,
          this.actionsExecuted
        );
        this.currentState = sa;
        this.currentScreen = sc;
        this.lastObs = after;
      } else {
        this.lastObs = before;
      }
      if (isNew) this.actionsSinceNewState = 0;
      else this.actionsSinceNewState += 1;
      if (outcome?.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE") {
        crashed = true;
        break;
      }
      if (outcome && outcome.status !== "success") {
        break;
      }
    }
    return { count: kinds.length, kinds, crashed, stopReason };
  }
  actionsExecutedLocal() {
  }
  canReset() {
    if (!this.config.maxResets) return false;
    return this.resets < this.config.maxResets;
  }
  async doReset() {
    this.resets += 1;
    try {
      await this.run.reset();
    } catch (e) {
      this.warnings.push(`reset failed: ${errorMessage(e)}`);
      return false;
    }
    this.actionPath = [];
    const obs = await this.observeSafe();
    if (!obs) return false;
    this.lastObs = obs;
    this.currentState = stateFingerprint(obs);
    this.currentScreen = screenFingerprint(obs);
    this.graph.visitState(
      this.currentState,
      this.currentScreen,
      this.actionsExecuted
    );
    this.recentActionKeys = [];
    this.actionsSinceNewState = 0;
    return true;
  }
  async observe() {
    const fields = this.config.observeFields ?? DEFAULT_OBSERVE;
    return this.run.observe(fields);
  }
  async observeSafe() {
    try {
      const obs = await this.observe();
      this.consecutiveObserveFailures = 0;
      return obs;
    } catch (e) {
      this.consecutiveObserveFailures += 1;
      this.warnings.push(
        `observe failed (${this.consecutiveObserveFailures}/${this.observeFailureLimit}): ${errorMessage(e)}`
      );
      return null;
    }
  }
  async finish(actionKindSequence, stoppedReason) {
    const base = {
      runId: this.run.runId,
      seed: this.config.seed,
      actionsExecuted: this.actionsExecuted,
      statesVisited: this.graph.stateCount,
      transitions: this.graph.edges.size,
      resets: this.resets,
      anomalies: this.anomalies.slice(),
      findings: [],
      evidenceBundles: [],
      regressionScenarios: [],
      findingOutcomes: [],
      warnings: [],
      actionKindSequence,
      stoppedReason
    };
    if (this.config.skipReproduction || !this.findingEngine || !this.resolveReplayDriverFactory()) {
      base.warnings = this.warnings.slice();
      return base;
    }
    const cap = this.config.maxFindings;
    for (const a of this.anomalies) {
      if (cap !== void 0 && base.findings.length >= cap) {
        base.findingOutcomes.push({
          anomalyKey: a.key,
          classKey: a.classKey,
          outcome: "skipped-finding-cap"
        });
        continue;
      }
      try {
        await this.processAnomaly(a, base);
      } catch (e) {
        const detail = errorMessage(e);
        this.warnings.push(`reproduction failed for ${a.classKey}: ${detail}`);
        base.findingOutcomes.push({
          anomalyKey: a.key,
          classKey: a.classKey,
          outcome: "error",
          detail
        });
      }
    }
    if (stoppedReason === "finding-cap" && cap !== void 0 && base.findings.length < cap) {
      this.warnings.push(
        `finding-cap shortfall: ${base.findings.length} of ${cap} requested findings confirmed`
      );
    }
    base.warnings = this.warnings.slice();
    return base;
  }
  /**
   * Reproduction driver source: the injected factory when present, otherwise
   * a default WebReplayDriver pointed at the explored external target. A
   * custom factory must forward `config.targetUrl` itself.
   */
  resolveReplayDriverFactory() {
    if (this.replayDriverFactory) return this.replayDriverFactory;
    if (this.config.targetUrl !== void 0) {
      return () => new WebReplayDriver({ targetUrl: this.config.targetUrl });
    }
    return void 0;
  }
  /**
   * Reproduce, minimize, and export one anomaly. Throws propagate to the
   * caller's per-anomaly containment; every durable state change is persisted
   * incrementally through the injected store as soon as it exists.
   */
  async processAnomaly(a, base) {
    const engine = this.findingEngine;
    const driver = this.resolveReplayDriverFactory()();
    const signal = {
      kind: a.kind,
      detail: a.message
    };
    const finding = engine.ingest(signal, {
      runId: this.run.runId,
      title: a.message,
      adapter: this.caps.adapter
    });
    this.persistFinding(finding);
    const rep = await engine.reproduce(finding, a.actionPath, driver, {
      attempts: this.config.reproducibleAttempts ?? 2,
      minSuccesses: this.config.reproducibleMinSuccesses ?? 1
    });
    this.persistFinding(rep.finding);
    const signals = mergeSignals(rep.lastSignals, [signal]);
    const artifactRefs = a.outcome?.artifactRefs ?? [];
    const record = (outcome, detail) => {
      const entry = {
        anomalyKey: a.key,
        classKey: a.classKey,
        outcome,
        findingId: finding.id
      };
      if (detail !== void 0) entry.detail = detail;
      base.findingOutcomes.push(entry);
    };
    if (rep.finding.status === "REJECTED") {
      record(
        "rejected",
        rep.stats.lastError ?? `reproduction policy not satisfied (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`
      );
      return;
    }
    if (rep.finding.status === "FLAKY") {
      record(
        "flaky",
        `reproduction flaky (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`
      );
      return;
    }
    const minimized = await engine.minimize(rep.finding, a.actionPath, driver);
    this.persistFinding(rep.finding);
    let confirmed = rep.finding;
    if (rep.finding.status === "MINIMIZED") {
      if (rep.finding.minimization?.verifiedReproduction === true) {
        confirmed = engine.transition(rep.finding, "CONFIRMED", {
          reason: "minimization verified reproduction"
        });
        this.persistFinding(confirmed);
        record("confirmed");
      } else {
        confirmed = engine.transition(rep.finding, "REJECTED", {
          reason: "minimization did not verify reproduction"
        });
        this.persistFinding(confirmed);
        record("rejected", "minimization did not verify reproduction");
        return;
      }
    } else {
      record(
        "confirmed-unverified-minimization",
        "minimize() baseline verification failed; confirmed by reproduction policy only"
      );
    }
    const bundle = engine.buildBundle(confirmed, a.actionPath, minimized, {
      signals,
      artifactRefs,
      replayCommand: `inspector replay --finding ${confirmed.id}`
    });
    base.findings.push(confirmed);
    base.evidenceBundles.push(bundle);
    base.regressionScenarios.push(
      engine.exportRegression(confirmed, minimized, signal.kind, {
        adapter: this.caps.adapter
      })
    );
  }
  /** Incremental honest persistence of a finding through the injected store. */
  persistFinding(f) {
    if (!this.store) return;
    const record = {
      id: f.id,
      runId: f.runId,
      status: f.status,
      title: f.title,
      confidence: f.confidence,
      severity: f.severity,
      revision: f.revision,
      oracleIds: JSON.stringify(f.oracleIds),
      reproductionJson: f.reproduction ? JSON.stringify(f.reproduction) : null,
      artifactRefs: JSON.stringify(f.artifactRefs),
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      signature: f.signature ?? null,
      minimizationJson: f.minimization ? JSON.stringify(f.minimization) : null,
      lastTransitionJson: f.lastTransition ? JSON.stringify(f.lastTransition) : null,
      adapter: f.adapter ?? null
    };
    try {
      this.store.putFinding(record);
    } catch (e) {
      this.warnings.push(`putFinding failed for ${f.id}: ${errorMessage(e)}`);
    }
  }
};
function baseActionKey(actionKey) {
  const m = /^seq:(.*):\d+$/.exec(actionKey);
  return m ? m[1] : actionKey;
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function signalKey(s) {
  const detail = typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail) ?? "";
  return `${s.kind}|${detail}`;
}
function mergeSignals(primary, extra) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of [...primary, ...extra]) {
    const k = signalKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// packages/cli/src/workspace.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join7 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import { dirname as dirname6 } from "node:path";
var here3 = dirname6(fileURLToPath4(import.meta.url));
var repoTsconfig = join7(here3, "..", "..", "..", "tsconfig.json");
function adapterBin(name) {
  return name === "web" ? resolveAdapterBin(import.meta.url, "inspector-adapter-web.js", "..", "..", "adapter-web", "src", "bin") : resolveAdapterBin(import.meta.url, "inspector-adapter-fake.js", "..", "..", "adapter-fake", "src", "bin");
}
function workspaceDirFrom(cwd) {
  return join7(cwd, ".inspector");
}
function isRepoRoot(dir) {
  return existsSync3(join7(dir, "package.json")) && existsSync3(join7(dir, "packages")) && existsSync3(join7(dir, ".inspector", "state", "campaign.yaml"));
}
var REPO_ROOT_WARNING = "warning: using repository-root workspace; pass --workspace <dir> to isolate runs";
var SHARED_DB_PATTERN = /SQLITE_CONSTRAINT|UNIQUE constraint|database is locked|database table is locked/i;
function remapWorkspaceConflict(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!SHARED_DB_PATTERN.test(message)) return error;
  return new CliError(
    "workspace-conflict",
    `workspace database is locked by another concurrent run or shared; pass --workspace <dir> to isolate (underlying error: ${message})`
  );
}
function openWorkspace(cwd) {
  const base = workspaceDirFrom(cwd);
  const store = Store.open(join7(base, "runs.db"));
  const artifacts = new ArtifactStore(join7(base, "artifacts"));
  return { store, artifacts, base };
}
function adapterSpawn(name, extraEnv = {}) {
  const bin3 = adapterBin(name === "web" ? "web" : "fake");
  return {
    adapterCommand: bin3.command,
    adapterArgs: bin3.args,
    adapterEnv: {
      ...process.env,
      ...existsSync3(repoTsconfig) ? { TSX_TSCONFIG_PATH: repoTsconfig } : {},
      ...extraEnv
    }
  };
}

// packages/cli/src/hunt.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var ORACLE_SIGNAL_KINDS = [
  "TARGET_FAILURE",
  "PAGE_ERROR",
  "DEFECT_SUBMIT_INVALID",
  "IMPOSSIBLE_STATE",
  "ADAPTER_CRASH"
];
function parseHuntRequest(parsed) {
  const adapterRaw = parsed.flags["--adapter"];
  const adapter = adapterRaw === void 0 ? "web" : adapterRaw;
  if (adapter !== "web" && adapter !== "fake") {
    throw new CliError("invalid-value", `--adapter expects 'web' or 'fake', got '${adapter}'`);
  }
  const urlRaw = parsed.flags["--url"];
  if (urlRaw !== void 0 && adapter !== "web") {
    throw new CliError("invalid-value", "--url is only valid with --adapter web");
  }
  return {
    adapter,
    targetUrl: urlRaw === void 0 || typeof urlRaw !== "string" ? void 0 : validateTargetUrl(urlRaw),
    seed: intFlag(parsed.flags, "--seed", 7),
    maxActions: intFlag(parsed.flags, "--max-actions", 200),
    maxMinutes: intFlag(parsed.flags, "--max-minutes", 10),
    maxFindings: intFlag(parsed.flags, "--max-findings", 4)
  };
}
function validateTargetUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new CliError("invalid-value", `--url is not a valid URL: '${raw}'`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new CliError("invalid-value", `--url must be http or https, got '${u.protocol}'`);
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new CliError(
      "invalid-value",
      `--url must be a localhost origin for RC1 hunts, got hostname '${u.hostname}'`
    );
  }
  return u.toString();
}
function huntPolicy(req) {
  const base = DEFAULT_POLICY;
  return {
    ...base,
    budgets: {
      ...base.budgets,
      max_actions: Math.max(base.budgets.max_actions, req.maxActions + 50),
      wall_clock_minutes: Math.max(base.budgets.wall_clock_minutes, req.maxMinutes + 2),
      max_environment_resets: Math.max(base.budgets.max_environment_resets, 60)
    }
  };
}
function writeEvidenceBundles(base, runId, bundles) {
  const dir = join8(base, "bundles", runId);
  mkdirSync5(dir, { recursive: true });
  const paths = /* @__PURE__ */ new Map();
  for (const bundle of bundles) {
    const path = join8(dir, `${bundle.finding.id}.json`);
    writeFileSync3(path, JSON.stringify(bundle, null, 2));
    paths.set(bundle.finding.id, path);
  }
  return paths;
}
async function closeRunGuarded(run2, warn) {
  const CLOSE_BUDGET_MS = 15e3;
  let finished = false;
  await Promise.race([
    run2.close().then(() => {
      finished = true;
    }),
    sleep2(CLOSE_BUDGET_MS)
  ]);
  if (!finished) {
    warn(
      `teardown: run.close() exceeded ${CLOSE_BUDGET_MS / 1e3}s; continuing teardown (the adapter subprocess may need manual cleanup)`
    );
  }
}
function mergeSignals2(primary, extra) {
  const key = (s) => `${s.kind}|${typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail) ?? ""}`;
  const out = primary.slice();
  for (const s of extra) {
    if (!out.some((o) => key(o) === key(s))) out.push(s);
  }
  return out;
}
async function runWebHunt(run2, store, req, base, progress) {
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
  let actions = 0;
  const originalSubmit = run2.submitAction.bind(run2);
  run2.submitAction = async (action) => {
    const result2 = await originalSubmit(action);
    actions += 1;
    if (actions % 25 === 0) progress(`... ${actions} actions executed`);
    return result2;
  };
  const originalIngest = findingEngine.ingest.bind(findingEngine);
  findingEngine.ingest = (signal, opts) => {
    progress(`candidate defect detected (${signal.kind})`);
    return originalIngest(signal, opts);
  };
  const controller = new ExploreController({
    run: run2,
    store,
    findingEngine,
    config: {
      seed: req.seed,
      maxActions: req.maxActions,
      maxWallMs: req.maxMinutes * 6e4,
      maxFindings: req.maxFindings,
      // Proven campaign defaults: without reset budget a single lost
      // environment would end an otherwise healthy hunt.
      maxResets: 40,
      noveltyPlateauLimit: 50,
      reproducibleAttempts: 2,
      reproducibleMinSuccesses: 1,
      enableFaultInjection: false,
      observeFields: ["url", "title", "uiTree", "storage", "pageErrors", "screenshot"],
      // Reproduction must hit the same external app the anomaly came from;
      // otherwise real-target findings replay against the seeded app and
      // honestly come out REJECTED/FLAKY.
      targetUrl: req.targetUrl
    },
    replayDriverFactory: () => new WebReplayDriver({ artifactBaseDir: join8(base, "replay"), targetUrl: req.targetUrl })
  });
  const result = await controller.run_();
  return {
    runId: result.runId,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: result.resets,
    anomalyCount: result.anomalies.length,
    findings: result.findings,
    evidenceBundles: result.evidenceBundles,
    findingOutcomes: result.findingOutcomes.map((o) => ({
      classKey: o.classKey,
      outcome: o.outcome,
      ...o.detail !== void 0 ? { detail: o.detail } : {},
      ...o.findingId !== void 0 ? { findingId: o.findingId } : {}
    })),
    warnings: result.warnings
  };
}
var FAKE_FILL_VALUES = ["ok", "ok", "", "x".repeat(80), "<script>", "BAD"];
function fakeAction(run2, kind, input) {
  return {
    id: newId("act"),
    runId: run2.runId,
    environmentId: run2.environmentId,
    kind,
    risk: "interact",
    deadlineMs: 5e3,
    idempotency: "safe-retry",
    ...input !== void 0 ? { input } : {}
  };
}
function nextFakeAction(rng, state, pendingFillIsBoundary) {
  switch (state) {
    case "form":
      if (pendingFillIsBoundary) return { kind: "submit" };
      return rng.pick(["submit", "fillField", "fillField"]) === "submit" ? { kind: "submit" } : { kind: "fillField", input: { name: "default", value: rng.pick(FAKE_FILL_VALUES) } };
    case "done":
      return rng.pick([{ kind: "goHome" }, { kind: "toggleFlag" }]);
    case "error":
      return rng.pick([{ kind: "retry" }, { kind: "goHome" }]);
    case "home":
    default:
      return rng.pick([
        { kind: "openForm" },
        { kind: "toggleFlag" },
        { kind: "goHome" }
      ]);
  }
}
async function runFakeHunt(run2, store, req, progress) {
  const engine = new FindingEngine(OracleEngine.defaults(), store);
  const sinks = {
    findings: [],
    bundles: [],
    outcomes: [],
    seenClassKeys: /* @__PURE__ */ new Set(),
    warnings: []
  };
  const rng = mulberry32(req.seed >>> 0);
  const statesSeen = /* @__PURE__ */ new Set(["home"]);
  const segment = [];
  let state = "home";
  let pendingFillIsBoundary = false;
  let actionsExecuted = 0;
  let consecutiveRejections = 0;
  let stoppedReason = "action-budget";
  const startMs = Date.now();
  const maxWallMs = req.maxMinutes * 6e4;
  while (true) {
    if (actionsExecuted >= req.maxActions) {
      stoppedReason = "action-budget";
      break;
    }
    if (Date.now() - startMs > maxWallMs) {
      stoppedReason = "wall-budget";
      break;
    }
    if (req.maxFindings > 0 && sinks.findings.length >= req.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }
    const choice = nextFakeAction(rng, state, pendingFillIsBoundary);
    const action = fakeAction(run2, choice.kind, choice.input);
    const submit = await run2.submitAction(action);
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${choice.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${choice.kind}: ${submit.decision.reason ?? "unknown reason"}`
      );
      consecutiveRejections += 1;
      if (consecutiveRejections >= 10) {
        stoppedReason = "no-candidates";
        break;
      }
      continue;
    }
    if (submit.kind === "duplicate") {
      sinks.warnings.push(`duplicate submission for ${action.id}; outcome unresolved, skipping`);
      continue;
    }
    consecutiveRejections = 0;
    actionsExecuted += 1;
    segment.push(action);
    if (actionsExecuted % 25 === 0) progress(`... ${actionsExecuted} actions executed`);
    if (choice.kind === "fillField") {
      pendingFillIsBoundary = choice.input?.value === "BAD";
    } else if (choice.kind === "submit" || choice.kind === "goHome") {
      pendingFillIsBoundary = false;
    }
    const outcome = submit.outcome;
    const failed = outcome.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE";
    if (failed) {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
      try {
        await processFakeFailure(engine, run2, outcome, segment.slice(), req, sinks, progress);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        sinks.warnings.push(`finding pipeline failed: ${detail}`);
        sinks.outcomes.push({
          classKey: `TARGET_FAILURE|${outcome.error?.message ?? ""}`,
          outcome: "error",
          detail
        });
      }
    } else {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
    }
    if (state === "home") segment.length = 0;
  }
  return {
    runId: run2.runId,
    seed: req.seed,
    stoppedReason,
    actionsExecuted,
    statesVisited: statesSeen.size,
    resets: 0,
    anomalyCount: sinks.seenClassKeys.size,
    findings: sinks.findings,
    evidenceBundles: sinks.bundles,
    findingOutcomes: sinks.outcomes,
    warnings: sinks.warnings
  };
}
async function processFakeFailure(engine, run2, outcome, path, req, sinks, progress) {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (sinks.seenClassKeys.has(classKey)) return;
  sinks.seenClassKeys.add(classKey);
  if (req.maxFindings > 0 && sinks.findings.length >= req.maxFindings) {
    sinks.outcomes.push({ classKey, outcome: "skipped-finding-cap" });
    return;
  }
  const signalKind = ORACLE_SIGNAL_KINDS.includes(message) ? message : "TARGET_FAILURE";
  const signal = { kind: signalKind, detail: outcome.error?.detail ?? message };
  progress(`candidate defect detected (${signalKind})`);
  const finding = engine.ingest(signal, {
    runId: run2.runId,
    title: message === signalKind ? `${signalKind} from deterministic oracle` : `${signalKind}: ${message}`,
    adapter: run2.caps.adapter
  });
  const makeDriver = () => new FakeStateMachineDriver();
  const rep = await engine.reproduce(finding, path, makeDriver(), {
    attempts: 2,
    minSuccesses: 1
  });
  const record = (name, detail) => {
    const entry = { classKey, outcome: name, findingId: finding.id };
    if (detail !== void 0) entry.detail = detail;
    sinks.outcomes.push(entry);
  };
  if (rep.finding.status === "REJECTED") {
    record("rejected", rep.stats.lastError ?? "reproduction policy not satisfied");
    return;
  }
  if (rep.finding.status === "FLAKY") {
    record(
      "flaky",
      `reproduction flaky (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`
    );
    return;
  }
  const minimized = await engine.minimize(rep.finding, path, makeDriver());
  let confirmed = rep.finding;
  if (rep.finding.status === "MINIMIZED") {
    if (rep.finding.minimization?.verifiedReproduction === true) {
      confirmed = engine.transition(rep.finding, "CONFIRMED", {
        reason: "minimization verified reproduction"
      });
      record("confirmed");
    } else {
      confirmed = engine.transition(rep.finding, "REJECTED", {
        reason: "minimization did not verify reproduction"
      });
      record("rejected", "minimization did not verify reproduction");
      return;
    }
  } else {
    record(
      "confirmed-unverified-minimization",
      "minimize() baseline verification failed; confirmed by reproduction policy only"
    );
  }
  const bundle = engine.buildBundle(confirmed, path, minimized, {
    signals: mergeSignals2(rep.lastSignals, [signal]),
    replayCommand: `inspector replay --finding ${confirmed.id}`
  });
  sinks.findings.push(confirmed);
  sinks.bundles.push(bundle);
}
function workDirOf(ctx, parsed) {
  return parsed.workspace ?? ctx.workspaceArg ?? process.env.INSPECTOR_WORKSPACE ?? ctx.baseCwd;
}
function warnRepoRootWorkspace(ctx, dir) {
  if (!isRepoRoot(dir)) return null;
  if (!ctx.json) ctx.progress(REPO_ROOT_WARNING);
  return REPO_ROOT_WARNING;
}
async function huntCommand(parsed, ctx) {
  const req = parseHuntRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let workspace;
  try {
    workspace = openWorkspace(dir);
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  const { store, artifacts, base } = workspace;
  let run2 = null;
  try {
    const mgr = new RunManager(store, artifacts, new PolicyEngine(huntPolicy(req)));
    const spawnSpec = req.adapter === "web" && req.targetUrl !== void 0 ? adapterSpawn("web", { WEB_TARGET_URL: req.targetUrl }) : adapterSpawn(req.adapter);
    try {
      run2 = await mgr.startRun(spawnSpec);
    } catch (e) {
      throw remapWorkspaceConflict(e);
    }
    const result = req.adapter === "web" ? await runWebHunt(run2, store, req, base, ctx.progress) : await runFakeHunt(run2, store, req, ctx.progress);
    const bundlePaths = writeEvidenceBundles(base, result.runId, result.evidenceBundles);
    const errorOutcomes = result.findingOutcomes.filter((o) => o.outcome === "error");
    const badStop = result.stoppedReason === "adapter-error" || result.stoppedReason === "initial-observe-failed";
    const code = badStop || errorOutcomes.length > 0 ? 1 : 0;
    const summary = {
      ok: code === 0,
      ...warning !== null ? { warning } : {},
      runId: result.runId,
      adapter: req.adapter,
      seed: result.seed,
      stoppedReason: result.stoppedReason,
      actionsExecuted: result.actionsExecuted,
      statesVisited: result.statesVisited,
      resets: result.resets,
      anomalies: result.anomalyCount,
      findings: result.findings.map((f) => ({
        id: f.id,
        signature: f.signature ?? null,
        status: f.status,
        severity: f.severity,
        confidence: f.confidence
      })),
      bundles: [...bundlePaths.entries()].map(([findingId, path]) => ({ findingId, path })),
      warnings: result.warnings
    };
    if (ctx.json) {
      ctx.out(JSON.stringify(summary, null, 2));
    } else {
      ctx.out(`hunt complete: ${result.runId}`);
      ctx.out(
        `  stopped: ${result.stoppedReason} | actions: ${result.actionsExecuted} | states: ${result.statesVisited} | resets: ${result.resets} | anomalies: ${result.anomalyCount}`
      );
      if (result.findings.length === 0) {
        ctx.out("  findings: none");
      } else {
        ctx.out(`  findings: ${result.findings.length}`);
        for (const f of result.findings) {
          ctx.out(
            `    ${f.id}  ${f.signature ?? "-"}  ${f.status}  ${f.severity}  ${f.confidence.toFixed(2)}`
          );
          const p = bundlePaths.get(f.id);
          if (p) ctx.out(`      evidence: ${p}`);
        }
      }
      if (result.warnings.length > 0) {
        ctx.out(`  warnings: ${result.warnings.length}`);
        for (const w of result.warnings) ctx.out(`    - ${w}`);
      }
      if (code !== 0) {
        ctx.out(
          badStop ? `hunt failed: exploration stopped with '${result.stoppedReason}'` : `hunt finished with ${errorOutcomes.length} error-level finding outcome(s)`
        );
      }
    }
    return { code, data: summary };
  } finally {
    if (run2) await closeRunGuarded(run2, ctx.progress);
    store.close();
  }
}

// packages/cli/src/findings.ts
import { existsSync as existsSync4 } from "node:fs";
import { join as join9 } from "node:path";
function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function bundlePathFor(base, rec) {
  if (!rec.runId) return null;
  return join9(base, "bundles", rec.runId, `${rec.id}.json`);
}
function findingView(rec, base) {
  const refs = safeParse(rec.artifactRefs);
  const artifactRefCount = Array.isArray(refs) ? refs.length : 0;
  const bundlePath = bundlePathFor(base, rec);
  return {
    id: rec.id,
    runId: rec.runId,
    status: rec.status,
    title: rec.title,
    signature: rec.signature,
    severity: rec.severity,
    confidence: rec.confidence,
    adapter: rec.adapter,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    artifactRefCount,
    evidenceBundlePath: bundlePath !== null && existsSync4(bundlePath) ? bundlePath : null
  };
}
function fmtConfidence(c) {
  return Number.isFinite(c) ? c.toFixed(2) : String(c);
}
async function findingsCommand(parentRest, ctx) {
  const sub = parentRest[0];
  if (sub === void 0 || sub === "list") {
    const rest = sub === void 0 ? parentRest : parentRest.slice(1);
    const parsed = parseArgs(rest, ["--run", "--limit"], []);
    const limit = intFlag(parsed.flags, "--limit", 100);
    const runFilter = typeof parsed.flags["--run"] === "string" ? parsed.flags["--run"] : void 0;
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store, base } = openWorkspace(dir);
    try {
      let records = store.listFindings(limit);
      if (runFilter !== void 0) records = records.filter((r) => r.runId === runFilter);
      const views = records.map((r) => findingView(r, base));
      if (ctx.json) {
        ctx.out(JSON.stringify(views, null, 2));
      } else if (views.length === 0) {
        ctx.out(runFilter === void 0 ? "no findings recorded" : `no findings recorded for run ${runFilter}`);
      } else {
        for (const v of views) {
          ctx.out(
            `${v.id}  ${v.status}  ${v.severity ?? "-"}  conf=${fmtConfidence(v.confidence)}  ${v.signature ?? "-"}  ${v.updatedAt}`
          );
        }
      }
      return { code: 0, data: views };
    } finally {
      store.close();
    }
  }
  if (sub === "show") {
    const parsed = parseArgs(parentRest.slice(1), [], []);
    const id = requirePositional(parsed.positionals, 0, "inspector findings show <id>");
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store, base } = openWorkspace(dir);
    try {
      const record = store.getFinding(id);
      if (!record) {
        ctx.out(`finding not found: ${id}`);
        return { code: 1 };
      }
      const detail = {
        ...findingView(record, base),
        oracleIds: safeParse(record.oracleIds),
        reproduction: safeParse(record.reproductionJson),
        minimization: safeParse(record.minimizationJson),
        lastTransition: safeParse(record.lastTransitionJson)
      };
      if (ctx.json) {
        ctx.out(JSON.stringify(detail, null, 2));
      } else {
        ctx.out(`finding ${record.id}`);
        ctx.out(`  run: ${record.runId ?? "-"}`);
        ctx.out(
          `  status: ${record.status}  severity: ${record.severity ?? "-"}  confidence: ${fmtConfidence(record.confidence)}`
        );
        ctx.out(`  signature: ${record.signature ?? "-"}`);
        ctx.out(`  title: ${record.title}`);
        if (record.adapter) ctx.out(`  adapter: ${record.adapter}`);
        ctx.out(`  created: ${record.createdAt}  updated: ${record.updatedAt}`);
        ctx.out(`  artifact refs: ${detail.artifactRefCount}`);
        const repro = detail.reproduction;
        if (repro) {
          ctx.out(
            `  reproduction: attempts=${repro.attempts} successes=${repro.successes} errors=${repro.errors ?? 0}`
          );
        }
        const mini = detail.minimization;
        if (mini) {
          ctx.out(
            `  minimization: probes=${mini.probes} removals=${mini.removals} verified=${String(mini.verifiedReproduction)}`
          );
        }
        ctx.out(
          detail.evidenceBundlePath ? `  evidence bundle: ${detail.evidenceBundlePath}` : "  evidence bundle: not found on disk"
        );
      }
      return { code: 0, data: detail };
    } finally {
      store.close();
    }
  }
  throw new CliError("unknown-command", `unknown-command: findings ${sub} (try 'inspector help findings')`);
}

// packages/cli/src/runs.ts
function spawnForStoredAdapter(adapter) {
  if (adapter === "adapter-fake") return adapterSpawn("fake");
  if (adapter === "web-playwright") return adapterSpawn("web");
  return null;
}
async function runsCommand(parentRest, ctx) {
  const sub = parentRest[0];
  if (sub === void 0 || sub === "list") {
    const rest = sub === void 0 ? parentRest : parentRest.slice(1);
    const parsed = parseArgs(rest, ["--limit"], []);
    const limit = intFlag(parsed.flags, "--limit", 100);
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store } = openWorkspace(dir);
    try {
      const runs = store.listRuns(limit).map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, adapter: r.adapter }));
      if (ctx.json) {
        ctx.out(JSON.stringify(runs, null, 2));
      } else if (runs.length === 0) {
        ctx.out("no runs recorded");
      } else {
        for (const r of runs) {
          ctx.out(`${r.id}  ${r.status}  ${r.adapter ?? ""}  ${r.createdAt}`);
        }
      }
      return { code: 0, data: runs };
    } finally {
      store.close();
    }
  }
  if (sub === "show") {
    const parsed = parseArgs(parentRest.slice(1), [], []);
    const id = requirePositional(parsed.positionals, 0, "inspector runs show <id>");
    const dir = workDirOf(ctx, parsed);
    warnRepoRootWorkspace(ctx, dir);
    const { store } = openWorkspace(dir);
    try {
      const run2 = store.getRun(id);
      if (!run2) {
        ctx.out(`run not found: ${id}`);
        return { code: 1 };
      }
      const steps = store.getRunSteps(id).map((s) => ({
        sequence: s.step.sequence,
        action: s.action ? { id: s.action.id, kind: s.action.kind, status: s.action.status } : null,
        observations: s.observations.length
      }));
      const detail = { run: { id: run2.id, status: run2.status }, steps };
      if (ctx.json) {
        ctx.out(JSON.stringify(detail, null, 2));
      } else {
        ctx.out(`run ${id} (${run2.status})`);
        if (steps.length === 0) {
          ctx.out("  no steps recorded");
        } else {
          for (const s of steps) {
            ctx.out(
              `  #${s.sequence} ${s.action?.kind ?? "(observe)"} -> ${s.action?.status ?? "ok"} (${s.observations} obs)`
            );
          }
        }
      }
      return { code: 0, data: detail };
    } finally {
      store.close();
    }
  }
  if (sub === "resume") {
    return resumeRunCommand(parentRest.slice(1), ctx);
  }
  throw new CliError("unknown-command", `unknown-command: runs ${sub} (try 'inspector help runs')`);
}
async function resumeRunCommand(rest, ctx) {
  const parsed = parseArgs(rest, [], []);
  const id = requirePositional(parsed.positionals, 0, "inspector runs resume <id>");
  const dir = workDirOf(ctx, parsed);
  warnRepoRootWorkspace(ctx, dir);
  let store, artifacts;
  try {
    ({ store, artifacts } = openWorkspace(dir));
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  let controller = null;
  try {
    const record = store.getRun(id);
    if (!record) {
      ctx.out(`run not found: ${id}`);
      return { code: 1 };
    }
    if (record.status === "closed" || record.status === "failed" || record.status === "crashed") {
      ctx.out(`run ${id} already ${record.status}; there is nothing to resume`);
      return { code: 1 };
    }
    const spec = spawnForStoredAdapter(record.adapter);
    if (!spec) {
      ctx.out(
        `cannot determine the original adapter kind for run ${id} (recorded adapter: '${record.adapter ?? "unknown"}'); refusing to guess`
      );
      return { code: 1 };
    }
    const mgr = new RunManager(store, artifacts);
    let observationSummary = null;
    let observeError = null;
    try {
      try {
        controller = await mgr.resumeRun(id, spec);
      } catch (e) {
        const mapped = remapWorkspaceConflict(e);
        throw mapped === e ? e : mapped;
      }
      const obs = await controller.observe(["state"]);
      observationSummary = obs.summary;
    } catch (e) {
      observeError = e instanceof Error ? e.message : String(e);
    }
    const stepsRecorded = store.getRunSteps(id).length;
    const finalStatus = store.getRun(id)?.status ?? "unknown";
    const detail = {
      runId: id,
      adapter: record.adapter,
      reattached: controller !== null,
      observeError,
      observation: observationSummary,
      stepsRecorded,
      finalStatus
    };
    if (ctx.json) {
      ctx.out(JSON.stringify(detail, null, 2));
    } else {
      ctx.out(`resumed ${id} on ${record.adapter}`);
      ctx.out("  re-attached a fresh adapter process; in-flight actions marked unknown");
      if (observeError !== null) {
        ctx.out(`  re-observation FAILED: ${observeError}`);
      } else {
        ctx.out(`  latest observation: ${JSON.stringify(observationSummary)}`);
      }
      ctx.out(`  steps recorded: ${stepsRecorded}`);
      ctx.out(`  final status: ${finalStatus}`);
    }
    return { code: observeError === null ? 0 : 1, data: detail };
  } finally {
    if (controller) await closeRunGuarded(controller, ctx.progress);
    store.close();
  }
}

// packages/cli/src/cli.ts
function act(id, kind, input) {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 5e3, idempotency: "safe-retry", input };
}
function splitCommand(argv) {
  const rest = [];
  let command = null;
  let workspaceArg;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (command === null) {
      if (token === "--") continue;
      if (token === "--workspace") {
        const value = argv[i + 1];
        if (value !== void 0) {
          workspaceArg = value;
          i += 1;
        }
        continue;
      }
      if (token.startsWith("-") && token.length > 1) continue;
      command = token;
    } else {
      rest.push(token);
    }
  }
  return { command, rest, workspaceArg };
}
async function runCli(argv, cwd = process.cwd()) {
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${resolveVersion()}
`);
    return { code: 0 };
  }
  const { command, rest, workspaceArg } = splitCommand(argv);
  const json = argv.includes("--json");
  const out = (line) => {
    process.stdout.write(line + "\n");
  };
  const progress = (line) => {
    if (!json) process.stderr.write(line + "\n");
  };
  const helpRequested = argv.includes("--help") || argv.includes("-h");
  if (command === null && !helpRequested) {
    out(generalUsage());
    return { code: 1 };
  }
  if (helpRequested || command === "help") {
    const target = command === "help" ? rest[0] ?? "" : command;
    out(target === "" ? generalUsage() : commandHelp(target));
    return { code: 0 };
  }
  const ctx = { baseCwd: cwd, workspaceArg, json, out, progress };
  switch (command) {
    case "doctor":
      return doctorCommand(rest, ctx);
    case "hunt":
      return huntCommand(parseArgs(rest, ["--adapter", "--url", "--seed", "--max-actions", "--max-minutes", "--max-findings"], []), ctx);
    case "run":
      return runDemo(parseArgs(rest, ["--adapter"], []), ctx);
    case "runs":
      return runsCommand(rest, ctx);
    case "findings":
      return findingsCommand(rest, ctx);
    case "version":
      out(resolveVersion());
      return { code: 0 };
    default:
      throw new CliError("unknown-command", `${command} (try 'inspector --help')`);
  }
}
async function doctorCommand(rest, ctx) {
  const parsed = parseArgs(rest, [], []);
  const workDir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, workDir);
  const checks = await runDoctorProbes(workDir);
  const failedRequired = checks.filter((c) => !c.ok && c.required).length;
  if (ctx.json) {
    ctx.out(
      JSON.stringify(
        {
          ok: failedRequired === 0,
          ...warning !== null ? { warning } : {},
          workspace: workDir,
          checks
        },
        null,
        2
      )
    );
  } else {
    ctx.out(renderDoctorReport(checks));
  }
  return { code: failedRequired === 0 ? 0 : 1, data: { ok: failedRequired === 0, checks } };
}
async function runDemo(parsed, ctx) {
  const adapterArg = parsed.flags["--adapter"];
  if (adapterArg === void 0 || adapterArg === true) {
    throw new CliError("missing-value", "--adapter requires a value (fake|web)");
  }
  if (adapterArg !== "fake" && adapterArg !== "web") {
    ctx.out("only --adapter fake|web is supported");
    return { code: 1 };
  }
  const dir = workDirOf(ctx, parsed);
  warnRepoRootWorkspace(ctx, dir);
  let store, artifacts;
  try {
    ({ store, artifacts } = openWorkspace(dir));
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  try {
    const mgr = new RunManager(store, artifacts);
    let run2;
    try {
      run2 = await mgr.startRun(adapterSpawn(adapterArg));
    } catch (e) {
      throw remapWorkspaceConflict(e);
    }
    const steps = [];
    if (adapterArg === "fake") {
      for (const a of [act("d1", "openForm"), act("d2", "fillField", { name: "default", value: "ok" }), act("d3", "submit")]) {
        const r = await run2.submitAction(a);
        steps.push({ id: a.id, outcome: r.outcome });
      }
      await run2.observe(["state"]);
      await run2.reset();
      await run2.submitAction(act("d4", "openForm"));
      await run2.submitAction(act("d5", "fillField", { name: "default", value: "BAD" }));
      const fail = await run2.submitAction(act("d6", "submit"));
      const summary2 = {
        runId: run2.runId,
        adapter: "fake",
        deterministicFailure: fail.outcome?.status ?? "none"
      };
      ctx.out(ctx.json ? JSON.stringify(summary2, null, 2) : `run ${summary2.runId} complete; deterministicFailure=${summary2.deterministicFailure}`);
      await run2.close();
      return { code: 0, data: summary2 };
    }
    await run2.submitAction(act("w1", "fill", { selector: "#username", value: "admin" }));
    await run2.submitAction(act("w2", "fill", { selector: "#password", value: "admin" }));
    await run2.submitAction(act("w3", "click", { selector: "#loginBtn" }));
    const obs1 = await run2.observe(["url", "uiTree"]);
    await run2.submitAction(act("w4", "click", { selector: "#increment" }));
    await run2.submitAction(act("w5", "click", { selector: "#save" }));
    const obs2 = await run2.observe(["storage", "screenshot", "console", "network", "trace"]);
    const crash = await run2.submitAction(act("w6", "click", { selector: "#boom" }));
    const forbidden = await run2.submitAction(act("w7", "navigate", { value: "https://evil.example.com/secret" }));
    const obs3 = await run2.observe(["url", "pageErrors"]);
    const uiTree = obs1.summary.uiTree ?? [];
    const incrementNode = uiTree.find((e) => e.id === "increment");
    const summary = {
      runId: run2.runId,
      adapter: "web",
      reachedDashboard: incrementNode ? incrementNode.hidden === false : false,
      savedPreference: (obs2.summary.storage?.["pref"] ?? "").startsWith("saved-"),
      boomOutcome: crash.outcome?.status ?? "none",
      forbiddenOutcome: forbidden.outcome?.status ?? "none",
      pageErrorsAfterBoom: (obs3.summary.pageErrors ?? []).length
    };
    ctx.out(ctx.json ? JSON.stringify(summary, null, 2) : `run ${summary.runId} complete; dashboard=${summary.reachedDashboard}; pref=${summary.savedPreference}; boom=${summary.boomOutcome}; forbidden=${summary.forbiddenOutcome}`);
    await run2.close();
    return { code: 0, data: summary };
  } finally {
    store.close();
  }
}

// packages/cli/src/bin.ts
var debug = process.argv.slice(2).includes("--debug");
runCli(process.argv.slice(2)).then((result) => {
  process.exit(result.code);
}).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const prefix = err instanceof CliError ? "inspector" : "inspector error";
  process.stderr.write(`${prefix}: ${message}
`);
  if (debug && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}
`);
  }
  process.exit(1);
});
//# sourceMappingURL=inspector-cli.js.map
