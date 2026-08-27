/**
 * Static HTML evidence report generator (M17 Operator Dashboard).
 *
 * Pure, credential-free, deterministic, side-effect-free:
 *  - `generateDashboard(runs, findings)` -> self-contained HTML string
 *  - no JS, no external fetch, no server
 *  - HTML-escapes every cell, redacts secrets via @inspector/adapter-sdk when present
 */

import { REDACTED as ADAPTER_REDACTED, redactFreeformText } from "@inspector/adapter-sdk";

const PLACEHOLDER: string = typeof ADAPTER_REDACTED === "string" && ADAPTER_REDACTED.length > 0 ? ADAPTER_REDACTED : "***";

export interface DashboardRun {
  id: string;
  status?: string | null;
  adapter?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface DashboardFinding {
  id: string;
  runId?: string | null;
  run_id?: string | null;
  status?: string | null;
  title?: string | null;
  severity?: string | null;
  confidence?: number | null;
  adapter?: string | null;
  [key: string]: unknown;
}

function fallbackRedact(text: string): string {
  let out = text;
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${PLACEHOLDER}`);
  out = out.replace(
    /(\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|cookie|credential)\s*[:=]\s*)(["']?)[^\s"',;]+\2/gi,
    `$1$2${PLACEHOLDER}$2`,
  );
  out = out.replace(
    /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|DATABASE_URL)\s*=\s*[^\s]+/gi,
    (m) => `${m.slice(0, m.indexOf("=") + 1)}${PLACEHOLDER}`,
  );
  out = out.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, PLACEHOLDER);
  out = out.replace(/password\s*[:=]\s*\S+/gi, `password=${PLACEHOLDER}`);
  return out;
}

function redactString(input: string): string {
  if (typeof redactFreeformText === "function") {
    try {
      const redacted = redactFreeformText(input);
      if (redacted !== input) return redacted;
      const fallback = fallbackRedact(input);
      if (fallback !== input) return fallback;
      return redacted;
    } catch {
      // ignore and use fallback
    }
  }
  return fallbackRedact(input);
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  const redacted = redactString(raw);
  return redacted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generate a self-contained static HTML evidence report.
 *
 * Deterministic: inputs are sorted by id, output contains no timestamps
 * beyond those present in the data, no random ids, no external resources.
 */
export function generateDashboard(
  runs: DashboardRun[] | null | undefined,
  findings: DashboardFinding[] | null | undefined,
): string {
  const safeRuns = Array.isArray(runs) ? [...runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : [];
  const safeFindings = Array.isArray(findings) ? [...findings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : [];

  const runRows =
    safeRuns.length === 0
      ? `        <tr><td colspan="4" class="empty">No runs recorded</td></tr>`
      : safeRuns
          .map(
            (r) =>
              `        <tr><td>${toDisplayString(r.id)}</td><td>${toDisplayString(r.status ?? "")}</td><td>${toDisplayString(r.adapter ?? "")}</td><td>${toDisplayString(String(r.created_at ?? r.createdAt ?? ""))}</td></tr>`,
          )
          .join("\n");

  const findingRows =
    safeFindings.length === 0
      ? `        <tr><td colspan="6" class="empty">No findings recorded</td></tr>`
      : safeFindings
          .map(
            (f) =>
              `        <tr><td>${toDisplayString(f.id)}</td><td>${toDisplayString(String(f.runId ?? f.run_id ?? ""))}</td><td>${toDisplayString(f.status ?? "")}</td><td>${toDisplayString(f.title ?? "")}</td><td>${toDisplayString(f.severity ?? "")}</td><td>${toDisplayString(f.adapter ?? "")}</td></tr>`,
          )
          .join("\n");

  // Inline CSS only — no external fetch, no url(), no @import, no http references
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inspector Evidence Report</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:2rem;color:#111;background:#fff;line-height:1.5}
h1{font-size:1.6rem;margin-bottom:.25rem}h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
.meta{color:#555;font-size:.9rem;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;margin-top:.75rem;font-size:.9rem}
th,td{border:1px solid #ddd;padding:.5rem .6rem;text-align:left;vertical-align:top}
th{background:#f6f6f6;font-weight:600}
tr:nth-child(even) td{background:#fafafa}
.empty{color:#777;text-align:center;font-style:italic}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em}
.footer{margin-top:2rem;color:#777;font-size:.8rem;border-top:1px solid #eee;padding-top:.75rem}
</style>
</head>
<body>
<h1>Inspector Evidence Report</h1>
<p class="meta">Static evidence report — offline, no server, no external requests. Generated from durable runs and findings.</p>

<h2>Runs (${safeRuns.length})</h2>
<table aria-label="Runs">
<thead><tr><th>Run ID</th><th>Status</th><th>Adapter</th><th>Created At</th></tr></thead>
<tbody>
${runRows}
</tbody>
</table>

<h2>Findings (${safeFindings.length})</h2>
<table aria-label="Findings">
<thead><tr><th>Finding ID</th><th>Run ID</th><th>Status</th><th>Title</th><th>Severity</th><th>Adapter</th></tr></thead>
<tbody>
${findingRows}
</tbody>
</table>

<p class="footer">Inspector report — deterministic, redacted, file-local.</p>
</body>
</html>`;
}
