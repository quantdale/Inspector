import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import { type ValidateFunction } from "ajv";
import { PROTOCOL_VERSION } from "./version.js";
import { ID_PATTERN } from "./ids.js";

// NodeNext resolves these CommonJS packages' default exports as the module namespace; obtain the callable.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as new (
  opts?: Record<string, unknown>,
) => AjvInstance;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: AjvInstance) => void;

interface AjvInstance {
  compile(schema: unknown): ValidateFunction;
  addFormat(name: string, format: unknown): void;
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

export const actionSchema = {
  $id: "https://inspector.local/schema/action-0.1.json",
  type: "object",
  required: ["id", "runId", "environmentId", "kind", "risk", "deadlineMs", "idempotency"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN.source },
    runId: { type: "string", pattern: ID_PATTERN.source },
    environmentId: { type: "string", pattern: ID_PATTERN.source },
    kind: { type: "string", minLength: 1 },
    risk: {
      enum: ["observe", "interact", "mutate-test-state", "modify-source", "publish"],
    },
    deadlineMs: { type: "integer", minimum: 1 },
    idempotency: {
      enum: ["safe-retry", "observe-before-retry", "never-retry"],
    },
    target: { type: ["object", "null"] },
    input: { type: ["object", "null"] },
    metadata: { type: "object" },
  },
  additionalProperties: false,
} as const;

export const observationSchema = {
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
          path: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export const observeRequestSchema = {
  $id: "https://inspector.local/schema/observe-request-0.1.json",
  type: "object",
  required: ["observe"],
  properties: {
    observe: { type: "array", items: { type: "string", minLength: 1 } },
    options: { type: "object" },
  },
} as const;

export const capabilityDocSchema = {
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
        coverage: { type: "array", items: { type: "string", minLength: 1 } },
        vocabulary: {
          type: "array",
          items: {
            type: "object",
            required: ["kind", "risk", "autonomousEligible"],
            properties: {
              kind: { type: "string", minLength: 1 },
              targetScheme: {
                enum: ["css", "uia-runtime-id", "android-resource-id", "pty-input"],
              },
              risk: {
                enum: ["observe", "interact", "mutate-test-state", "external-side-effect"],
              },
              autonomousEligible: { type: "boolean" },
              description: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export const adapterEventSchema = {
  $id: "https://inspector.local/schema/adapter-event-0.1.json",
  type: "object",
  required: ["sequence", "runId", "environmentId", "type", "timestamp", "payload"],
  properties: {
    sequence: { type: "integer", minimum: 0 },
    runId: { type: "string", pattern: ID_PATTERN.source },
    environmentId: { type: "string", pattern: ID_PATTERN.source },
    stepId: { type: ["string", "null"] },
    type: {
      enum: ["observation", "action-outcome", "health", "log", "artifact", "lifecycle"],
    },
    timestamp: { type: "string", format: "date-time" },
    payload: {},
  },
  additionalProperties: false,
} as const;

export const envelopeSchema = {
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
        detail: {},
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

interface CompiledValidators {
  action: ValidateFunction;
  observation: ValidateFunction;
  observeRequest: ValidateFunction;
  capabilityDoc: ValidateFunction;
  adapterEvent: ValidateFunction;
  envelope: ValidateFunction;
}

const compiled: CompiledValidators = {
  action: ajv.compile(actionSchema),
  observation: ajv.compile(observationSchema),
  observeRequest: ajv.compile(observeRequestSchema),
  capabilityDoc: ajv.compile(capabilityDocSchema),
  adapterEvent: ajv.compile(adapterEventSchema),
  envelope: ajv.compile(envelopeSchema),
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function run(validate: ValidateFunction, data: unknown): ValidationResult {
  const ok = validate(data);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
  );
  return { ok: false, errors };
}

export function validateAction(data: unknown): ValidationResult {
  return run(compiled.action, data);
}

export function validateObservation(data: unknown): ValidationResult {
  return run(compiled.observation, data);
}

export function validateObserveRequest(data: unknown): ValidationResult {
  return run(compiled.observeRequest, data);
}

export function validateCapabilityDoc(data: unknown): ValidationResult {
  return run(compiled.capabilityDoc, data);
}

export function validateAdapterEvent(data: unknown): ValidationResult {
  return run(compiled.adapterEvent, data);
}

export function validateEnvelope(data: unknown): ValidationResult {
  return run(compiled.envelope, data);
}
