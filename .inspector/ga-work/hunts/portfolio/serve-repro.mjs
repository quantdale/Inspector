// Isolated repro: does the portfolio-style server stay up while a hunt runs?
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = "C:/Users/Michael Roy/Documents/Inspector/.inspector/rc-work/targets/todomvc-react";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const fp = join(dir, p === "/" ? "index.html" : p);
    if (!fp.startsWith(dir) || !existsSync(fp) || statSync(fp).isDirectory()) {
      res.writeHead(404); res.end("nf"); return;
    }
    const ext = fp.slice(fp.lastIndexOf("."));
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(fp));
  } catch (e) {
    console.log("HANDLER ERROR:", String(e));
    try { res.writeHead(500); res.end(); } catch {}
  }
});
server.on("error", (e) => console.log("SERVER ERROR:", String(e)));
server.on("close", () => console.log("SERVER CLOSED"));
await new Promise((r) => server.listen(8127, "127.0.0.1", r));
console.log("up on 8127");

const { resolveArtifactEntry } = await import("../../tools/discovery.mjs");
const entry = resolveArtifactEntry();
const ws = join(process.env.TEMP ?? "C:/temp", "ga-p4-repro");
const child = spawn(process.execPath, [entry, "hunt", "--adapter", "web", "--url", "http://127.0.0.1:8127/", "--workspace", ws, "--max-actions", "15", "--max-minutes", "2", "--seed", "5", "--json"]);
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
child.on("close", (code) => {
  console.log("hunt exit:", code);
  console.log(out.slice(0, 1200));
  server.close();
  process.exit(0);
});
setInterval(() => {}, 10000);
