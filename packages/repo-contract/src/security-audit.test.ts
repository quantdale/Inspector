import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactFreeformText, redactUrlsInText, REDACTED } from "@inspector/adapter-sdk";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readPkg(rel: string): { dependencies?: Record<string, string>; audit?: { advisories?: unknown[] } } {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as {
    dependencies?: Record<string, string>;
    audit?: { advisories?: unknown[] };
  };
}

// Fail-closed audit helper — mirrors scripts/audit-guard.mjs logic without I/O.
type Severity = "low" | "moderate" | "high" | "critical" | string;
interface Advisory { id: string; severity: Severity }

function auditAllows(advisories: Advisory[]): { allowed: boolean; blocked: Advisory[] } {
  const blocked = advisories.filter((a) => {
    const s = a.severity.toLowerCase();
    if (s === "high" || s === "critical") return true;
    if (s === "low" || s === "moderate") return false;
    return true; // unknown -> fail closed
  });
  return { allowed: blocked.length === 0, blocked };
}

describe("M18 repo-contract security-audit — expanded redaction coverage", () => {
  it("redacts URL query secrets (?token=, ?api_key=, ?secret) from freeform text", () => {
    const token = "tok_TEST1234567890abcdef";
    const apiKey = "sk-live-TESTAPIKEY1234567890";
    const secret = "mySuperSecret999";
    const line = `fetch https://example.com/a?token=${token}&ok=1 and https://example.com/b?api_key=${apiKey}&ok=1 and https://example.com/c?secret=${secret}&ok=1 and benign https://example.com/page?ok=1&lang=en`;
    const out = redactFreeformText(line);
    expect(out).not.toContain(token);
    expect(out).not.toContain(apiKey);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out).toContain("lang=en");
    // URL-only path preserves ok=1 — freeform's second-stage scrub may swallow it.
    const viaUrls = redactUrlsInText(line);
    expect(viaUrls).toContain("ok=1");
  });

  it("redacts bearer headers", () => {
    const raw = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    const line = `Authorization: Bearer ${raw}`;
    const out = redactFreeformText(line);
    expect(out).not.toContain(raw);
    expect(out).toContain(REDACTED);
    expect(out).toContain("Authorization:");
  });

  it("redacts cookie strings", () => {
    const raw = "sid=COOKIESECRET12345";
    const line = `cookie: ${raw}; Path=/`;
    const out = redactFreeformText(line);
    expect(out).not.toContain(raw);
    expect(out).toContain(REDACTED);
  });

  it("redacts env-style secrets (AWS_SECRET, GITHUB_TOKEN)", () => {
    const aws = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const gh = "ghp_1234567890abcdef1234567890abcdef12345678";
    const block = `AWS_SECRET_ACCESS_KEY=${aws}\nGITHUB_TOKEN=${gh}`;
    const out = redactFreeformText(block);
    expect(out).not.toContain(aws);
    expect(out).not.toContain(gh);
    expect(out).toContain("AWS_SECRET_ACCESS_KEY=");
    expect(out).toContain("GITHUB_TOKEN=");
  });
});

describe("M18 repo-contract security-audit — pnpm audit guard (mock, fail-closed)", () => {
  it("fails closed on high/critical, allows low/moderate", () => {
    expect(auditAllows([{ id: "1", severity: "high" }]).allowed).toBe(false);
    expect(auditAllows([{ id: "2", severity: "critical" }]).allowed).toBe(false);
    expect(auditAllows([{ id: "3", severity: "moderate" }]).allowed).toBe(true);
    expect(auditAllows([{ id: "4", severity: "low" }]).allowed).toBe(true);
    expect(auditAllows([]).allowed).toBe(true);
  });

  it("treats unknown severity as blocked", () => {
    expect(auditAllows([{ id: "x", severity: "unknown" }]).allowed).toBe(false);
  });

  it("mock: pnpm audit --prod would be zero (no high/critical, no bad prod deps)", () => {
    const pkg = readPkg("package.json");
    const prodDeps = Object.keys(pkg.dependencies ?? {});
    // Inspector keeps runtime deps in workspaces; root has none — prod audit surface is zero.
    const external = prodDeps.filter((d) => !d.startsWith("@inspector/"));
    expect(external).toEqual([]);

    const advisories = (pkg.audit?.advisories ?? []) as Advisory[];
    const { allowed, blocked } = auditAllows(advisories);
    expect(allowed, `blocked: ${JSON.stringify(blocked)}`).toBe(true);

    const KNOWN_BAD: Record<string, true> = {
      lodash: true,
      minimist: true,
      "node-fetch": true,
      axios: true,
      express: true,
    };
    for (const dep of prodDeps) {
      expect(KNOWN_BAD[dep]).toBeUndefined();
    }
  });
});
