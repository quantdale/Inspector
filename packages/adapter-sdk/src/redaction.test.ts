import { describe, it, expect } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  redactRecord,
  redactUrl,
  stripUrlCredentials,
  redactUrlsInText,
  redactFreeformText,
  stripUrlCredentialsInText,
} from "./redaction.js";

describe("isSensitiveKey", () => {
  it("flags exact and suffixed secret-bearing keys case-insensitively", () => {
    for (const key of [
      "password",
      "Password",
      "PASSWORD",
      "passwd",
      "secret",
      "client_secret",
      "token",
      "access_token",
      "accessToken",
      "refreshToken",
      "authorization",
      "Authorization",
      "cookie",
      "sessionCookie",
      "credential",
      "apiCredential",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("does not flag ordinary keys", () => {
    for (const key of ["username", "pref", "count", "theme", "locale", "tokenCount"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("redactRecord", () => {
  it("masks values keyed by sensitive names and leaves the rest intact", () => {
    const out = redactRecord({
      username: "admin",
      password: "hunter2",
      accessToken: "eyJhbGciOi",
      pref: "saved-3",
    });
    expect(out).toEqual({
      username: "admin",
      password: REDACTED,
      accessToken: REDACTED,
      pref: "saved-3",
    });
  });
});

describe("redactUrl", () => {
  it("strips userinfo and masks sensitive query parameters", () => {
    expect(
      redactUrl("https://user:pass@example.com/x?token=abc&ok=1&Password=zz"),
    ).toBe(`https://example.com/x?token=${REDACTED}&ok=1&Password=${REDACTED}`);
  });

  it("covers suffix-style keys like access_token and keeps non-sensitive params", () => {
    const out = redactUrl("http://127.0.0.1:5175/cb?access_token=t0&state=s");
    expect(out).not.toContain("t0");
    expect(out).toContain("state=s");
  });

  it("returns malformed input unchanged", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("keeps already-clean URLs semantically identical", () => {
    expect(redactUrl("http://127.0.0.1:5175/?a=1")).toBe("http://127.0.0.1:5175/?a=1");
  });
});

describe("stripUrlCredentials", () => {
  it("removes user:pass@ from URLs", () => {
    expect(stripUrlCredentials("https://user:pass@evil.example/x")).toBe(
      "https://evil.example/x",
    );
    expect(stripUrlCredentials("http://127.0.0.1:8080/y?token=abc")).toBe(
      "http://127.0.0.1:8080/y?token=abc",
    );
  });

  it("returns malformed input unchanged", () => {
    expect(stripUrlCredentials("::garbage::")).toBe("::garbage::");
  });
});

describe("text scanning", () => {
  it("redacts URLs embedded in freeform console/log text", () => {
    const line = "GET https://user:pass@host/p?token=abc failed after retry";
    const out = redactUrlsInText(line);
    expect(out).not.toContain("user:pass");
    expect(out).not.toContain("abc");
    expect(out).toContain("host/p");
  });

  it("credentials-only stripping leaves query strings intact (logcat/screens)", () => {
    const line = "error calling https://user:pass@host/p?token=abc";
    const out = stripUrlCredentialsInText(line);
    expect(out).toBe("error calling https://host/p?token=abc");
  });

  it("leaves text without URLs untouched", () => {
    expect(redactUrlsInText("plain app log line")).toBe("plain app log line");
    expect(stripUrlCredentialsInText("FATAL IntentionalAppCrash")).toBe(
      "FATAL IntentionalAppCrash",
    );
  });

  it("redacts freeform bearer, API-key, cookie, and credential values", () => {
    const line = "Authorization: Bearer abc.def token=secret API_KEY=sk-live-123456789012 cookie: sid=abc https://host/p?api_key=xyz";
    const out = redactFreeformText(line);
    expect(out).not.toMatch(/abc\.def|secret|sk-live|sid=abc|api_key=xyz/i);
    expect(out).toContain("Authorization:");
    expect(out).toContain("https://host/p");
  });
});
