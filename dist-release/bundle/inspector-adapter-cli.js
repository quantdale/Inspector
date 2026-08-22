var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/cli-adapter/src/node-pty-backend.ts
var node_pty_backend_exports = {};
__export(node_pty_backend_exports, {
  NodePtyBackend: () => NodePtyBackend,
  armPtyExitGuard: () => armPtyExitGuard
});
function armPtyExitGuard(delayMs = 2e3) {
  const t = setTimeout(() => {
    process.exit(process.exitCode ?? 0);
  }, delayMs);
  t.unref();
}
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g, "");
}
var SCREEN_HEIGHT2, SCREEN_WIDTH, MAX_SCROLLBACK, NodePtyBackend;
var init_node_pty_backend = __esm({
  "packages/cli-adapter/src/node-pty-backend.ts"() {
    "use strict";
    SCREEN_HEIGHT2 = 12;
    SCREEN_WIDTH = 120;
    MAX_SCROLLBACK = 1e3;
    NodePtyBackend = class {
      sessions = /* @__PURE__ */ new Map();
      seq = 0;
      async spawn(program2, args = []) {
        let pty;
        try {
          pty = await import("@lydell/node-pty");
        } catch (e) {
          throw new Error(
            `node-pty backend unavailable (native binding failed to load): ${e instanceof Error ? e.message : String(e)}`
          );
        }
        let proc;
        try {
          proc = pty.spawn(program2, args, {
            name: "xterm-color",
            cols: SCREEN_WIDTH,
            rows: SCREEN_HEIGHT2,
            cwd: process.cwd(),
            env: process.env
          });
        } catch (e) {
          throw new Error(`pty spawn failed for ${program2}: ${e instanceof Error ? e.message : String(e)}`);
        }
        const id = `pty-${this.seq++}`;
        const s = { id, pty: proc, lines: [], pending: "", alive: true };
        proc.onData((data) => this.onOutput(s, data));
        proc.onExit(({ exitCode }) => {
          s.alive = false;
          s.exitReason = `exit code ${exitCode}`;
        });
        this.sessions.set(id, s);
        return { id };
      }
      async write(sessionId, data) {
        const s = this.sessions.get(sessionId);
        if (!s || !s.alive) {
          const m = new Error("write failed: session closed");
          m.miss = true;
          throw m;
        }
        s.pty.write(data.replace(/\n/g, "\r"));
      }
      async readScreen(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s) throw new Error("no such session");
        const all = [...s.lines, ...s.pending ? [s.pending] : []];
        const tail = all.slice(-(SCREEN_HEIGHT2 - 1));
        const padded = [...tail];
        while (padded.length < SCREEN_HEIGHT2 - 1) padded.push("");
        return [...padded];
      }
      async isAlive(sessionId) {
        return this.sessions.get(sessionId)?.alive ?? false;
      }
      async kill(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s) return;
        if (s.alive) {
          s.alive = false;
          s.exitReason = "killed";
          try {
            s.pty.kill();
          } catch {
          }
        }
        if (!s.alive) {
          const agent = s.pty._agent;
          try {
            agent?._conoutSocketWorker?.dispose();
          } catch {
          }
          try {
            agent?._outSocket?.destroy();
          } catch {
          }
        }
      }
      onOutput(s, data) {
        const text = stripAnsi(data);
        const parts = text.split(/\r?\n/);
        s.pending += parts[0];
        for (let i = 1; i < parts.length; i++) {
          s.lines.push(s.pending);
          if (s.lines.length > MAX_SCROLLBACK) s.lines.splice(0, s.lines.length - MAX_SCROLLBACK);
          s.pending = parts[i] ?? "";
        }
      }
    };
  }
});

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

// packages/cli-adapter/src/cli-adapter.ts
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync as mkdirSync2, mkdtempSync } from "node:fs";
var CLI_CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "cli-pty",
  capabilities: {
    observe: ["uiTree"],
    act: ["fill", "press", "fault"],
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
var CliAdapterHandler = class {
  constructor(backend, artifactBaseDir = join2(tmpdir(), "inspector-cli-artifacts"), program2 = "seedcli") {
    this.backend = backend;
    this.program = program2;
    mkdirSync2(artifactBaseDir, { recursive: true });
    this.artifactDir = mkdtempSync(join2(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(this.artifactDir);
    void this.artifacts;
  }
  sessionId = null;
  artifacts;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  artifactDir;
  runId = "run";
  environmentId = "env";
  seq = 0;
  async initialize() {
    return CLI_CAPABILITIES;
  }
  async lifecycle(params) {
    switch (params.op) {
      case "create":
      case "reset": {
        this.applyAttribution(params.options);
        if (this.sessionId) await this.backend.kill(this.sessionId).catch(() => void 0);
        const session = await this.backend.spawn(this.program);
        this.sessionId = session.id;
        return { ok: true };
      }
      case "close": {
        if (this.sessionId) await this.backend.kill(this.sessionId).catch(() => void 0);
        this.sessionId = null;
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }
  async observe(params = {}) {
    if (!this.sessionId) throw new Error("environment not created");
    void params;
    const screen = await this.backend.readScreen(this.sessionId);
    const alive = await this.backend.isAlive(this.sessionId);
    const mode = !alive ? "mode-exited" : screen[0]?.startsWith("guest>") ? "mode-guest" : "mode-auth";
    const uiTree = [
      { tag: "line", role: "text", id: mode, name: mode, text: stripUrlCredentialsInText(screen[0] ?? "") },
      ...screen.map((rawText, i) => ({
        tag: "line",
        role: "text",
        id: `line-${i}`,
        name: `line-${i}`,
        text: stripUrlCredentialsInText(rawText)
      }))
    ];
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-cli-pty",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      summary: { url: `pty://seedcli`, title: "SeedCLI", uiTree, storage: {} }
    };
  }
  async act(params) {
    if (!this.sessionId) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const sessionId = this.sessionId;
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      stateAfter: `pty://${sessionId}`
    };
    try {
      if (action.kind === "fault") {
        const fault = String(action.input?.fault ?? "");
        const allowed = CLI_CAPABILITIES.capabilities.faults ?? [];
        if (!allowed.includes(fault)) {
          throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
        }
        throw new AdapterCrashError("adapter-crash: pty backend lost (injected fault)");
      }
      const wasAlive = await this.backend.isAlive(sessionId);
      if (!wasAlive) {
        return { ...base, status: "target-failure", error: await this.deadSessionError(sessionId) };
      }
      const missesBefore = await this.missesOf(sessionId);
      switch (action.kind) {
        case "fill":
          await this.backend.write(sessionId, `${String(action.input?.value ?? "")}
`);
          break;
        case "press":
          await this.backend.write(sessionId, "\n");
          break;
        default:
          throw protocolError("VALIDATION", `unknown cli action: ${action.kind}`);
      }
      const alive = await this.backend.isAlive(sessionId);
      if (!alive) {
        return { ...base, status: "target-failure", error: await this.deadSessionError(sessionId) };
      }
      const missesAfter = await this.missesOf(sessionId);
      const freshMiss = freshError(missesBefore, missesAfter);
      if (freshMiss) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "ACTION_FAILED", message: freshMiss }
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
    return { ok: this.sessionId !== null, uptimeMs: 0, now: (/* @__PURE__ */ new Date()).toISOString() };
  }
  async cancel() {
  }
  async missesOf(sessionId) {
    const backend = this.backend;
    return backend.misses ? backend.misses(sessionId) : [];
  }
  /**
   * Explain a dead session for outcome classification. A FATAL screen line or
   * an application exit reason is a genuine target defect (TARGET_FAILURE);
   * normal exits ("quit") and external kills are automation failures.
   */
  async deadSessionError(sessionId) {
    try {
      const screen = await this.backend.readScreen(sessionId);
      const fatal = screen.find((l) => l.startsWith("FATAL"));
      if (fatal) return { code: "TARGET_FAILURE", message: fatal };
    } catch {
    }
    const exitReason = this.sessionFor(sessionId)?.exitReason;
    if (exitReason && exitReason !== "killed" && exitReason !== "quit") {
      return { code: "TARGET_FAILURE", message: exitReason };
    }
    return { code: "ACTION_FAILED", message: "session not alive" };
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
  sessionFor(sessionId) {
    const backend = this.backend;
    return backend.sessionFor?.(sessionId);
  }
};

// packages/cli-adapter/src/mock-pty.ts
var SCREEN_HEIGHT = 12;
var MockPtyBackend = class {
  deviceCrashed = false;
  sessions = /* @__PURE__ */ new Map();
  seq = 0;
  async spawn(program2) {
    this.assertAlive();
    if (program2 !== "seedcli") throw new Error(`unknown program: ${program2}`);
    const id = `pty-${this.seq++}`;
    const s = {
      id,
      lines: ["SeedCLI 1.0", "type 'help' for commands", ""],
      mode: "guest",
      user: "",
      count: 0,
      alive: true,
      misses: []
    };
    this.sessions.set(id, s);
    return { id };
  }
  async write(sessionId, data) {
    this.assertAlive();
    const s = this.sessions.get(sessionId);
    if (!s || !s.alive) {
      const m = new Error("write failed: session closed");
      m.miss = true;
      throw m;
    }
    for (const rawLine of data.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      this.exec(s, line);
    }
  }
  async readScreen(sessionId) {
    this.assertAlive();
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("no such session");
    const prompt = s.alive ? s.mode === "auth" ? `${s.user}@seedcli>` : "guest>" : "[process exited]";
    const tail = s.lines.slice(-(SCREEN_HEIGHT - 1));
    const padded = [...tail];
    while (padded.length < SCREEN_HEIGHT - 1) padded.push("");
    return [prompt, ...padded];
  }
  async isAlive(sessionId) {
    return this.sessions.get(sessionId)?.alive ?? false;
  }
  async kill(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.alive = false;
      s.exitReason = "killed";
    }
  }
  /** Automation-miss markers recorded by the app (command not found etc.). */
  async misses(sessionId) {
    return [...this.sessions.get(sessionId)?.misses ?? []];
  }
  /** Diagnostic hook used by tests. */
  sessionFor(sessionId) {
    return this.sessions.get(sessionId);
  }
  assertAlive() {
    if (this.deviceCrashed) throw new Error("pty backend lost (injected fault)");
  }
  exec(s, line) {
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd) {
      case "help":
        s.lines.push("commands: login <user> <pass>, count, inc, boom, quit");
        return;
      case "login": {
        const user = args[0] ?? "";
        if (user.length >= 64 || user === "CRASH") {
          s.lines.push("FATAL HiddenValidationCrash");
          s.alive = false;
          s.exitReason = "HiddenValidationCrash";
          return;
        }
        if (!args[0] || !args[1]) {
          s.misses.push("login requires <user> <pass>");
          s.lines.push("usage: login <user> <pass>");
          return;
        }
        s.user = user;
        s.mode = "auth";
        s.lines.push(`welcome ${user}`);
        return;
      }
      case "count":
        if (s.mode !== "auth") {
          s.misses.push("not authenticated");
          s.lines.push("error: login first");
          return;
        }
        s.lines.push(`count=${Number.isNaN(s.count) ? "NaN" : String(s.count)}`);
        return;
      case "inc": {
        if (s.mode !== "auth") {
          s.misses.push("not authenticated");
          s.lines.push("error: login first");
          return;
        }
        s.count += 1;
        if (s.count >= 8) {
          s.count = Number.NaN;
          s.lines.push("count=NaN");
          s.lines.push("FATAL IncrementOverflowCrash");
          s.alive = false;
          s.exitReason = "IncrementOverflowCrash";
          return;
        }
        s.lines.push(`count=${s.count}`);
        return;
      }
      case "boom":
        s.lines.push("FATAL IntentionalAppCrash");
        s.alive = false;
        s.exitReason = "IntentionalAppCrash";
        return;
      case "quit":
        s.alive = false;
        s.exitReason = "quit";
        return;
      default:
        s.misses.push(`command not found: ${cmd}`);
        s.lines.push(`command not found: ${cmd}`);
        return;
    }
  }
};

// packages/cli-adapter/src/bin.ts
init_node_pty_backend();
async function selectBackend() {
  if (process.env.INSPECTOR_PTY === "real") {
    const { NodePtyBackend: NodePtyBackend2 } = await Promise.resolve().then(() => (init_node_pty_backend(), node_pty_backend_exports));
    return new NodePtyBackend2();
  }
  return new MockPtyBackend();
}
var program = process.env.INSPECTOR_CLI_PROGRAM ?? "seedcli";
var usingRealPty = process.env.INSPECTOR_PTY === "real";
var handler = new CliAdapterHandler(await selectBackend(), void 0, program);
var server = new AdapterServer(process.stdin, process.stdout, handler);
if (usingRealPty) {
  const arm = () => {
    server.close();
    armPtyExitGuard();
  };
  process.stdin.once("end", arm);
  process.stdin.once("close", arm);
}
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.stdout.on("error", () => process.exit(0));
//# sourceMappingURL=inspector-adapter-cli.js.map
