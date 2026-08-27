import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "./artifact-store.js";
import {
  REDACTED,
  redactFreeformText,
  redactUrl,
  redactUrlsInText,
} from "@inspector/adapter-sdk";

// -- Helpers -----------------------------------------------------------------

function storeInTmp(): { store: ArtifactStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "inspector-m18-"));
  return { store: new ArtifactStore(dir), dir };
}

function assertNoRawSecret(out: string, raws: string[]): void {
  for (const raw of raws) {
    expect(out, `should not leak raw secret: ${raw.slice(0, 8)}…`).not.toContain(raw);
  }
}

// -- URL query secrets (?token=, ?api_key=, ?secret=, ?password=, …) -------

describe("M18 expanded redaction — URL query secrets", () => {
  it("redacts sensitive query params in isolated URL and in freeform text", () => {
    const raws = {
      token: "tok_ABCDEF1234567890",
      api_key: "sk-live-api-key-9999",
      secret: "superS3cretValue!",
      password: "hunter2hunter2",
      access_token: "ya29.access-token-raw",
    };

    // Isolated URL path — redactUrl must strip each secret.
    for (const [k, v] of Object.entries(raws)) {
      const url = `https://example.com/cb?${k}=${encodeURIComponent(v)}&ok=1`;
      const redacted = redactUrl(url);
      expect(redacted).not.toContain(v);
      expect(redacted).toContain("ok=1");
      expect(redacted).toContain(REDACTED);
    }

    // Freeform text embedding several secrets at once — redactFreeformText and
    // redactUrlsInText must both eliminate the raw values before persistence.
    const line =
      `GET https://example.com/x?token=${raws.token}&ok=1 ` +
      `then https://example.com/y?api_key=${raws.api_key}&ok=1 ` +
      `then https://host/cb?secret=${raws.secret}&ok=1 ` +
      `and https://host/cb?access_token=${raws.access_token}&ok=1 ` +
      `password=${raws.password} in freeform ` +
      `and benign https://example.com/page?ok=1&lang=en`;
    const scrubbed = redactFreeformText(line);
    assertNoRawSecret(scrubbed, Object.values(raws));
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).toContain("lang=en");

    const viaUrls = redactUrlsInText(line);
    // viaUrls only handles URL query redaction; freeform password stays — check URL raws only.
    assertNoRawSecret(viaUrls, [raws.token, raws.api_key, raws.secret, raws.access_token]);
    expect(viaUrls).toContain("ok=1");
  });

  it("keeps non-sensitive query params and benign URLs intact", () => {
    const benign = "https://example.com/page?lang=en&state=abc&page=2";
    expect(redactUrl(benign)).toBe(benign);
    expect(redactFreeformText(`see ${benign} for details`)).toContain("lang=en");
  });
});

// -- Bearer / Authorization headers ------------------------------------------

describe("M18 expanded redaction — bearer and authorization headers", () => {
  it("redacts Bearer tokens in freeform headers and bare Bearer forms", () => {
    const rawBearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ";
    const rawBasic = "dXNlcjpwYXNz";

    const cases = [
      `Authorization: Bearer ${rawBearer}`,
      `authorization: Bearer ${rawBearer} `,
      `Proxy-Authorization: Bearer ${rawBearer}`,
      `GET /api Authorization: Basic ${rawBasic}`,
      `Bearer ${rawBearer} was sent`,
    ];

    for (const line of cases) {
      const out = redactFreeformText(line);
      expect(out, line).not.toContain(rawBearer);
      expect(out, line).not.toContain(rawBasic);
      expect(out).toContain(REDACTED);
    }

    // Non-secret bearer-like text without a token must not be mangled beyond bound.
    expect(redactFreeformText("Bearer pattern documented")).toContain("Bearer");
  });
});

// -- Cookie strings -----------------------------------------------------------

describe("M18 expanded redaction — cookie strings", () => {
  it("redacts cookie / set-cookie values in freeform text", () => {
    const rawCookies = ["sid=abc123XYZ", "session=deadbeef9999", "token=cookieRawSecret123"];
    const lines = [
      `cookie: ${rawCookies[0]}; path=/`,
      `Cookie: ${rawCookies[1]}`,
      `set-cookie: ${rawCookies[2]}; HttpOnly`,
      `headers cookie=${rawCookies[0]}`,
    ];

    for (const line of lines) {
      const out = redactFreeformText(line);
      // The raw cookie value must not survive.
      assertNoRawSecret(out, rawCookies);
      expect(out).toContain(REDACTED);
      // Header name must remain for diagnostics.
      expect(out.toLowerCase()).toMatch(/cookie|set-cookie/);
    }
  });
});

// -- Env-style secrets (AWS_SECRET, GITHUB_TOKEN, etc.) ----------------------

describe("M18 expanded redaction — env-style secrets", () => {
  it("redacts env-style credential assignments", () => {
    const raws: Record<string, string> = {
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      GITHUB_TOKEN: "ghp_1234567890abcdef1234567890abcdef12345678",
      GH_TOKEN: "gho_abcdef1234567890abcdef1234567890abcdef12",
      NPM_TOKEN: "npm_1234567890abcdef12345678901234567890",
      OPENAI_API_KEY: "sk-proj-abcdef1234567890ABCDEF1234567890",
    };

    const lines = Object.entries(raws).map(([k, v]) => `${k}=${v}`);
    const block = lines.join("\n");
    const out = redactFreeformText(block);

    assertNoRawSecret(out, Object.values(raws));
    // Key names remain for diagnostics; values are gone.
    for (const k of Object.keys(raws)) {
      expect(out).toContain(k);
    }
    // Unrelated env line must not be redacted beyond bound.
    expect(redactFreeformText("NODE_ENV=production PORT=3000")).toContain("NODE_ENV=production");
  });

  it("redacts high-entropy token forms (sk-, ghp_, xox) even without key prefix", () => {
    const raws = [
      "sk-12345678901234567890abcdef",
      "ghp_ABCDEFGHIJKL1234567890mnopqrst",
      ["xox", "b-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"].join(""),
    ];
    const line = `leaked tokens: ${raws.join(" ")}`;
    const out = redactFreeformText(line);
    assertNoRawSecret(out, raws);
    expect(out).toContain(REDACTED);
  });
});

// -- Fail-closed: persistence sees only scrubbed text ------------------------

describe("M18 expanded redaction — fail-closed before persistence", () => {
  it("scrubbed text written to ArtifactStore never contains the raw secret", () => {
    const rawToken = ["ghp", "_SUPERSECRET1234567890abcdef1234567890ab"].join("");
    const rawApiKey = ["sk", "-live-999999999999"].join("");
    const raw = `callback https://example.com/cb?token=${rawToken}&api_key=${rawApiKey} Authorization: Bearer ${rawToken} cookie: sid=${rawToken} AWS_SECRET_ACCESS_KEY=${rawToken}`;

    const scrubbed = redactFreeformText(raw);
    assertNoRawSecret(scrubbed, [rawToken, rawApiKey]);

    // Simulate "before persistence" contract: only scrubbed text is written.
    const { store, dir } = storeInTmp();
    try {
      const meta = store.write({
        runId: "run1",
        content: Buffer.from(scrubbed, "utf8"),
        mime: "text/plain",
        name: "observation.log",
      });
      const persisted = readFileSync(meta.path, "utf8");
      assertNoRawSecret(persisted, [rawToken, rawApiKey]);
      expect(persisted).toContain(REDACTED);

      // Raw form must never have been written — reading the same digest after
      // writing raw would be a different artifact. Prove raw would be rejected
      // if someone tried to bypass redaction: the store would contain raw, so
      // our contract requires callers to scrub first.
      const rawMeta = store.write({
        runId: "run1",
        content: Buffer.from(raw, "utf8"),
        mime: "text/plain",
        name: "raw.log",
      });
      const rawPersisted = readFileSync(rawMeta.path, "utf8");
      // rawPersisted DOES contain the secret — demonstrating why scrub-before-write is mandatory.
      expect(rawPersisted).toContain(rawToken);
      // The scrubbed artifact is distinct (different sha256) from the raw one.
      expect(meta.sha256).not.toBe(rawMeta.sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redaction is deterministic and bounded (idempotent single-pass)", () => {
    const line = "https://example.com/x?token=abc123 AWS_SECRET_ACCESS_KEY=secret123 cookie: sid=xyz Bearer abc.def";
    const once = redactFreeformText(line);
    const twice = redactFreeformText(once);
    expect(twice).toBe(once);
    // Bounds: output not dramatically larger than input (replacement, not expansion).
    expect(once.length).toBeLessThan(line.length + 32);
  });
});

// -- Audit guard mock (fail-closed) ------------------------------------------

describe("M18 supply-chain audit guard (mock, fail-closed)", () => {
  type Severity = "low" | "moderate" | "high" | "critical" | string;
  interface Advisory { id: string; severity: Severity }

  /** Fail-closed guard: high/critical always block; unknown severity blocks. */
  function auditAllows(advisories: Advisory[]): { allowed: boolean; blocked: Advisory[] } {
    const blocked = advisories.filter((a) => {
      const s = a.severity.toLowerCase();
      if (s === "high" || s === "critical") return true;
      if (s === "low" || s === "moderate") return false;
      // Unknown severity — fail closed.
      return true;
    });
    return { allowed: blocked.length === 0, blocked };
  }

  it("blocks high and critical, allows low/moderate (fail-closed)", () => {
    expect(auditAllows([{ id: "1", severity: "high" }]).allowed).toBe(false);
    expect(auditAllows([{ id: "2", severity: "critical" }]).allowed).toBe(false);
    expect(auditAllows([{ id: "3", severity: "moderate" }]).allowed).toBe(true);
    expect(auditAllows([{ id: "4", severity: "low" }]).allowed).toBe(true);
    expect(auditAllows([]).allowed).toBe(true);
  });

  it("treats unknown severity as blocked (fail-closed)", () => {
    expect(auditAllows([{ id: "x", severity: "unknown" }]).allowed).toBe(false);
    expect(auditAllows([{ id: "y", severity: "" }]).allowed).toBe(false);
  });

  it("current repository has no high/critical prod advisories (mock)", () => {
    // Mock: package.json has no prod dependencies, so prod audit is trivially clean.
    // This mirrors `pnpm audit --prod` would be zero because `dependencies` is empty.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      audit?: { advisories?: Advisory[] };
    };

    // No prod runtime deps besides workspace links — high/critical surface is zero.
    const prodDeps = Object.keys(pkg.dependencies ?? {});
    // Allow only workspace-linked or absent prod deps; fail closed otherwise.
    const externalProdDeps = prodDeps.filter((d) => !d.startsWith("@inspector/"));
    expect(externalProdDeps, `unexpected external prod deps: ${externalProdDeps.join(", ")}`).toEqual([]);

    // If an `audit` field exists (future allowlist), it must not contain high/critical.
    const advisories: Advisory[] = pkg.audit?.advisories ?? [];
    const { allowed, blocked } = auditAllows(advisories);
    expect(allowed, `blocked advisories: ${JSON.stringify(blocked)}`).toBe(true);
  });

  it("no known bad prod deps present", () => {
    const KNOWN_BAD: Record<string, true> = {
      lodash: true,
      minimist: true,
      "node-fetch": true,
      axios: true,
      express: true,
    };
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const prodDeps = Object.keys(pkg.dependencies ?? {});
    for (const dep of prodDeps) {
      expect(KNOWN_BAD[dep], `known-bad prod dep must not be present: ${dep}`).toBeUndefined();
    }
  });
});
