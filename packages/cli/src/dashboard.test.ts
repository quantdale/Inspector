import { describe, it, expect } from "vitest";
import { generateDashboard } from "./dashboard.js";

describe("dashboard report generator", () => {
  it("contains runs and findings tables with expected ids", () => {
    const html = generateDashboard(
      [
        { id: "run-2", status: "completed", adapter: "web", created_at: "2026-08-20T10:00:00Z" },
        { id: "run-1", status: "running", adapter: "electron", created_at: "2026-08-19T09:00:00Z" },
      ],
      [
        { id: "finding-1", runId: "run-1", status: "CONFIRMED", title: "Login failure", severity: "high", adapter: "web" },
        { id: "finding-2", runId: "run-2", status: "OBSERVED", title: "Crash on save", severity: "low", adapter: "web" },
      ],
    );

    expect(html).toContain("<table");
    expect(html).toContain('aria-label="Runs"');
    expect(html).toContain('aria-label="Findings"');
    // Deterministic sort by id
    expect(html.indexOf("run-1")).toBeLessThan(html.indexOf("run-2"));
    expect(html.indexOf("finding-1")).toBeLessThan(html.indexOf("finding-2"));
    expect(html).toContain("run-1");
    expect(html).toContain("run-2");
    expect(html).toContain("finding-1");
    expect(html).toContain("finding-2");
    expect(html).toContain("Login failure");
    expect(html).toContain("Crash on save");
  });

  it("escapes HTML in cell values", () => {
    const html = generateDashboard(
      [{ id: "run-<1>", status: "ok & done", adapter: "web", created_at: "2026-08-20" }],
      [{ id: "finding-1", runId: "run-<1>", status: "OBSERVED", title: '<script>alert("x")</script>', severity: "high", adapter: "web" }],
    );

    expect(html).toContain("run-&lt;1&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("ok &amp; done");
    // Raw unescaped payload must not appear
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).not.toContain("run-<1>");
  });

  it("redacts secrets via placeholder", () => {
    const html = generateDashboard(
      [{ id: "run-1", status: "completed", adapter: "web", created_at: "2026-08-20" }],
      [
        {
          id: "finding-1",
          runId: "run-1",
          status: "CONFIRMED",
          title: "password= superSecret123 token= abc Bearer sk-12345678901234567890",
          severity: "high",
          adapter: "web",
        },
      ],
    );

    expect(html).toContain("***");
    // Raw secrets must not appear verbatim
    expect(html).not.toContain("superSecret123");
    expect(html).not.toContain("sk-12345678901234567890");
  });

  it("produces no JS, no external fetch, self-contained offline HTML", () => {
    const html = generateDashboard(
      [{ id: "run-1", status: "completed", adapter: "web", created_at: "2026-08-20" }],
      [{ id: "finding-1", runId: "run-1", status: "CONFIRMED", title: "ok", severity: "low", adapter: "web" }],
    );

    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("XMLHttpRequest");
    // No external http fetches — HTML is self-contained (style is inline, no external src)
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).toContain("<style>");
    expect(html).toContain("<!doctype html>");
  });

  it("handles empty inputs with placeholder rows", () => {
    const html = generateDashboard([], []);
    expect(html).toContain("No runs recorded");
    expect(html).toContain("No findings recorded");
    expect(html).toContain("Runs (0)");
    expect(html).toContain("Findings (0)");
  });

  it("is deterministic for identical inputs", () => {
    const runs = [{ id: "run-1", status: "completed", adapter: "web", created_at: "2026-08-20" }];
    const findings = [{ id: "finding-1", runId: "run-1", status: "OBSERVED", title: "t", severity: "low", adapter: "web" }];
    const a = generateDashboard(runs, findings);
    const b = generateDashboard(runs, findings);
    expect(a).toBe(b);
  });
});
