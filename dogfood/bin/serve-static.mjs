#!/usr/bin/env node
// Minimal stdlib-only static file server for dogfood web targets.
// Usage: node serve-static.mjs --port 8123 --dir /path/to/root
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8123" },
    dir: { type: "string", default: "." },
  },
});

const root = resolve(values.dir);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // Resolve and reject anything escaping the root (traversal guard).
    const filePath = resolve(join(root, "." + pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    let fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    if (!fileStat) {
      res.writeHead(404).end("not found");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(`server error: ${err?.message ?? err}`);
  }
});

server.listen(values.port, "127.0.0.1", () => {
  console.log(`serving ${root} at http://127.0.0.1:${values.port}`);
});
