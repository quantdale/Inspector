/**
 * Secret redaction helpers shared by the platform adapters (SECURITY-MODEL:
 * "redact known secret values from logs/artifacts/model inputs"). Values are
 * masked before they are embedded in observations; freeform text is only
 * scrubbed structurally (URLs), never interpreted.
 */

export const REDACTED = "***";

/** Key word list matched case-insensitively as exact key or key suffix. */
const SENSITIVE_KEY_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "credential",
] as const;

const URL_RE = /https?:\/\/[^\s"'<>()[\]]+/g;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUFFIXES.some((w) => lower === w || lower.endsWith(w));
}

/** Mask values whose KEY is sensitive (storage dumps, keyed records). */
export function redactRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = isSensitiveKey(k) ? REDACTED : v;
  }
  return out;
}

/** Remove user:pass@ userinfo from a URL; malformed input returned unchanged. */
export function stripUrlCredentials(url: string): string {
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

/**
 * Redact a URL for persistence: strip userinfo AND mask query parameters
 * whose name carries a secret (password/token/... suffix matching).
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(stripUrlCredentials(url));
    let changed = false;
    for (const [k, v] of Array.from(u.searchParams.entries())) {
      if (isSensitiveKey(k)) {
        u.searchParams.set(k, REDACTED);
        changed = true;
      } else if (v === REDACTED) {
        changed = true;
      }
    }
    return changed ? u.toString() : stripUrlCredentials(url);
  } catch {
    return url;
  }
}

function rewriteUrls(text: string, fn: (url: string) => string): string {
  return text.replace(URL_RE, (match) => fn(match));
}

/** Full redaction of URLs embedded in freeform text (console/pageerror). */
export function redactUrlsInText(text: string): string {
  return rewriteUrls(text, redactUrl);
}

/**
 * Credentials-only stripping for freeform text where query strings may be
 * diagnostically significant (logcat, PTY screen lines).
 */
export function stripUrlCredentialsInText(text: string): string {
  return rewriteUrls(text, stripUrlCredentials);
}
