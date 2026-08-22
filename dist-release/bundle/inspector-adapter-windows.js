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
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUFFIXES.some((w) => lower === w || lower.endsWith(w));
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

// packages/windows-adapter/src/windows-adapter.ts
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync as mkdirSync2, mkdtempSync } from "node:fs";
var WINDOWS_CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "windows-uia",
  capabilities: {
    observe: ["uiTree"],
    act: ["click", "fill", "fault"],
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
var WindowsAdapterHandler = class {
  constructor(backend, artifactBaseDir = join2(tmpdir(), "inspector-windows-artifacts")) {
    this.backend = backend;
    mkdirSync2(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join2(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
    void this.artifacts;
  }
  created = false;
  artifacts;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  artifactDir;
  runId = "run";
  environmentId = "env";
  seq = 0;
  async initialize() {
    return WINDOWS_CAPABILITIES;
  }
  async lifecycle(params) {
    switch (params.op) {
      case "create":
        await this.backend.tree();
        this.created = true;
        this.applyAttribution(params.options);
        return { ok: true };
      case "reset":
        await this.backend.reset();
        this.created = true;
        return { ok: true };
      case "waitForWindow": {
        const winOps = this.backend;
        if (typeof winOps.waitForWindow !== "function") {
          throw protocolError("CAPABILITY_DENIED", "backend does not support waitForWindow");
        }
        const opts = params.options ?? {};
        const pid = typeof opts.pid === "number" ? opts.pid : void 0;
        const titleContains = typeof opts.titleContains === "string" ? opts.titleContains : void 0;
        if (pid === void 0 && !titleContains) {
          throw protocolError("VALIDATION", "waitForWindow requires pid or titleContains");
        }
        const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : void 0;
        const window = await winOps.waitForWindow({ pid, titleContains, timeoutMs });
        return { ok: true, window };
      }
      case "close":
        this.created = false;
        return { ok: true };
      default:
        return { ok: false };
    }
  }
  async observe(params = {}) {
    if (!this.created) throw new Error("environment not created");
    void params;
    const nodes = await this.backend.tree();
    const uiTree = nodes.map((n) => ({
      tag: "control",
      role: n.type === "Button" ? "button" : n.type === "Edit" ? "input" : "text",
      name: n.text || n.id,
      id: n.id,
      // KNOWN DEBT: the mock UIA model carries no geometry, so visibility
      // cannot be derived here; every mapped control is reported visible.
      hidden: false,
      disabled: !n.enabled,
      // Password-style controls (identified by automation id) are masked
      // before their value can reach observations or model context.
      value: n.type === "Edit" ? isSensitiveKey(n.id) ? REDACTED : n.text : void 0,
      text: n.type === "Edit" ? void 0 : n.text
    }));
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-windows-uia",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      summary: { url: "windows://seedbank-dialog", title: "SeedBank", uiTree, storage: {} }
    };
  }
  async act(params) {
    if (!this.created) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      stateAfter: "windows://seedbank-dialog"
    };
    try {
      if (action.kind === "fault") {
        const fault = String(action.input?.fault ?? "");
        const allowed = WINDOWS_CAPABILITIES.capabilities.faults ?? [];
        if (!allowed.includes(fault)) {
          throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
        }
        throw new AdapterCrashError("adapter-crash: UIA client lost (injected fault)");
      }
      const before = await this.backend.errors();
      const sel = String(action.input?.selector ?? "").replace(/^#/, "");
      const value = action.input?.value === void 0 ? "" : String(action.input.value);
      switch (action.kind) {
        case "click":
          await this.backend.invoke(sel);
          break;
        case "fill":
          await this.backend.setValue(sel, value);
          break;
        default:
          throw protocolError("VALIDATION", `unknown windows action: ${action.kind}`);
      }
      const after = await this.backend.errors();
      const fresh = freshError(before, after);
      if (fresh) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "TARGET_FAILURE", message: fresh }
        };
      }
      return { ...base, status: "success" };
    } catch (e) {
      if (e instanceof AdapterCrashError) throw e;
      if (e && typeof e === "object" && "code" in e) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        ...base,
        status: "target-failure",
        error: { code: "ACTION_FAILED", message }
      };
    }
  }
  async health() {
    let ok = this.created;
    if (ok) {
      try {
        await this.backend.tree();
      } catch {
        ok = false;
      }
    }
    return { ok, uptimeMs: 0, now: (/* @__PURE__ */ new Date()).toISOString() };
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
};

// packages/windows-adapter/src/selection.ts
import { spawn as spawn2 } from "node:child_process";

// packages/windows-adapter/src/types.ts
var WindowsBackendError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "WindowsBackendError";
    this.code = code;
  }
};

// packages/windows-adapter/src/mock-uia.ts
function initial() {
  return { screen: "login", username: "", password: "", message: "", count: 0, errors: [] };
}
var MOCK_SEED_PID = 4242;
var MockUiaBackend = class {
  deviceCrashed = false;
  app = initial();
  /**
   * Injectable rehost-collapse scenario, mirroring RealUiaBackend's
   * rehost-collapse semantics: when set (and a good baseline tree exists),
   * the cached window enumerates as a root-only stub. The bounded reattach
   * succeeds with `reattached: true` when `replacementWindow` is true and
   * fails with typed REATTACH_FAILED when it is false.
   */
  rehostScenario = null;
  /** Node count of the last accepted (non-collapsed) rich tree this session. */
  lastGoodRichCount = null;
  async tree() {
    this.assertAlive();
    const a = this.app;
    if (a.screen === "login") {
      return [
        { id: "usernameLabel", type: "Text", text: "Username", enabled: true },
        { id: "username", type: "Edit", text: a.username, enabled: true },
        { id: "password", type: "Edit", text: a.password, enabled: true },
        { id: "loginBtn", type: "Button", text: "Log in", enabled: true },
        { id: "msg", type: "Text", text: a.message, enabled: true }
      ];
    }
    return [
      { id: "welcome", type: "Text", text: `Welcome ${a.username}`, enabled: true },
      { id: "count", type: "Text", text: Number.isNaN(a.count) ? "NaN" : String(a.count), enabled: true },
      { id: "incrementBtn", type: "Button", text: "Increment", enabled: true },
      { id: "saveBtn", type: "Button", text: "Save preference", enabled: true },
      { id: "boomBtn", type: "Button", text: "Trigger crash", enabled: true },
      { id: "logoutBtn", type: "Button", text: "Log out", enabled: true }
    ];
  }
  async invoke(id) {
    this.assertAlive();
    const a = this.app;
    const visible = await this.tree();
    const node = visible.find((n) => n.id === id && n.type === "Button");
    if (!node) throw new Error(`element not found or not invokable: ${id}`);
    switch (id) {
      case "loginBtn": {
        if (a.username.length >= 64 || a.username === "CRASH") {
          a.errors.push("HiddenValidationCrash");
          return;
        }
        if (a.username && a.password) {
          a.screen = "dashboard";
        } else {
          a.message = "invalid credentials";
        }
        return;
      }
      case "incrementBtn": {
        a.count += 1;
        if (a.count >= 8) {
          a.count = Number.NaN;
          a.errors.push("IncrementOverflowCrash");
        }
        return;
      }
      case "boomBtn":
        a.errors.push("IntentionalAppCrash");
        return;
      case "logoutBtn":
        this.app = initial();
        return;
      default:
        return;
    }
  }
  async setValue(id, value) {
    this.assertAlive();
    if (this.app.screen !== "login") throw new Error(`element not found: ${id}`);
    if (id === "username") this.app.username = value;
    else if (id === "password") this.app.password = value;
    else throw new Error(`element not found or not editable: ${id}`);
  }
  async errors() {
    return [...this.app.errors];
  }
  async reset() {
    this.app = initial();
    this.rehostScenario = null;
    this.lastGoodRichCount = null;
  }
  // ---- Rich tree with rehost-collapse semantics (mirror of RealUiaBackend) ----
  /**
   * Full semantic tree of the seeded window. Applies the same collapse
   * heuristic (root-only or >90% drop versus the last good tree, baseline
   * >= 5 nodes) and the same one-attempt bounded reattach contract as the
   * real backend, driven by the injectable `rehostScenario`.
   */
  async richTree() {
    this.assertAlive();
    const stubbed = this.rehostScenario !== null && this.lastGoodRichCount !== null;
    const nodes = stubbed ? [this.richStub()] : await this.richProjection();
    if (this.isRehostCollapse(nodes.length)) {
      try {
        if (!this.rehostScenario?.replacementWindow) {
          throw new Error("no replacement top-level window for the pid");
        }
        this.rehostScenario = null;
        const fresh = await this.richProjection();
        this.lastGoodRichCount = fresh.length;
        return { pid: MOCK_SEED_PID, nodes: fresh, reattached: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new WindowsBackendError(
          "REATTACH_FAILED",
          `window rehost suspected (${this.lastGoodRichCount ?? 0} -> ${nodes.length} nodes, pid ${MOCK_SEED_PID} alive); reattach failed: ${msg}`
        );
      }
    }
    this.lastGoodRichCount = nodes.length;
    return { pid: MOCK_SEED_PID, nodes };
  }
  /** Same heuristic as RealUiaBackend.isRehostCollapse. */
  isRehostCollapse(nodeCount) {
    const prev = this.lastGoodRichCount;
    if (prev === null || prev < 5) return false;
    return nodeCount <= 1 || nodeCount * 10 < prev;
  }
  richStub() {
    return {
      id: "root",
      type: "Window",
      name: "SeedBank",
      automationId: "",
      enabled: true,
      offscreen: false,
      rect: null,
      patterns: []
    };
  }
  async richProjection() {
    const base = await this.tree();
    return base.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.text,
      automationId: n.id,
      enabled: n.enabled,
      offscreen: false,
      rect: null,
      patterns: []
    }));
  }
  /** Re-attach resets the per-session collapse baseline, like the real backend. */
  attach(_params) {
    this.lastGoodRichCount = null;
    return Promise.resolve();
  }
  detach() {
    this.lastGoodRichCount = null;
    return Promise.resolve();
  }
  // ---- Window ops (mirror the real backend's semantics for conformance) ----
  async listWindows() {
    if (this.deviceCrashed) return [];
    return [{ pid: MOCK_SEED_PID, title: "SeedBank" }];
  }
  async waitForWindow(params) {
    const requested = Math.min(Math.max(params.timeoutMs ?? 1e4, 0), 6e4);
    const deadline = Date.now() + requested;
    for (; ; ) {
      const windows = await this.listWindows();
      const found = windows.find(
        (w) => params.pid !== void 0 && w.pid === params.pid || params.titleContains !== void 0 && params.titleContains.length > 0 && w.title.includes(params.titleContains)
      );
      if (found) return found;
      if (Date.now() >= deadline) {
        throw new WindowsBackendError(
          "WINDOW_NOT_FOUND",
          `no top-level window matching ${params.pid !== void 0 ? `pid=${params.pid}` : ""}${params.pid !== void 0 && params.titleContains ? " " : ""}${params.titleContains !== void 0 ? `title~="${params.titleContains}"` : ""} within ${requested}ms`
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  async windowStatus() {
    return { alive: !this.deviceCrashed, pid: MOCK_SEED_PID };
  }
  assertAlive() {
    if (this.deviceCrashed) {
      throw new WindowsBackendError(
        "DEAD_WINDOW",
        "UIA client disconnected (injected fault)"
      );
    }
  }
};

// packages/windows-adapter/src/real-uia.ts
var RealUiaBackend = class {
  constructor(bridge) {
    this.bridge = bridge;
  }
  /**
   * Node count of the last accepted (non-collapsed) tree for this attached
   * session; null until a first successful enumeration. Reset on attach and
   * detach so each session's baseline starts fresh.
   */
  lastGoodNodeCount = null;
  async listWindows() {
    return this.bridge.request("listWindows");
  }
  /** Attach to a top-level window by pid or title substring. */
  async attach(params) {
    this.lastGoodNodeCount = null;
    await this.bridge.request("attach", params);
  }
  async detach() {
    this.lastGoodNodeCount = null;
    await this.bridge.request("detach");
  }
  /**
   * Full semantic tree of the attached window (all control types).
   *
   * Honesty gate: liveness is verified first; a dead target throws
   * DEAD_WINDOW instead of returning a stale/cached tree.
   *
   * Modal fallback: if the main window is blocked by a modal dialog the
   * bridge re-scopes enumeration to the desktop root filtered by pid (the
   * dialog is a top-level window of the same process), so the op stays
   * bounded and returns the live dialog tree. If the primary enumeration
   * still times out, one bounded desktop-root retry runs before failing.
   *
   * Rehost-collapse detection: some actions rehost content into a NEW
   * top-level HWND (e.g. Calculator "New Tab"). The process stays alive, but
   * the cached window root silently enumerates as a root-only stub — no
   * STALE_ELEMENT, no error, exploration just goes blind. When the returned
   * tree collapses versus this session's last good tree (root-only, or a
   * >90% node-count drop) while the process is still alive, the backend
   * re-resolves the process's current main window via desktop-root
   * enumeration scoped to the pid (the same machinery attach uses) and
   * returns the fresh tree with `reattached: true`. One bounded attempt
   * (~3s budget); failure raises REATTACH_FAILED rather than returning the
   * blind stub.
   */
  async richTree() {
    const status = await this.windowStatus();
    if (!status.alive) {
      if (status.pid === 0) throw new Error("NO_ATTACHED_WINDOW");
      throw new WindowsBackendError(
        "DEAD_WINDOW",
        `attached pid ${status.pid} is not running; refusing to return a stale tree`
      );
    }
    let tree;
    try {
      tree = await this.bridge.request("tree");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/bridge timeout/i.test(msg)) throw e;
      tree = await this.bridge.request("treeDesktop", { pid: status.pid });
    }
    if (this.isRehostCollapse(tree.nodes.length)) {
      const prev = this.lastGoodNodeCount ?? 0;
      try {
        const fresh = await this.attemptReattach(status.pid);
        this.lastGoodNodeCount = fresh.nodes.length;
        return { ...fresh, reattached: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new WindowsBackendError(
          "REATTACH_FAILED",
          `window rehost suspected (${prev} -> ${tree.nodes.length} nodes, pid ${status.pid} alive); reattach failed: ${msg}`
        );
      }
    }
    this.lastGoodNodeCount = tree.nodes.length;
    return tree;
  }
  /**
   * Collapse heuristic: suspicious when the previous good enumeration had at
   * least 5 nodes and the new result is root-only (<=1) or lost >90% of its
   * nodes. The minimum baseline avoids false positives on trivially small
   * trees where a 1-node swing looks like a collapse.
   */
  isRehostCollapse(nodeCount) {
    const prev = this.lastGoodNodeCount;
    if (prev === null || prev < 5) return false;
    return nodeCount <= 1 || nodeCount * 10 < prev;
  }
  /**
   * One bounded reattach attempt: resolve the process's current top-level
   * window, re-attach (the bridge re-resolves the pid's main window from the
   * desktop root), and re-enumerate. ~3s total budget.
   */
  async attemptReattach(pid) {
    const budget = new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error("reattach budget (3000ms) exceeded")), 3e3);
      t.unref?.();
    });
    const work = (async () => {
      const windows = await this.listWindows();
      if (!windows.some((w) => w.pid === pid)) {
        throw new Error(`no top-level window remains for pid ${pid}`);
      }
      await this.attach({ pid });
      return this.bridge.request("tree");
    })();
    return Promise.race([work, budget]);
  }
  /**
   * Bounded poll (250ms interval) until a top-level window matching pid or
   * title substring appears. Throws WINDOW_NOT_FOUND on timeout. Handles the
   * UWP launcher-pid gap where a freshly spawned calc/mspaint is absent from
   * the top-level window list for several seconds.
   */
  async waitForWindow(params) {
    const requested = Math.min(Math.max(params.timeoutMs ?? 1e4, 0), 6e4);
    const deadline = Date.now() + requested;
    for (; ; ) {
      let windows = [];
      try {
        windows = await this.listWindows();
      } catch {
      }
      const found = windows.find(
        (w) => params.pid !== void 0 && w.pid === params.pid || params.titleContains !== void 0 && params.titleContains.length > 0 && w.title.includes(params.titleContains)
      );
      if (found) return found;
      if (Date.now() >= deadline) {
        throw new WindowsBackendError(
          "WINDOW_NOT_FOUND",
          `no top-level window matching ${params.pid !== void 0 ? `pid=${params.pid}` : ""}${params.pid !== void 0 && params.titleContains ? " " : ""}${params.titleContains !== void 0 ? `title~="${params.titleContains}"` : ""} within ${requested}ms`
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  async invoke(rid) {
    await this.bridge.request("invoke", { rid });
  }
  async toggle(rid) {
    await this.bridge.request("toggle", { rid });
  }
  async expandCollapse(rid, action) {
    await this.bridge.request("expandCollapse", { rid, action });
  }
  async setValue(rid, value) {
    await this.bridge.request("setValue", { rid, value });
  }
  async select(rid) {
    await this.bridge.request("select", { rid });
  }
  async readValue(rid) {
    const r = await this.bridge.request("readValue", { rid });
    return r.value;
  }
  async readToggleState(rid) {
    const r = await this.bridge.request("readToggleState", { rid });
    return r.state;
  }
  async closeWindow() {
    await this.bridge.request("closeWindow");
  }
  /** Liveness of the attached window and its owning process. */
  async windowStatus() {
    return this.bridge.request("windowStatus");
  }
  // ---- UiaBackend contract (same interface as MockUiaBackend) ----
  /**
   * Semantic tree projected onto the common UiaNode shape. Attaches lazily to
   * the first titled top-level window when nothing is attached yet.
   * Control types outside Button/Edit/Text are omitted from this projection;
   * use richTree() for the full semantic tree.
   */
  async tree() {
    let tree;
    try {
      tree = await this.richTree();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("NO_ATTACHED_WINDOW")) throw e;
      const windows = await this.listWindows();
      const target = windows.find((w) => w.title.trim().length > 0) ?? windows[0];
      if (!target) throw new Error("no enumerable top-level window");
      await this.attach({ pid: target.pid });
      tree = await this.richTree();
    }
    return tree.nodes.filter((n) => n.type === "Button" || n.type === "Edit" || n.type === "Text" || n.type === "Document").map((n) => ({
      id: n.id,
      type: n.type === "Button" ? "Button" : n.type === "Text" ? "Text" : "Edit",
      text: n.name,
      enabled: n.enabled
    }));
  }
  /** Real applications do not expose seeded fault records. */
  async errors() {
    return [];
  }
  /** Detach so the next tree() re-attaches to a fresh window. */
  async reset() {
    await this.detach();
  }
  /** Kill the PowerShell host. Callers must dispose to avoid orphans. */
  dispose() {
    this.bridge.dispose();
  }
};

// packages/windows-adapter/src/uia-bridge.ts
import { spawn } from "node:child_process";
var UIA_BRIDGE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = [System.Windows.Automation.AutomationElement]::RootElement
$script:window = $null
$script:attachedPid = 0

function Send-Result($id, $ok, $result, $error) {
  $payload = @{ id = $id; ok = $ok }
  if ($ok) { $payload['result'] = $result } else { $payload['error'] = $error }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 8))
}

function Test-RuntimeIdEqual($a, $b) {
  if ($a.Length -ne $b.Length) { return $false }
  for ($i = 0; $i -lt $a.Length; $i++) {
    if ($a[$i] -ne $b[$i]) { return $false }
  }
  return $true
}

function Get-WindowCondition {
  return New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
}

function Get-TopWindows {
  $wins = @()
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, (Get-WindowCondition))
  foreach ($w in $all) {
    try {
      $c = $w.Current
      if ($c.IsEnabled) {
        $wins += @{ pid = $c.ProcessId; title = $c.Name }
      }
    } catch {}
  }
  return $wins
}

function Test-AttachedAlive {
  if ($null -eq $script:window) { return $false }
  try { $null = $script:window.Current.ProcessId } catch { return $false }
  $p = Get-Process -Id $script:attachedPid -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# Enumerate every top-level window owned by the given pid, starting from the
# desktop root. Used as the bounded fallback when the cached main-window
# subtree is blocked by a modal dialog: the dialog itself is a top-level
# window of the same process, so this returns the live dialog tree.
function Get-TreeFromDesktopPid($targetPid) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    [int]$targetPid)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $nodes = @()
  $max = 800
  foreach ($w in $wins) {
    $subtree = $null
    try {
      $subtree = $w.FindAll([System.Windows.Automation.TreeScope]::Subtree,
        [System.Windows.Automation.Condition]::TrueCondition)
    } catch { continue }
    foreach ($e in $subtree) {
      if ($nodes.Count -ge $max) { break }
      try { $nodes += (Get-NodeInfo $e) } catch {}
    }
    if ($nodes.Count -ge $max) { break }
  }
  return $nodes
}

function Get-ElementByRuntimeId($ridString) {
  if ($null -eq $script:window) { throw 'STALE_ELEMENT: no attached window' }
  $rid = $ridString -split '-' | ForEach-Object { [int]$_ }
  $all = $null
  try {
    $all = $script:window.FindAll([System.Windows.Automation.TreeScope]::Subtree,
      [System.Windows.Automation.Condition]::TrueCondition)
  } catch {
    throw 'STALE_ELEMENT: attached window is gone'
  }
  foreach ($e in $all) {
    if (Test-RuntimeIdEqual ($e.GetRuntimeId()) $rid) { return $e }
  }
  throw ('STALE_ELEMENT: runtime id not found in current tree: ' + $ridString)
}

function Get-Pattern($e, $pattern, $name) {
  try {
    return $e.GetCurrentPattern($pattern)
  } catch {
    throw ('PATTERN_UNSUPPORTED: ' + $name)
  }
}

function Get-NodeInfo($e) {
  $patterns = @()
  foreach ($p in $e.GetSupportedPatterns()) { $patterns += $p.ProgrammaticName }
  $rect = $null
  try {
    $r = $e.Current.BoundingRectangle
    if (-not $r.IsEmpty) {
      $rect = @{ x = [double]$r.X; y = [double]$r.Y; w = [double]$r.Width; h = [double]$r.Height }
    }
  } catch {}
  $rid = ($e.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '-'
  $c = $e.Current
  return @{
    id = $rid
    type = $c.ControlType.ProgrammaticName.Replace('ControlType.', '')
    name = $c.Name
    automationId = $c.AutomationId
    enabled = [bool]$c.IsEnabled
    offscreen = [bool]$c.IsOffscreen
    rect = $rect
    patterns = $patterns
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $result = $null
    switch ($req.op) {
      'ping' {
        $result = 'pong'
      }
      'listWindows' {
        $result = Get-TopWindows
      }
      'attach' {
        $matchPid = $req.params.pid
        $title = $req.params.titleContains
        $found = $null
        foreach ($w in (Get-TopWindows)) {
          if ($matchPid -and ($w.pid -eq $matchPid)) { $found = $w; break }
          if ($title -and ($w.title -like ('*' + $title + '*'))) { $found = $w; break }
        }
        if ($null -eq $found) { throw 'WINDOW_NOT_FOUND' }
        $cond = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
          [int]$found.pid)
        $candidates = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        $winEl = $null
        foreach ($cand in $candidates) {
          if ((Test-RuntimeIdEqual ($cand.GetRuntimeId()) @()) -eq $true) { continue }
          $winEl = $cand
          break
        }
        if ($null -eq $winEl) { throw 'WINDOW_NOT_FOUND' }
        $script:window = $winEl
        $script:attachedPid = $found.pid
        $result = Get-NodeInfo $winEl
      }
      'detach' {
        $script:window = $null
        $script:attachedPid = 0
        $result = $true
      }
      'tree' {
        if ($null -eq $script:window) { throw 'NO_ATTACHED_WINDOW' }
        # Liveness gate: never return a stale/cached tree for a dead target.
        if (-not (Test-AttachedAlive)) {
          throw ('DEAD_WINDOW: attached pid ' + $script:attachedPid + ' is not running')
        }
        # Modal probe: when the main window is blocked by a modal dialog its
        # own subtree stops responding, so fall back to enumerating from the
        # desktop root scoped to the attached pid (returns the dialog tree).
        $scopeEl = $script:window
        $modalBlocking = $false
        try {
          $wp = $script:window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
          if ($wp.Current.WindowInteractionState -eq
            [System.Windows.Automation.WindowInteractionState]::BlockedByModalWindow) {
            $modalBlocking = $true
          }
        } catch {}
        $nodes = @()
        if ($modalBlocking) {
          $nodes = Get-TreeFromDesktopPid $script:attachedPid
        } else {
          $all = $null
          try {
            $all = $scopeEl.FindAll([System.Windows.Automation.TreeScope]::Subtree,
              [System.Windows.Automation.Condition]::TrueCondition)
          } catch {
            throw 'STALE_ELEMENT: attached window is gone'
          }
          $max = 800
          $i = 0
          foreach ($e in $all) {
            if ($i -ge $max) { break }
            try { $nodes += (Get-NodeInfo $e) } catch {}
            $i++
          }
        }
        $result = @{ pid = $script:attachedPid; nodes = $nodes; modalBlocking = $modalBlocking }
      }
      'treeDesktop' {
        # Bounded desktop-root enumeration scoped to a pid; used by the
        # backend as fallback when the primary tree op times out.
        $targetPid = [int]$req.params.pid
        if ($targetPid -le 0) { throw 'VALIDATION: pid required' }
        $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if ($null -eq $p) { throw ('DEAD_WINDOW: pid ' + $targetPid + ' is not running') }
        $nodes = Get-TreeFromDesktopPid $targetPid
        $result = @{ pid = $targetPid; nodes = $nodes; modalBlocking = $true }
      }
      'invoke' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.InvokePattern]::Pattern) 'Invoke'
        $pat.Invoke()
        $result = $true
      }
      'toggle' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern) 'Toggle'
        $pat.Toggle()
        $result = $true
      }
      'expandCollapse' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern) 'ExpandCollapse'
        if ($req.params.action -eq 'collapse') { $pat.Collapse() } else { $pat.Expand() }
        $result = $true
      }
      'setValue' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.ValuePattern]::Pattern) 'Value'
        $pat.SetValue([string]$req.params.value)
        $result = $true
      }
      'select' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.SelectionItemPattern]::Pattern) 'SelectionItem'
        $pat.Select()
        $result = $true
      }
      'readValue' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $value = $e.Current.Name
        try {
          $pat = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $value = $pat.Current.Value
        } catch {}
        $result = @{ value = $value }
      }
      'readToggleState' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern) 'Toggle'
        $result = @{ state = [string]$pat.Current.ToggleState }
      }
      'closeWindow' {
        if ($null -eq $script:window) { throw 'NO_ATTACHED_WINDOW' }
        $pat = Get-Pattern $script:window ([System.Windows.Automation.WindowPattern]::Pattern) 'Window'
        $pat.Close()
        $result = $true
      }
      'windowStatus' {
        $alive = Test-AttachedAlive
        $result = @{ alive = $alive; pid = $script:attachedPid }
      }
      default {
        throw ('UNKNOWN_OP: ' + $req.op)
      }
    }
    Send-Result $req.id $true $result $null
  } catch {
    $errId = $null
    if ($null -ne $req) { $errId = $req.id }
    Send-Result $errId $false $null $_.Exception.Message
  }
}
`;
var PowerShellUiaBridge = class {
  child = null;
  nextId = 1;
  buffer = "";
  stderrTail = [];
  pending = /* @__PURE__ */ new Map();
  timeoutMs;
  powershellPath;
  disposed = false;
  /** PID of the spawned host, retained after dispose for orphan checks. */
  lastPid = null;
  constructor(opts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5e3;
    this.powershellPath = opts.powershellPath ?? "powershell.exe";
  }
  /** PID of the spawned PowerShell host (retained after dispose), or null. */
  get childPid() {
    return this.child?.pid ?? this.lastPid;
  }
  ensureStarted() {
    if (this.child) return this.child;
    if (this.disposed) throw new Error("bridge disposed");
    const encoded = Buffer.from(UIA_BRIDGE_SCRIPT, "utf16le").toString("base64");
    const child = spawn(
      this.powershellPath,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    this.child = child;
    this.lastPid = child.pid ?? null;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.onData(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    child.on("exit", () => this.failAllPending(new Error("UIA bridge exited unexpectedly")));
    child.on("error", (err) => this.failAllPending(err));
    return child;
  }
  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      this.onMessage(line);
    }
  }
  onMessage(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const id = typeof msg.id === "string" ? msg.id : void 0;
    if (id === void 0) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (msg.ok === true) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(String(msg.error ?? "unknown bridge error")));
    }
  }
  failAllPending(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
  async request(op, params) {
    const child = this.ensureStarted();
    const id = String(this.nextId++);
    const line = JSON.stringify({ id, op, params: params ?? {} }) + "\n";
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UIA bridge timeout after ${this.timeoutMs}ms (op=${op})`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: resolve2,
        reject,
        timer
      });
      try {
        child.stdin?.write(line);
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  /** Kill the PowerShell host and reject everything still in flight. */
  dispose() {
    this.disposed = true;
    this.failAllPending(new Error("bridge disposed"));
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
    }
    try {
      child.kill();
    } catch {
    }
    const pid = child.pid;
    setTimeout(() => {
      try {
        if (pid) spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } catch {
      }
    }, 1500).unref?.();
  }
  /** Recent stderr output from the PowerShell host, for diagnostics. */
  recentStderr() {
    return this.stderrTail.join("");
  }
};

// packages/windows-adapter/src/selection.ts
var WINDOWS_BACKEND_ENV = "INSPECTOR_WINDOWS_BACKEND";
async function probeRealUia() {
  const script = "Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $c = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window))); if ($c.Count -ge 1) { Write-Output OK } else { exit 1 }";
  return new Promise((resolve2) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve2(v);
      }
    };
    const child = spawn2(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")
      ],
      { stdio: "ignore", windowsHide: true }
    );
    const timer = setTimeout(() => {
      done(false);
      try {
        child.kill();
      } catch {
      }
    }, 1e4);
    timer.unref?.();
    child.on("error", () => done(false));
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}
async function selectWindowsBackend(env = process.env, deps = {}) {
  const mode = env[WINDOWS_BACKEND_ENV] ?? "auto";
  const probe = deps.probe ?? probeRealUia;
  const log = deps.log ?? ((m) => console.warn(m));
  if (mode === "mock") return { kind: "mock", backend: new MockUiaBackend() };
  if (mode === "real") return { kind: "real", backend: deps.makeReal?.() ?? makeRealBackend() };
  if (mode !== "auto") throw new Error(`invalid ${WINDOWS_BACKEND_ENV} value: ${mode}`);
  if (await probe()) return { kind: "real", backend: deps.makeReal?.() ?? makeRealBackend() };
  const warning = `${WINDOWS_BACKEND_ENV}=auto: real UIA unavailable (probe failed); falling back to the injectable mock backend`;
  log(warning);
  return { kind: "mock", backend: new MockUiaBackend(), warning };
}
function makeRealBackend() {
  return new RealUiaBackend(new PowerShellUiaBridge());
}

// packages/windows-adapter/src/bin.ts
var selection = await selectWindowsBackend();
var handler = new WindowsAdapterHandler(selection.backend);
var realBackend = selection.kind === "real" ? selection.backend : null;
var server = new AdapterServer(process.stdin, process.stdout, handler);
var shutdown = () => {
  realBackend?.dispose();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.stdout.on("error", () => process.exit(0));
//# sourceMappingURL=inspector-adapter-windows.js.map
