/**
 * Minimal OpenTelemetry-compatible trace and metrics helpers.
 *
 * File-based only, no network. Spans and metrics are derived projections of
 * durable run state and are not authoritative. Attributes are bounded and
 * redacted to avoid secret leakage.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REDACTED = "***";
const MAX_ATTRIBUTE_VALUE_LENGTH = 1024;
const MAX_ATTRIBUTES_PER_SPAN = 128;
const MAX_ATTRIBUTE_KEY_LENGTH = 128;

const SENSITIVE_KEY_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "auth",
  "credential",
  "authorization",
] as const;

// ---------------------------------------------------------------------------
// Helpers: sanitization
// ---------------------------------------------------------------------------

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_\s]/g, "");
  return SENSITIVE_KEY_SUFFIXES.some((s) => lower === s || lower.endsWith(s));
}

function truncateValue(value: string): string {
  if (value.length <= MAX_ATTRIBUTE_VALUE_LENGTH) return value;
  return value.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
}

function sanitizeAttributeValue(key: string, value: unknown): string | number | boolean {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === "string") return truncateValue(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return REDACTED;
    return value;
  }
  if (typeof value === "boolean") return value;
  // Coerce other primitives/truncated JSON
  const asString = String(value);
  return truncateValue(asString);
}

function sanitizeAttributes(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!input) return {};
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(input)) {
    if (count >= MAX_ATTRIBUTES_PER_SPAN) break;
    const key =
      rawKey.length > MAX_ATTRIBUTE_KEY_LENGTH
        ? rawKey.slice(0, MAX_ATTRIBUTE_KEY_LENGTH)
        : rawKey;
    out[key] = sanitizeAttributeValue(rawKey, rawVal);
    count += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trace schema
// ---------------------------------------------------------------------------

/**
 * OTel-compatible span. `traceId` and `spanId` are opaque hex strings;
 * `parentId` links the hierarchy (run → step → action, etc.). Times are
 * epoch-millis (number) for JSON portability; `attributes` are bounded and
 * redacted.
 */
export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string | null;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, string | number | boolean>;
}

export interface TraceExporter {
  export(spans: Span[]): Promise<void>;
  shutdown?(): Promise<void>;
}

function isHexId(value: string, bytes: number): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length === bytes * 2;
}

function validateSpan(span: Span): string | null {
  if (!span.traceId || !isHexId(span.traceId, 16)) return "traceId must be 32 hex chars";
  if (!span.spanId || !isHexId(span.spanId, 8)) return "spanId must be 16 hex chars";
  if (span.parentId != null && span.parentId !== "" && !isHexId(span.parentId, 8)) {
    return "parentId must be 16 hex chars or null";
  }
  if (!span.name || typeof span.name !== "string") return "name required";
  if (typeof span.startTime !== "number" || typeof span.endTime !== "number") {
    return "startTime/endTime must be numbers";
  }
  if (span.endTime < span.startTime) return "endTime must be >= startTime";
  return null;
}

// ---------------------------------------------------------------------------
// FileTraceExporter
// ---------------------------------------------------------------------------

export interface FileTraceExporterOptions {
  filePath: string;
}

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class FileTraceExporter implements TraceExporter {
  readonly filePath: string;
  #closed = false;
  #exportCount = 0;

  constructor(options: FileTraceExporterOptions) {
    if (!options.filePath || typeof options.filePath !== "string") {
      throw new Error("FileTraceExporter requires filePath");
    }
    this.filePath = options.filePath;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get exportCount(): number {
    return this.#exportCount;
  }

  async export(spans: Span[]): Promise<void> {
    if (this.#closed) throw new Error("exporter is closed");
    if (!Array.isArray(spans)) throw new TypeError("spans must be an array");
    if (spans.length === 0) return;

    const sanitized: Span[] = [];
    for (const s of spans) {
      const err = validateSpan(s);
      if (err) throw new Error(`invalid span ${s.spanId ?? "?"}: ${err}`);
      sanitized.push({
        traceId: s.traceId.toLowerCase(),
        spanId: s.spanId.toLowerCase(),
        parentId: s.parentId ? s.parentId.toLowerCase() : s.parentId ?? null,
        name: truncateValue(s.name),
        startTime: s.startTime,
        endTime: s.endTime,
        attributes: sanitizeAttributes(s.attributes as Record<string, unknown>),
      });
    }

    const lines = sanitized.map((s) => JSON.stringify(s)).join("\n") + "\n";

    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, lines, "utf8");
      this.#exportCount += sanitized.length;
    } catch (err) {
      // Bounded, logged, never fails the run — derived, best-effort.
      console.error(`[otel] failed to write traces to ${this.filePath}:`, err);
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricPoint {
  name: string;
  value: number;
  attributes?: Record<string, string | number | boolean>;
  timestamp: number;
}

export interface MetricExporter {
  export(metrics: MetricPoint[]): Promise<void>;
  shutdown?(): Promise<void>;
}

export class InMemoryMetricExporter implements MetricExporter {
  readonly points: MetricPoint[] = [];

  async export(metrics: MetricPoint[]): Promise<void> {
    for (const m of metrics) {
      this.points.push({
        name: truncateValue(m.name),
        value: m.value,
        attributes: sanitizeAttributes(m.attributes as Record<string, unknown>),
        timestamp: m.timestamp,
      });
    }
  }
}

export class FileMetricsExporter implements MetricExporter {
  readonly filePath: string;
  #closed = false;

  constructor(options: { filePath: string }) {
    if (!options.filePath || typeof options.filePath !== "string") {
      throw new Error("FileMetricsExporter requires filePath");
    }
    this.filePath = options.filePath;
  }

  async export(metrics: MetricPoint[]): Promise<void> {
    if (this.#closed) throw new Error("exporter is closed");
    if (!Array.isArray(metrics) || metrics.length === 0) return;

    const sanitized = metrics.map((m) => ({
      name: truncateValue(m.name),
      value: Number.isFinite(m.value) ? m.value : 0,
      attributes: sanitizeAttributes(m.attributes as Record<string, unknown>),
      timestamp: m.timestamp ?? Date.now(),
    }));

    const lines = sanitized.map((p) => JSON.stringify(p)).join("\n") + "\n";
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, lines, "utf8");
    } catch (err) {
      console.error(`[otel] failed to write metrics to ${this.filePath}:`, err);
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
  }
}

/**
 * Helper for run-scoped counters. Deterministic, additive, derived only.
 * No authoritative accounting is moved off SQLite — this is a projection.
 */
export class RunCounterMetrics {
  #counters = new Map<string, number>();
  #exporter: MetricExporter | null;

  constructor(exporter?: MetricExporter) {
    this.#exporter = exporter ?? null;
  }

  increment(name: string, by = 1): void {
    if (!name || typeof name !== "string") throw new Error("metric name required");
    if (!Number.isFinite(by)) throw new Error("increment value must be finite");
    const clean = truncateValue(name);
    const prev = this.#counters.get(clean) ?? 0;
    this.#counters.set(clean, prev + by);
  }

  set(name: string, value: number): void {
    if (!name || typeof name !== "string") throw new Error("metric name required");
    if (!Number.isFinite(value)) throw new Error("metric value must be finite");
    this.#counters.set(truncateValue(name), value);
  }

  get(name: string): number {
    return this.#counters.get(truncateValue(name)) ?? 0;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.#counters) out[k] = v;
    return out;
  }

  reset(): void {
    this.#counters.clear();
  }

  toMetricPoints(attributes?: Record<string, string | number | boolean>): MetricPoint[] {
    const now = Date.now();
    const sanitizedAttrs = attributes ? sanitizeAttributes(attributes as Record<string, unknown>) : undefined;
    return [...this.#counters.entries()].map(([name, value]) => ({
      name,
      value,
      attributes: sanitizedAttrs,
      timestamp: now,
    }));
  }

  async flush(attributes?: Record<string, string | number | boolean>): Promise<void> {
    if (!this.#exporter) return;
    const points = this.toMetricPoints(attributes);
    if (points.length === 0) return;
    await this.#exporter.export(points);
  }
}
