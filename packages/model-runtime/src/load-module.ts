import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isModelRole, type ModelProvider } from "./types.js";

/**
 * Shared local-provider module loader (M13 F14).
 *
 * TRUST BOUNDARY: a local provider module executes arbitrary code inside the
 * Inspector process. Loading one is TRUSTED OPERATOR CONFIGURATION — it is
 * explicitly NOT sandboxed. Only explicit operator-supplied paths are ever
 * loaded; there is no path inference, no discovery of modules from target
 * content, and load errors are redacted by the caller before display.
 *
 * Accepted module shapes (ESM via dynamic import, CJS via require):
 * - `{ createModelProviders(context?) => ModelProvider[] | ModelProvider }`
 * - `{ modelProviders: ModelProvider[] }`
 * - `{ default: <any of the above> }`
 * Each resulting entry is runtime-validated against the ModelProvider shape.
 */
export interface LoadProviderModuleOptions {
  /** Redacts error text before it is embedded in thrown messages. */
  redact?: (text: string) => string;
  /** Context handed to `createModelProviders` factories (attribution etc.). */
  context?: unknown;
}

export class ProviderModuleError extends Error {
  readonly classification:
    | "provider-load-failed"
    | "invalid-provider";
  constructor(classification: "provider-load-failed" | "invalid-provider", message: string) {
    super(message);
    this.name = "ProviderModuleError";
    this.classification = classification;
  }
}

export async function loadModelProviderModule(
  modulePath: string,
  options: LoadProviderModuleOptions = {},
): Promise<ModelProvider[]> {
  const redact = options.redact ?? ((text) => text);
  let loaded: unknown;
  try {
    if (modulePath.endsWith(".cjs") || modulePath.endsWith(".node")) {
      loaded = createRequire(import.meta.url)(modulePath);
    } else {
      loaded = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
    }
  } catch (err) {
    throw new ProviderModuleError(
      "provider-load-failed",
      `could not load model provider module ${modulePath}: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
  }
  const record = asRecord(loaded);
  if (!record) {
    throw new ProviderModuleError("invalid-provider", "model provider module must export an object");
  }
  let candidate: unknown =
    pickExport(record, "createModelProviders") ??
    pickExport(record, "modelProviders") ??
    pickExport(record, "default");
  if (typeof candidate === "function" && !isModelProviderLike(candidate)) {
    try {
      candidate = await (candidate as (ctx: unknown) => unknown)(options.context);
    } catch (err) {
      throw new ProviderModuleError(
        "provider-load-failed",
        `model provider factory failed: ${redact(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }
  const entries = Array.isArray(candidate) ? candidate : [candidate];
  const providers: ModelProvider[] = [];
  for (const entry of entries) {
    if (!isModelProviderLike(entry)) {
      throw new ProviderModuleError(
        "invalid-provider",
        "provider entries must implement meta{id,roles,priority}, healthy(), and invoke()",
      );
    }
    providers.push(entry);
  }
  if (providers.length === 0) {
    throw new ProviderModuleError("invalid-provider", "model provider module exported zero providers");
  }
  return providers;
}

function pickExport(record: Record<string, unknown>, name: string): unknown {
  const value = record[name];
  return value === undefined ? undefined : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Structural validation; full behavioral trust is documented, not implied. */
function isModelProviderLike(value: unknown): value is ModelProvider {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ModelProvider>;
  const meta = candidate.meta as Partial<ModelProvider["meta"]> | undefined;
  if (!meta || typeof meta.id !== "string" || meta.id.length === 0) return false;
  if (!Array.isArray(meta.roles) || meta.roles.length === 0 || !meta.roles.every((r) => isModelRole(r))) {
    return false;
  }
  if (typeof meta.priority !== "number" || !Number.isFinite(meta.priority)) return false;
  return typeof candidate.healthy === "function" && typeof candidate.invoke === "function";
}
