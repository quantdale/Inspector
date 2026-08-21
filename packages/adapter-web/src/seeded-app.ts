import { createServer, type Server } from "node:http";

export interface SeedServer {
  /** Base URL of the seeded target; valid once `ready` resolves. */
  readonly url: string;
  /** Resolves when the server is accepting connections. */
  readonly ready: Promise<void>;
  close(): void;
}

export function startSeedServer(): SeedServer {
  const server: Server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(SEED_HTML);
  });
  // Bind an ephemeral port: reproduction/minimization opens many fresh
  // environments in quick succession, and fixed-range random ports eventually
  // collide (EADDRINUSE).
  let url = "";
  const ready = new Promise<void>((resolve, reject) => {
    server.once("listening", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      url = `http://127.0.0.1:${port}/`;
      resolve();
    });
    server.once("error", reject);
  });
  server.listen(0);
  return {
    get url() {
      return url;
    },
    ready,
    close: () => {
      server.close();
    },
  };
}

export const SEED_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>SeedBank</title></head>
<body>
  <h1>SeedBank Demo</h1>
  <section id="login">
    <input id="username" aria-label="username" />
    <input id="password" aria-label="password" type="password" />
    <button id="loginBtn" role="button">Log in</button>
    <p id="loginMsg" aria-live="polite"></p>
  </section>
  <section id="dashboard" hidden>
    <p id="welcome">Welcome</p>
    <button id="increment" role="button">Increment</button>
    <span id="count">0</span>
    <button id="save" role="button">Save preference</button>
    <button id="boom" role="button">Trigger crash</button>
    <a id="forbidden" href="https://evil.example.com/secret">External link</a>
  </section>
  <script>
    const $ = (id) => document.getElementById(id);
    let count = 0;
    $("loginBtn").addEventListener("click", () => {
      const u = $("username").value, p = $("password").value;
      // Hidden defect: a boundary username value crashes validation.
      if (u.length >= 64 || u === "CRASH") {
        throw new Error("HiddenValidationCrash");
      }
      if (u && p) {
        $("login").hidden = true;
        $("dashboard").hidden = false;
        $("welcome").textContent = "Welcome " + (u || "");
      } else {
        $("loginMsg").textContent = "invalid credentials";
      }
    });
    $("increment").addEventListener("click", () => {
      count += 1;
      // Hidden defect: the counter overflows at a boundary and corrupts state.
      if (count >= 8) {
        $("count").textContent = "NaN";
        throw new Error("IncrementOverflowCrash");
      }
      $("count").textContent = String(count);
    });
    $("save").addEventListener("click", () => {
      try { localStorage.setItem("pref", "saved-" + count); } catch (e) {}
    });
    $("boom").addEventListener("click", () => {
      // Deterministic application (target) crash defect.
      throw new Error("IntentionalAppCrash: boom button");
    });
    // Hidden defect: submitting a specific value crashes the handler.
    window.__seedSubmit = (v) => {
      if (v === "CRASH") { throw new Error("HiddenValidationCrash"); }
      return "ok:" + v;
    };
  </script>
</body>
</html>`;

