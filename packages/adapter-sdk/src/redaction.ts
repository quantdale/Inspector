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
  "api_key",
  "apikey",
  "access_key",
  "client_secret",
  "set-cookie",
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
  URL_RE.lastIndex = 0;
  const out = text.replace(URL_RE, (match) => fn(match));
  URL_RE.lastIndex = 0;
  return out;
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

/**
 * Redact freeform logs/screens/page errors before they enter observations or
 * durable artifacts. URL query parameters, bearer/auth headers, common
 * credential environment variables, cookie values, and recognizable API-key
 * forms are masked while surrounding diagnostic text is retained.
 */
export function redactFreeformText(text: string): string {
  let out = redactUrlsInText(text);
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`);
  out = out.replace(
    /(\b(?:authorization|proxy-authorization)\s*:\s*)(?:Basic|Bearer)\s+[^\s,;]+/gi,
    `$1${REDACTED}`,
  );
  out = out.replace(
    /(\b(?:cookie|set-cookie)\s*[:=]\s*)([^\s;]+)/gi,
    `$1${REDACTED}`,
  );
  out = out.replace(
    /(\b(?:api[_-]?key|access[_-]?key|client[_-]?secret|secret|token|password|passwd|credential)\s*[:=]\s*)(["']?)[^\s"',;]+\2/gi,
    `$1$2${REDACTED}$2`,
  );
  out = out.replace(
    /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|DATABASE_URL)\s*=\s*[^\s]+/gi,
    (match) => `${match.slice(0, match.indexOf("=") + 1)}${REDACTED}`,
  );
  return out.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, REDACTED);
}
