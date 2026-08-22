// packages/adapter-fake/src/handler.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir } from "node:os";
import process2 from "node:process";

// packages/protocol/src/version.ts
var PROTOCOL_VERSION = "0.1";

// packages/protocol/src/ids.ts
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

// packages/adapter-fake/src/handler.ts
var FAKE_CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "adapter-fake",
  capabilities: {
    observe: ["uiTree", "state"],
    act: [
      "openForm",
      "fillField",
      "submit",
      "retry",
      "goHome",
      "toggleFlag",
      "createArtifact",
      "reset"
    ],
    lifecycle: ["create", "reset", "close"],
    faults: ["timeout", "crash"],
    coverage: []
  }
};
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
var FakeAdapterHandler = class {
  sm = new FakeStateMachine();
  faults;
  artifactStore;
  sequence = 0;
  startTime = Date.now();
  constructor(opts = {}) {
    this.faults = opts.faults ?? {};
    const base = opts.artifactBaseDir ?? join2(tmpdir(), "inspector-fake-artifacts");
    mkdirSync2(base, { recursive: true });
    this.artifactStore = new ArtifactStore(base);
  }
  async initialize() {
    return FAKE_CAPABILITIES;
  }
  async observe(params) {
    const summary = this.sm.snapshot();
    if (params.observe?.includes("uiTree")) {
      summary.uiTree = [{ role: "button", name: "submit" }];
    }
    return {
      id: `obs_${this.sequence}`,
      runId: "run",
      environmentId: "env",
      sequence: this.sequence++,
      source: "adapter-fake",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      summary
    };
  }
  async act(params) {
    const action = params.action;
    if (this.faults.crashActionId && action.id === this.faults.crashActionId) {
      process2.exit(1);
    }
    if (this.faults.timeoutActionIds?.includes(action.id)) {
      await delay(this.faults.timeoutMs ?? 3e4);
    }
    const result = this.sm.apply({ kind: action.kind, input: action.input });
    const artifactRefs = [];
    if (action.kind === "createArtifact") {
      const stub = Buffer.from(`artifact stub for ${action.id}`);
      const meta = this.artifactStore.write({
        runId: action.runId,
        content: stub,
        mime: "application/octet-stream",
        name: `stub-${action.id}`
      });
      artifactRefs.push(meta.sha256);
    }
    const outcome = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      status: result.status === "target-failure" ? "target-failure" : "success",
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      stateAfter: result.nextState,
      artifactRefs
    };
    if (result.status === "target-failure") {
      outcome.error = {
        code: "TARGET_FAILURE",
        message: result.oracleSignal ?? "deterministic oracle failure",
        detail: result.summary
      };
    }
    return outcome;
  }
  async lifecycle(params) {
    if (params.op === "reset") this.sm.reset();
    return { ok: true };
  }
  async health(params) {
    return {
      ok: true,
      echo: params.echo,
      uptimeMs: Date.now() - this.startTime,
      now: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async cancel() {
  }
  stubHash(content) {
    return createHash2("sha256").update(content).digest("hex");
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

// packages/adapter-fake/src/bin.ts
function parseFaults() {
  const raw = process.env.FAKE_FAULTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
var handler = new FakeAdapterHandler({ faults: parseFaults() });
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
//# sourceMappingURL=inspector-adapter-fake.js.map
