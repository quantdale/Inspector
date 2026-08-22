// packages/adapter-web/src/web-adapter.ts
import {
  chromium
} from "playwright";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync as mkdirSync2, mkdtempSync, readFileSync as readFileSync2, rmSync as rmSync2 } from "node:fs";

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

// packages/adapter-web/src/seeded-app.ts
import { createServer } from "node:http";
function startSeedServer(opts = {}) {
  const body = opts.html ?? SEED_HTML;
  const server2 = createServer((req, res) => {
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
    server2.once("listening", () => {
      const addr = server2.address();
      if (addr && typeof addr === "object") {
        localAddress = addr.address;
        url = `http://127.0.0.1:${addr.port}/`;
      }
      resolve2();
    });
    server2.once("error", reject);
  });
  server2.listen(0, "127.0.0.1");
  return {
    get url() {
      return url;
    },
    get localAddress() {
      return localAddress;
    },
    ready,
    close: () => {
      server2.close();
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
  constructor(faults = {}, artifactBaseDir = join2(tmpdir(), "inspector-web-artifacts"), seedHtml, settleMs = 50, seedRedirectLoop = false, targetUrl2) {
    this.faults = faults;
    this.seedHtml = seedHtml;
    this.settleMs = Math.max(0, settleMs);
    this.seedRedirectLoop = seedRedirectLoop;
    if (targetUrl2 !== void 0) {
      const resolved = resolveTargetUrl(targetUrl2);
      this.defaultTargetUrl = resolved?.url;
    }
    mkdirSync2(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join2(artifactBaseDir, "inst-"));
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
    const path = join2(this.artifactDir, `trace-${this.traceIndex++}.zip`);
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
        content: readFileSync2(path),
        mime: "application/zip",
        name: "trace.zip"
      });
      rmSync2(path, { force: true });
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

// packages/adapter-web/src/bin.ts
function parseFaults() {
  const raw = process.env.WEB_FAULTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
var targetUrl = process.env.WEB_TARGET_URL || void 0;
var handler = new WebAdapterHandler(parseFaults(), void 0, void 0, 50, false, targetUrl);
var server = new AdapterServer(process.stdin, process.stdout, handler);
async function gracefulExit() {
  server.close();
  await handler.shutdown().catch(() => {
  });
  process.exit(0);
}
process.on("SIGTERM", () => {
  void gracefulExit();
});
process.on("SIGINT", () => {
  void gracefulExit();
});
process.stdout.on("error", () => process.exit(0));
//# sourceMappingURL=inspector-adapter-web.js.map
