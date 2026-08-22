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
function validateAction(data) {
  return run(compiled.action, data);
}
function validateObserveRequest(data) {
  return run(compiled.observeRequest, data);
}

// packages/adapter-sdk/src/jsonrpc.ts
var JSON_RPC_PARSE_ERROR = -32700;
var JSON_RPC_INVALID_REQUEST = -32600;
var JSON_RPC_METHOD_NOT_FOUND = -32601;
var JSON_RPC_INVALID_PARAMS = -32602;
var JSON_RPC_INTERNAL_ERROR = -32603;
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
  onMessage(handler2) {
    this.messageHandler = handler2;
  }
  onError(handler2) {
    this.errorHandler = handler2;
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

// packages/adapter-sdk/src/server.ts
var AdapterCrashError = class extends Error {
  constructor(message = "adapter crashed") {
    super(message);
    this.name = "AdapterCrashError";
  }
};
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidParams(errors) {
  return Object.assign(new Error(`invalid params: ${errors.join("; ")}`), {
    code: JSON_RPC_INVALID_PARAMS,
    data: errors
  });
}
var AdapterServer = class {
  constructor(readable, writable, handler2) {
    this.handler = handler2;
    this.channel = new LineChannel(readable, writable);
    this.channel.onMessage((msg) => {
      void this.dispatch(msg);
    });
  }
  channel;
  closed = false;
  async dispatch(msg) {
    if (!isPlainObject2(msg)) return;
    if (typeof msg.method !== "string") {
      if (msg.id !== null && msg.id !== void 0) {
        this.sendError(msg.id, {
          code: JSON_RPC_INVALID_REQUEST,
          message: "invalid request"
        });
      }
      return;
    }
    if (msg.id === null || msg.id === void 0) {
      if (msg.method === "cancel") {
        try {
          await this.handler.cancel(msg.params ?? { actionId: "" });
        } catch {
        }
      }
      return;
    }
    const req = msg;
    try {
      const result = await this.handle(req.method, req.params);
      this.channel.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      if (err instanceof AdapterCrashError) {
        this.sendError(req.id, {
          code: JSON_RPC_INTERNAL_ERROR,
          message: err.message
        });
        this.close();
        return;
      }
      const code = err.code;
      const data = err.data;
      this.sendError(req.id, {
        code: typeof code === "number" ? code : JSON_RPC_INTERNAL_ERROR,
        message: err instanceof Error ? err.message : String(err),
        data
      });
    }
  }
  sendError(id, error) {
    this.channel.send({ jsonrpc: "2.0", id, error });
  }
  async handle(method, params) {
    switch (method) {
      case "initialize":
        return this.handler.initialize(params ?? {});
      case "observe": {
        const p = params ?? {};
        const v = validateObserveRequest(p);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.observe(p);
      }
      case "act": {
        const p = params ?? {};
        const v = validateAction(p?.action);
        if (!v.ok) throw invalidParams(v.errors);
        return this.handler.act(p);
      }
      case "lifecycle":
        return this.handler.lifecycle(params ?? { op: "create" });
      case "health":
        return this.handler.health(params ?? {});
      default:
        throw Object.assign(new Error(`method not found: ${method}`), {
          code: JSON_RPC_METHOD_NOT_FOUND
        });
    }
  }
  emitEvent(method, params) {
    if (this.closed) return;
    this.channel.send({ jsonrpc: "2.0", method, params });
  }
  close() {
    this.closed = true;
    this.channel.close();
  }
};

// packages/adapter-sdk/src/redaction.ts
var URL_RE = /https?:\/\/[^\s"'<>()[\]]+/g;
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
function rewriteUrls(text, fn) {
  return text.replace(URL_RE, (match) => fn(match));
}
function stripUrlCredentialsInText(text) {
  return rewriteUrls(text, stripUrlCredentials);
}

// packages/artifact-store/src/artifact-store.ts
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
    if (dirname(resolved) === resolved) {
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
    return this.contain(join(this.baseAbs, runId, "artifacts"));
  }
  /**
   * Refuse a run directory that exists but is not a real directory inside the
   * store (e.g. a symlink pointing elsewhere), before anything is created in it.
   */
  ensureRunDirSafe(runId) {
    const dir = this.runDir(runId);
    const runPath = join(this.baseAbs, runId);
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
      writeFileSync(tmp, content, { flag: "wx" });
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
    const absPath = this.contain(join(dir, fileName));
    const destType = lstatType(absPath);
    if (destType === "file") {
      const disk = readFileSync(absPath);
      const diskSha = createHash("sha256").update(disk).digest("hex");
      if (disk.byteLength !== options.content.byteLength || diskSha !== sha256) {
        this.atomicWrite(absPath, options.content);
      }
    } else {
      if (destType !== "absent") {
        throw new PathPolicyError(`refusing non-regular artifact destination: ${absPath}`);
      }
      mkdirSync(dir, { recursive: true });
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
    const content = readFileSync(meta.path);
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
    const absPath = this.contain(join(this.runDir(runId), sha256));
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
    const content = readFileSync(meta.path);
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
    if (dirname(this.baseAbs) === this.baseAbs) {
      throw new PathPolicyError(`refusing to clear filesystem root: ${this.baseAbs}`);
    }
    rmSync(this.baseAbs, { recursive: true, force: true });
    this.index.clear();
  }
};

// packages/android/src/android-adapter.ts
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync as mkdirSync2, mkdtempSync } from "node:fs";

// packages/android/src/uiautomator.ts
function parseUiautomatorDump(xml) {
  const out = [];
  const nodeRe = /<node\s+([^>]*?)\/>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const attrs = /* @__PURE__ */ new Map();
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1] ?? "")) !== null) {
      attrs.set(a[1] ?? "", a[2] ?? "");
    }
    const resId = attrs.get("resource-id") ?? "";
    if (!resId.includes(":id/")) continue;
    const cls = attrs.get("class") ?? "";
    const boundsRaw = attrs.get("bounds") ?? "";
    const bm = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsRaw);
    if (!bm) continue;
    const x1 = Number(bm[1]);
    const y1 = Number(bm[2]);
    const x2 = Number(bm[3]);
    const y2 = Number(bm[4]);
    const id = resId.split(":id/")[1] ?? resId;
    const text = attrs.get("text") ?? "";
    const isField = cls.endsWith("EditText");
    const hidden = x2 <= x1 || y2 <= y1;
    out.push({
      tag: "node",
      role: cls.endsWith("Button") ? "button" : isField ? "input" : "text",
      name: attrs.get("content-desc") || text || id,
      id,
      hidden,
      disabled: attrs.get("enabled") === "false",
      value: isField ? text : void 0,
      text: isField ? void 0 : text,
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
    });
  }
  return out;
}

// packages/android/src/mock-backend.ts
var SEED_PACKAGE = "com.seedbank.droid";
function initialApp() {
  return {
    screen: "login",
    username: "",
    password: "",
    message: "",
    count: 0,
    focused: null,
    errors: [],
    installed: true,
    pid: null
  };
}
function render(app) {
  if (app.screen === "login") {
    return [
      { id: "username", cls: "EditText", text: app.username, bounds: [40, 200, 400, 56] },
      { id: "password", cls: "EditText", text: app.password, bounds: [40, 280, 400, 56] },
      { id: "login", cls: "Button", text: "Log in", bounds: [40, 380, 400, 64] },
      { id: "msg", cls: "TextView", text: app.message, bounds: [40, 480, 400, 32] }
    ];
  }
  return [
    { id: "welcome", cls: "TextView", text: `Welcome ${app.username}`, bounds: [40, 120, 400, 40] },
    { id: "count", cls: "TextView", text: String(app.count), bounds: [40, 200, 400, 48] },
    { id: "increment", cls: "Button", text: "Increment", bounds: [40, 280, 400, 64] },
    { id: "save", cls: "Button", text: "Save preference", bounds: [40, 370, 400, 64] },
    { id: "boom", cls: "Button", text: "Trigger crash", bounds: [40, 460, 400, 64] },
    { id: "logout", cls: "Button", text: "Log out", bounds: [40, 550, 400, 64] }
  ];
}
function uiautomatorXml(app) {
  const nodes = render(app).map((el, i) => {
    const [x, y, w, h] = el.bounds;
    const resId = `${SEED_PACKAGE}:id/${el.id}`;
    const cls = `android.widget.${el.cls}`;
    return [
      `<node index="${i}" text="${escapeXml(el.text)}" resource-id="${resId}"`,
      `class="${cls}" package="${SEED_PACKAGE}" content-desc=""`,
      `checkable="false" checked="false" clickable="${el.cls === "Button"}"`,
      `enabled="true" focusable="${el.cls === "EditText"}" focused="${app.focused === el.id}"`,
      `scrollable="false" selected="false" bounds="[${x},${y}][${x + w},${y + h}]" />`
    ].join(" ");
  }).join("\n  ");
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  ${nodes}
</hierarchy>`;
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function unquoteDeviceShellWord(s) {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).split("'\\''").join("'");
  }
  return s;
}
var MockAdbBackend = class {
  apps = /* @__PURE__ */ new Map();
  logs = /* @__PURE__ */ new Map();
  nextPid = 4242;
  deviceCrashed = false;
  async devices() {
    this.assertAlive();
    return ["emulator-5554"];
  }
  async shell(serial, cmd) {
    this.assertAlive();
    const app = this.appFor(serial);
    if (cmd.startsWith("uiautomator dump")) {
      return uiautomatorXml(app);
    }
    if (cmd.startsWith("am force-stop") || cmd.startsWith("pm clear")) {
      this.apps.set(serial, initialApp());
      return "Success";
    }
    if (cmd.startsWith("am start") || cmd.startsWith("monkey ")) {
      app.pid = this.nextPid++;
      return "Success";
    }
    if (cmd.startsWith("input tap")) {
      const [, , xs, ys] = cmd.split(/\s+/);
      const x = Number(xs);
      const y = Number(ys);
      this.tap(app, serial, x, y);
      return "";
    }
    if (cmd.startsWith("input text")) {
      const value = unquoteDeviceShellWord(cmd.slice("input text".length).trim());
      if (!app.focused || app.screen !== "login") {
        throw new Error(`ERROR: no focused field for input text '${value}'`);
      }
      if (app.focused === "username") app.username = value;
      else if (app.focused === "password") app.password = value;
      else throw new Error("ERROR: unknown focused field");
      return "";
    }
    if (cmd.startsWith("input keyevent")) {
      return "";
    }
    throw new Error(`unsupported shell command: ${cmd}`);
  }
  /**
   * Mirrors the normalized real-backend contract (D-A2): pid string when the
   * seed app is running, null when not, typed error when the device is down.
   */
  async pidOf(serial, pkg) {
    if (pkg !== SEED_PACKAGE) return null;
    this.assertAlive();
    const app = this.appFor(serial);
    return app.pid === null ? null : String(app.pid);
  }
  async screencap() {
    this.assertAlive();
    return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  async logcat(serial, lines = 20) {
    this.assertAlive();
    return (this.logs.get(serial) ?? []).slice(-lines);
  }
  async appErrors(serial) {
    return [...this.appFor(serial).errors];
  }
  async install(serial, _apkPath) {
    this.assertAlive();
    if (!this.apps.has(serial)) this.apps.set(serial, initialApp());
  }
  async uninstall(serial, _pkg) {
    this.assertAlive();
    this.apps.set(serial, initialApp());
  }
  /** Test/diagnostic hook: current app state. */
  stateFor(serial) {
    return this.appFor(serial);
  }
  appFor(serial) {
    let app = this.apps.get(serial);
    if (!app) {
      app = initialApp();
      this.apps.set(serial, app);
    }
    return app;
  }
  log(serial, line) {
    const arr = this.logs.get(serial) ?? [];
    arr.push(`${Date.now()} E SeedDroid: ${line}`);
    this.logs.set(serial, arr);
  }
  assertAlive() {
    if (this.deviceCrashed) throw new Error("error: device offline (injected fault)");
  }
  tap(app, serial, x, y) {
    const hit = render(app).find(
      (el) => !el.hidden && x >= el.bounds[0] && x <= el.bounds[0] + el.bounds[2] && y >= el.bounds[1] && y <= el.bounds[1] + el.bounds[3]
    );
    if (!hit) throw new Error(`ERROR: nothing tappable at ${x},${y}`);
    if (hit.cls === "EditText") {
      app.focused = hit.id;
      return;
    }
    if (hit.cls !== "Button") return;
    switch (hit.id) {
      case "login": {
        if (app.username.length >= 64 || app.username === "CRASH") {
          app.errors.push("HiddenValidationCrash");
          this.log(serial, "HiddenValidationCrash");
          return;
        }
        if (app.username && app.password) {
          app.screen = "dashboard";
          app.focused = null;
        } else {
          app.message = "invalid credentials";
        }
        return;
      }
      case "increment": {
        app.count += 1;
        if (app.count >= 8) {
          app.count = Number.NaN;
          app.errors.push("IncrementOverflowCrash");
          this.log(serial, "IncrementOverflowCrash");
        }
        return;
      }
      case "save":
        return;
      case "boom": {
        app.errors.push("IntentionalAppCrash");
        this.log(serial, "IntentionalAppCrash");
        return;
      }
      case "logout":
        this.apps.set(serial, initialApp());
        return;
      default:
        return;
    }
  }
};

// packages/android/src/android-adapter.ts
var ANDROID_CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "android-uiautomator",
  capabilities: {
    observe: ["uiTree", "screenshot", "logcat"],
    act: ["click", "fill", "press", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: []
  }
};
function freshError(before, after) {
  const counts = /* @__PURE__ */ new Map();
  for (const e of before) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const e of after) {
    const remaining = counts.get(e) ?? 0;
    if (remaining === 0) return e;
    counts.set(e, remaining - 1);
  }
  return void 0;
}
function quoteDeviceShellWord(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
var AndroidAdapterHandler = class {
  constructor(backend2, faults = {}, artifactBaseDir = join2(tmpdir(), "inspector-android-artifacts")) {
    this.backend = backend2;
    this.faults = faults;
    mkdirSync2(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join2(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
  }
  serial = null;
  /** Package reported in observations (launchPackage, else the seed package). */
  currentPackage = SEED_PACKAGE;
  artifacts;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  artifactDir;
  runId = "run";
  environmentId = "env";
  seq = 0;
  async initialize() {
    return ANDROID_CAPABILITIES;
  }
  async lifecycle(params) {
    switch (params.op) {
      case "create": {
        const opts = this.lifecycleOptions(params.options);
        this.applyAttribution(params.options);
        const devices = await this.backend.devices();
        this.serial = devices[0] ?? null;
        if (!this.serial) throw protocolError("VALIDATION", "no device connected");
        if (opts.seedApk !== void 0) {
          await this.backend.install(this.serial, opts.seedApk);
          this.currentPackage = SEED_PACKAGE;
        } else {
          this.currentPackage = opts.launchPackage ?? SEED_PACKAGE;
        }
        if (opts.launchPackage !== void 0) {
          await this.launchApp(this.serial, opts);
        }
        return { ok: true };
      }
      case "reset": {
        if (!this.serial) throw protocolError("VALIDATION", "environment not created");
        const opts = this.lifecycleOptions(params.options);
        if (opts.seedApk !== void 0) {
          await this.backend.uninstall(this.serial, SEED_PACKAGE);
          await this.backend.install(this.serial, opts.seedApk);
          this.currentPackage = SEED_PACKAGE;
          return { ok: true };
        }
        if (opts.launchPackage !== void 0) {
          const pkg = opts.launchPackage;
          await this.backend.shell(this.serial, `am force-stop ${pkg}`);
          await this.backend.shell(this.serial, `pm clear ${pkg}`);
          await this.launchApp(this.serial, opts);
          this.currentPackage = pkg;
        }
        return { ok: true };
      }
      case "close": {
        this.serial = null;
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }
  async observe(params = {}) {
    if (!this.serial) throw new Error("environment not created");
    const serial = this.serial;
    const want = new Set(params.observe ?? []);
    let uiTree = [];
    let observeError;
    try {
      const dump = await this.dumpXml(serial);
      if (!dump.trim()) {
        throw new Error("uiautomator dump failed: empty output");
      }
      if (!dump.includes("</hierarchy>")) {
        throw new Error("uiautomator dump failed: truncated output");
      }
      uiTree = parseUiautomatorDump(dump).map((el) => ({
        tag: el.tag,
        role: el.role,
        name: el.name,
        id: el.id,
        hidden: el.hidden,
        disabled: el.disabled,
        value: el.value,
        text: el.text
      }));
    } catch (e) {
      observeError = {
        source: "uiautomator-dump",
        message: e instanceof Error ? e.message : String(e)
      };
    }
    const artifacts = [];
    if (want.has("screenshot")) {
      const png = await this.backend.screencap(serial);
      const meta = this.artifacts.write({
        runId: this.runId,
        content: png,
        mime: "image/png",
        name: "screenshot.png"
      });
      artifacts.push({ sha256: meta.sha256, mime: meta.mime, size: meta.size, path: meta.path });
    }
    const logcat = want.has("logcat") ? (await this.backend.logcat(serial)).map(stripUrlCredentialsInText) : [];
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-android",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      summary: {
        url: `android://${serial}/${this.currentPackage}`,
        title: this.currentPackage,
        uiTree,
        logcat,
        storage: {},
        ...observeError ? { observeError } : {}
      },
      artifacts
    };
  }
  async act(params) {
    if (this.faults.crashDevice) {
      this.faults.crashDevice = false;
      await this.simulateCrash();
    }
    if (!this.serial) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const sel = String(action.input?.selector ?? "");
    const value = action.input?.value === void 0 ? "" : String(action.input.value);
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const before = await this.backend.appErrors(this.serial);
      switch (action.kind) {
        case "click": {
          const target = await this.resolveTarget(sel);
          await this.backend.shell(
            this.serial,
            `input tap ${target.center.x} ${target.center.y}`
          );
          break;
        }
        case "fill": {
          const target = await this.resolveTarget(sel);
          await this.backend.shell(
            this.serial,
            `input tap ${target.center.x} ${target.center.y}`
          );
          await this.backend.shell(this.serial, `input text ${quoteDeviceShellWord(value)}`);
          break;
        }
        case "press": {
          const code = Number(value === "" ? "4" : value);
          if (!Number.isInteger(code) || code < 0 || code > 1e3) {
            throw protocolError("VALIDATION", `invalid keyevent code: ${value}`);
          }
          await this.backend.shell(this.serial, `input keyevent ${code}`);
          break;
        }
        case "fault": {
          const fault = String(action.input?.fault ?? "");
          const allowed = ANDROID_CAPABILITIES.capabilities.faults ?? [];
          if (!allowed.includes(fault)) {
            throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
          }
          if (fault === "crash") {
            await this.simulateCrash();
          } else {
            throw protocolError("VALIDATION", `unsupported fault: ${fault}`);
          }
          break;
        }
        default:
          throw protocolError("VALIDATION", `unknown android action: ${action.kind}`);
      }
      const after = await this.backend.appErrors(this.serial);
      const fresh = freshError(before, after);
      if (fresh) {
        return {
          ...base,
          status: "target-failure",
          stateAfter: `android://${this.serial}`,
          error: { code: "TARGET_FAILURE", message: fresh }
        };
      }
      return {
        ...base,
        status: "success",
        stateAfter: `android://${this.serial}`
      };
    } catch (e) {
      if (e instanceof AdapterCrashError) throw e;
      if (e && typeof e === "object" && "code" in e) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        ...base,
        status: "target-failure",
        stateAfter: this.serial ? `android://${this.serial}` : "",
        error: { code: "ACTION_FAILED", message }
      };
    }
  }
  async health() {
    return { ok: this.serial !== null, uptimeMs: 0, now: (/* @__PURE__ */ new Date()).toISOString() };
  }
  async cancel() {
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
  /** Extract typed lifecycle options, ignoring non-string values. */
  lifecycleOptions(options) {
    const str = (v) => typeof v === "string" && v ? v : void 0;
    return {
      seedApk: str(options?.seedApk),
      launchPackage: str(options?.launchPackage),
      launchActivity: str(options?.launchActivity)
    };
  }
  /** Launch (or relaunch) an app by package, preferring the named activity. */
  async launchApp(serial, opts) {
    if (opts.launchPackage === void 0) return;
    const cmd = opts.launchActivity ? `am start -n ${opts.launchPackage}/${opts.launchActivity}` : `monkey -p ${opts.launchPackage} -c android.intent.category.LAUNCHER 1`;
    await this.backend.shell(serial, cmd);
  }
  /** Resolve "#id" to tappable element center via a fresh UI dump. */
  async resolveTarget(selector) {
    if (!this.serial) throw protocolError("VALIDATION", "environment not created");
    const id = selector.replace(/^#/, "");
    const dump = await this.dumpXml(this.serial);
    const el = parseUiautomatorDump(dump).find((e) => e.id === id && !e.hidden && !e.disabled);
    if (!el) throw new Error(`element not found or not visible: ${selector}`);
    return el;
  }
  /**
   * UI hierarchy XML: prefer the backend's dedicated dump channel (real
   * backends dump to /sdcard/window_dump.xml and pull it); fall back to the
   * legacy `uiautomator dump /dev/tty` shell form for minimal stubs.
   */
  async dumpXml(serial) {
    if (this.backend.dumpUi) return this.backend.dumpUi(serial);
    return this.backend.shell(serial, "uiautomator dump /dev/tty");
  }
  async simulateCrash() {
    try {
      await this.backend.shell("emulator-5554-nonexistent", "echo x");
    } catch {
    }
    throw new AdapterCrashError("adapter-crash: device lost (injected fault)");
  }
};

// packages/android/src/real-backend.ts
import { spawn } from "node:child_process";
import { mkdtempSync as mkdtempSync2, readFileSync as readFileSync2, rmSync as rmSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join3 } from "node:path";

// packages/android/src/adb-errors.ts
var AdbError = class extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.name = "AdbError";
  }
};

// packages/android/src/real-backend.ts
var DEFAULT_TIMEOUT_MS = 15e3;
var LIVENESS_TIMEOUT_MS = 5e3;
var ADB_PROBE_TIMEOUT_MS = 5e3;
function runAdb(adbPath, args, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const child = spawn(adbPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new AdbError("ADB_TIMEOUT", `adb ${args[0]} timed out after ${timeoutMs}ms`, {
          command: args.join(" "),
          timeoutMs
        })
      );
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        err.code === "ENOENT" ? new AdbError("ADB_NOT_FOUND", `adb binary not found at '${adbPath}'`) : new AdbError("ADB_COMMAND_FAILED", `failed to spawn adb: ${err.message}`)
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve2({ stdout, stderr, code });
    });
  });
}
async function runAdbOrThrow(adbPath, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const r = await runAdb(adbPath, args, timeoutMs);
  if (r.code !== 0) {
    throw new AdbError("ADB_COMMAND_FAILED", `adb ${args.join(" ")} exited ${r.code}: ${r.stderr.trim() || r.stdout.toString("utf8").trim()}`, {
      command: args.join(" "),
      stderr: r.stderr.trim()
    });
  }
  return r.stdout.toString("utf8");
}
async function probeAdbAvailable(adbPath = "adb", timeoutMs = ADB_PROBE_TIMEOUT_MS) {
  try {
    await runAdbOrThrow(adbPath, ["version"], timeoutMs);
    return true;
  } catch {
    return false;
  }
}
function parsePidofOutcome(code, stdout) {
  const out = stdout.toString("utf8").trim();
  if (code === 0 && out.length > 0) return out;
  if (code === 1 && out.length === 0) return null;
  throw new AdbError(
    "ADB_COMMAND_FAILED",
    `pidof exited ${code} with unexpected output: ${out || "(empty)"}`
  );
}
function quoteDeviceShellWord2(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
var RealAdbBackend = class {
  constructor(adbPath = "adb", defaultTimeoutMs = DEFAULT_TIMEOUT_MS, runner = runAdb) {
    this.adbPath = adbPath;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.runner = runner;
  }
  runOrThrow(args, timeoutMs = this.defaultTimeoutMs) {
    return this.runner(this.adbPath, args, timeoutMs).then((r) => {
      if (r.code !== 0) {
        throw new AdbError(
          "ADB_COMMAND_FAILED",
          `adb ${args.join(" ")} exited ${r.code}: ${r.stderr.trim() || r.stdout.toString("utf8").trim()}`,
          { command: args.join(" "), stderr: r.stderr.trim() }
        );
      }
      return r.stdout.toString("utf8");
    });
  }
  /**
   * Process presence with normalized pidof semantics (D-A2): null when the
   * package is not running (`pidof` exits 1 with empty output), the trimmed
   * pid string(s) when running, typed errors only on genuine failures.
   */
  async pidOf(serial, pkg) {
    await this.assertAlive(serial);
    const r = await this.runner(
      this.adbPath,
      ["-s", serial, "shell", `pidof ${quoteDeviceShellWord2(pkg)}`],
      this.defaultTimeoutMs
    );
    return parsePidofOutcome(r.code, r.stdout);
  }
  /**
   * Device serials that are listed AND proven alive. Presence lies: a dead
   * emulator can sit in `adb devices` as `device` while every shell call
   * hangs, so each candidate must survive a bounded echo round-trip.
   */
  async devices() {
    const out = await this.runOrThrow(["devices"]);
    const candidates = out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l.length > 0).map((l) => l.split(/\s+/)).filter(([serial, state]) => serial && state === "device").map(([serial]) => serial ?? "").filter((s) => s.length > 0);
    const alive = await Promise.all(
      candidates.map(async (serial) => {
        try {
          await this.assertAlive(serial);
          return serial;
        } catch {
          return null;
        }
      })
    );
    return alive.filter((s) => s !== null);
  }
  async shell(serial, cmd) {
    await this.assertAlive(serial);
    return this.runOrThrow(["-s", serial, "shell", cmd], this.defaultTimeoutMs);
  }
  async screencap(serial) {
    await this.assertAlive(serial);
    const r = await this.runner(this.adbPath, ["-s", serial, "exec-out", "screencap -p"], this.defaultTimeoutMs);
    if (r.code !== 0) {
      throw new AdbError("ADB_COMMAND_FAILED", `screencap failed: ${r.stderr.trim()}`, { serial });
    }
    const buf = r.stdout;
    if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new AdbError("ADB_COMMAND_FAILED", "screencap produced non-PNG output", { serial });
    }
    return buf;
  }
  async logcat(serial, lines = 200) {
    await this.assertAlive(serial);
    const out = await this.runOrThrow(
      ["-s", serial, "logcat", "-d", "-t", String(lines)],
      this.defaultTimeoutMs
    );
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  }
  async install(serial, apkPath) {
    await this.assertAlive(serial);
    const out = await this.runOrThrow(["-s", serial, "install", "-r", apkPath], 12e4);
    if (!out.includes("Success")) {
      throw new AdbError("ADB_COMMAND_FAILED", `install failed: ${out.trim()}`, { serial });
    }
  }
  async uninstall(serial, pkg) {
    await this.assertAlive(serial);
    await this.runOrThrow(["-s", serial, "uninstall", pkg], 6e4).catch((e) => {
      throw e instanceof AdbError ? e : new AdbError("ADB_COMMAND_FAILED", String(e), { serial });
    });
  }
  /** Fatal application errors since boot, harvested from logcat. */
  async appErrors(serial) {
    const lines = await this.logcat(serial, 5e3);
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("FATAL EXCEPTION")) continue;
      const cause = lines[i + 1]?.trim() ?? "";
      errors.push(cause || lines[i]);
    }
    return errors;
  }
  /**
   * uiautomator dump to /sdcard/window_dump.xml, pull to a temp file, parse
   * caller-side. Bounded end-to-end; any failure is DUMP_FAILED.
   */
  async dumpUi(serial) {
    await this.assertAlive(serial);
    const tmpDir = mkdtempSync2(join3(tmpdir2(), "inspector-uia-"));
    const local = join3(tmpDir, "window_dump.xml");
    try {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const dumpOut = await this.runOrThrow(
            ["-s", serial, "shell", "uiautomator dump /sdcard/window_dump.xml"],
            3e4
          );
          if (!dumpOut.includes("dumped")) {
            throw new AdbError("DUMP_FAILED", `uiautomator dump did not confirm: ${dumpOut.trim()}`, { serial });
          }
          await this.runOrThrow(
            ["-s", serial, "pull", "/sdcard/window_dump.xml", local],
            15e3
          );
          return readFileSync2(local, "utf8");
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 2e3));
        }
      }
      throw lastErr instanceof AdbError ? lastErr : new AdbError("DUMP_FAILED", `uiautomator dump failed: ${String(lastErr)}`, { serial });
    } finally {
      rmSync2(tmpDir, { recursive: true, force: true });
    }
  }
  /** Bounded liveness probe; throws DEVICE_NOT_ALIVE when the device lies. */
  async assertAlive(serial) {
    let r;
    try {
      r = await this.runner(this.adbPath, ["-s", serial, "shell", "echo ok"], LIVENESS_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof AdbError && e.code === "ADB_TIMEOUT") {
        throw new AdbError(
          "DEVICE_NOT_ALIVE",
          `device ${serial} listed but unresponsive (stale device); shell echo exceeded ${LIVENESS_TIMEOUT_MS}ms`,
          { serial }
        );
      }
      throw e;
    }
    if (r.code !== 0 || !r.stdout.includes("ok")) {
      throw new AdbError(
        "DEVICE_OFFLINE",
        `device ${serial} not usable: exit=${r.code} out=${r.stdout.toString("utf8").trim()} err=${r.stderr.trim()}`,
        { serial }
      );
    }
  }
};
function backendModeFromEnv(env = process.env) {
  const v = env["INSPECTOR_ANDROID_BACKEND"];
  if (v === "real" || v === "mock" || v === "auto") return v;
  return "auto";
}
async function createAdbBackendFromEnv(env = process.env) {
  const mode = backendModeFromEnv(env);
  if (mode === "mock") return { backend: new MockAdbBackend(), mode };
  if (mode === "real") return { backend: new RealAdbBackend(), mode };
  if (await probeAdbAvailable()) return { backend: new RealAdbBackend(), mode: "real" };
  console.warn(
    "[inspector-android] INSPECTOR_ANDROID_BACKEND=auto: adb unavailable or probe failed; falling back to mock backend"
  );
  return { backend: new MockAdbBackend(), mode: "mock" };
}

// packages/android/src/bin.ts
var { backend } = await createAdbBackendFromEnv();
var handler = new AndroidAdapterHandler(backend);
var server = new AdapterServer(process.stdin, process.stdout, handler);
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.stdout.on("error", () => process.exit(0));
//# sourceMappingURL=inspector-adapter-android.js.map
