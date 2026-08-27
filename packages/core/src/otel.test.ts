import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileTraceExporter,
  FileMetricsExporter,
  InMemoryMetricExporter,
  RunCounterMetrics,
  type Span,
} from "./otel.js";

function makeSpan(overrides: Partial<Span> = {}): Span {
  const base: Span = {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    parentId: null,
    name: "run",
    startTime: 1000,
    endTime: 2000,
    attributes: { "service.name": "inspector" },
  };
  return { ...base, ...overrides, attributes: { ...base.attributes, ...(overrides.attributes ?? {}) } };
}

describe("FileTraceExporter", () => {
  it("writes valid JSON lines and handles batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otel-test-"));
    const file = join(dir, "traces.jsonl");
    try {
      const exporter = new FileTraceExporter({ filePath: file });

      const span1 = makeSpan({ spanId: "1".repeat(16), name: "run" });
      await exporter.export([span1]);
      let lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const parsed1 = JSON.parse(lines[0]!);
      expect(parsed1.spanId).toBe("1".repeat(16));
      expect(parsed1.traceId).toBe("a".repeat(32));
      expect(parsed1.name).toBe("run");
      expect(parsed1.attributes["service.name"]).toBe("inspector");

      // batch: 3 spans at once
      const batch: Span[] = [
        makeSpan({ spanId: "2".repeat(16), name: "step-1", startTime: 2000, endTime: 2100 }),
        makeSpan({ spanId: "3".repeat(16), name: "step-2", parentId: "2".repeat(16) }),
        makeSpan({ spanId: "4".repeat(16), name: "model-call", attributes: { "http.url": "https://example.com" } }),
      ];
      await exporter.export(batch);
      lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(4);
      // every line must be valid JSON with required fields
      for (const line of lines) {
        const obj = JSON.parse(line);
        expect(typeof obj.traceId).toBe("string");
        expect(typeof obj.spanId).toBe("string");
        expect(typeof obj.name).toBe("string");
        expect(typeof obj.startTime).toBe("number");
        expect(typeof obj.endTime).toBe("number");
        expect(typeof obj.attributes).toBe("object");
      }
      const last = JSON.parse(lines[3]!);
      expect(last.name).toBe("model-call");

      // no secret leakage: sensitive attribute redacted
      const secretSpan = makeSpan({
        spanId: "5".repeat(16),
        attributes: { password: "hunter2", "api_key": "sk-123", safe: "ok" },
      });
      await exporter.export([secretSpan]);
      lines = readFileSync(file, "utf8").trim().split("\n");
      const secretParsed = JSON.parse(lines[lines.length - 1]!);
      expect(secretParsed.attributes.password).toBe("***");
      expect(secretParsed.attributes.api_key).toBe("***");
      expect(secretParsed.attributes.safe).toBe("ok");

      // empty batch is no-op (no extra line)
      const before = readFileSync(file, "utf8");
      await exporter.export([]);
      const after = readFileSync(file, "utf8");
      expect(after).toBe(before);

      await exporter.shutdown();
      await expect(exporter.export([span1])).rejects.toThrow(/closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("truncates unbounded attribute values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otel-test-"));
    const file = join(dir, "traces.jsonl");
    try {
      const exporter = new FileTraceExporter({ filePath: file });
      const long = "x".repeat(5000);
      const span = makeSpan({ spanId: "6".repeat(16), attributes: { big: long } });
      await exporter.export([span]);
      const parsed = JSON.parse(readFileSync(file, "utf8").trim());
      expect(parsed.attributes.big.length).toBeLessThanOrEqual(1024);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("metrics helper for run counters", () => {
  it("RunCounterMetrics increments and flushes via exporter", async () => {
    const mem = new InMemoryMetricExporter();
    const counters = new RunCounterMetrics(mem);
    counters.increment("actions", 3);
    counters.increment("actions", 2);
    counters.increment("findings.confirmed");
    expect(counters.get("actions")).toBe(5);
    expect(counters.snapshot()).toEqual({ actions: 5, "findings.confirmed": 1 });

    await counters.flush({ "run.id": "run_abc" });
    expect(mem.points).toHaveLength(2);
    const names = mem.points.map((p) => p.name).sort();
    expect(names).toEqual(["actions", "findings.confirmed"]);
    for (const p of mem.points) {
      expect(typeof p.value).toBe("number");
      expect(typeof p.timestamp).toBe("number");
    }
    // flush includes sanitized resource-like attributes
    expect(mem.points[0]!.attributes?.["run.id"]).toBe("run_abc");
  });

  it("FileMetricsExporter writes valid JSON lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otel-metrics-test-"));
    const file = join(dir, "metrics.jsonl");
    try {
      const exporter = new FileMetricsExporter({ filePath: file });
      await exporter.export([
        { name: "actions", value: 10, timestamp: 1000 },
        { name: "model.calls", value: 2, timestamp: 2000, attributes: { model: "test" } },
      ]);
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      const m1 = JSON.parse(lines[0]!);
      expect(m1.name).toBe("actions");
      expect(m1.value).toBe(10);
      const m2 = JSON.parse(lines[1]!);
      expect(m2.attributes.model).toBe("test");

      // secret leakage protection
      await exporter.export([{ name: "x", value: 1, timestamp: 3000, attributes: { token: "secret123" } }]);
      const last = JSON.parse(readFileSync(file, "utf8").trim().split("\n").pop()!);
      expect(last.attributes.token).toBe("***");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
