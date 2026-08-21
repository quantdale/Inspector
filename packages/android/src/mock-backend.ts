import type { AdbBackend } from "./types.js";

/**
 * Seeded Android target app ("SeedDroid", package com.seedbank.droid).
 * Mirrors the seeded web app semantics so the same core finding/reproduction
 * pipeline proves out on a fundamentally different platform.
 */
export const SEED_PACKAGE = "com.seedbank.droid";

interface MockElement {
  id: string;
  cls: "EditText" | "Button" | "TextView";
  text: string;
  bounds: [number, number, number, number]; // x, y, w, h
  hidden?: boolean;
}

interface MockApp {
  screen: "login" | "dashboard";
  username: string;
  password: string;
  message: string;
  count: number;
  focused: string | null;
  errors: string[];
  installed: boolean;
}

function initialApp(): MockApp {
  return {
    screen: "login",
    username: "",
    password: "",
    message: "",
    count: 0,
    focused: null,
    errors: [],
    installed: true,
  };
}

function render(app: MockApp): MockElement[] {
  if (app.screen === "login") {
    return [
      { id: "username", cls: "EditText", text: app.username, bounds: [40, 200, 400, 56] },
      { id: "password", cls: "EditText", text: app.password, bounds: [40, 280, 400, 56] },
      { id: "login", cls: "Button", text: "Log in", bounds: [40, 380, 400, 64] },
      { id: "msg", cls: "TextView", text: app.message, bounds: [40, 480, 400, 32] },
    ];
  }
  return [
    { id: "welcome", cls: "TextView", text: `Welcome ${app.username}`, bounds: [40, 120, 400, 40] },
    { id: "count", cls: "TextView", text: String(app.count), bounds: [40, 200, 400, 48] },
    { id: "increment", cls: "Button", text: "Increment", bounds: [40, 280, 400, 64] },
    { id: "save", cls: "Button", text: "Save preference", bounds: [40, 370, 400, 64] },
    { id: "boom", cls: "Button", text: "Trigger crash", bounds: [40, 460, 400, 64] },
    { id: "logout", cls: "Button", text: "Log out", bounds: [40, 550, 400, 64] },
  ];
}

function uiautomatorXml(app: MockApp): string {
  const nodes = render(app)
    .map((el, i) => {
      const [x, y, w, h] = el.bounds;
      const resId = `${SEED_PACKAGE}:id/${el.id}`;
      const cls = `android.widget.${el.cls}`;
      return [
        `<node index="${i}" text="${escapeXml(el.text)}" resource-id="${resId}"`,
        `class="${cls}" package="${SEED_PACKAGE}" content-desc=""`,
        `checkable="false" checked="false" clickable="${el.cls === "Button"}"`,
        `enabled="true" focusable="${el.cls === "EditText"}" focused="${app.focused === el.id}"`,
        `scrollable="false" selected="false" bounds="[${x},${y}][${x + w},${y + h}]" />`,
      ].join(" ");
    })
    .join("\n  ");
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<hierarchy rotation="0">\n  ${nodes}\n</hierarchy>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * In-process mock ADB backend simulating one device running SeedDroid.
 * Implements the same contract as a real `adb` CLI wrapper.
 */
export class MockAdbBackend implements AdbBackend {
  private readonly apps = new Map<string, MockApp>();
  private readonly logs = new Map<string, string[]>();
  deviceCrashed = false;

  async devices(): Promise<string[]> {
    this.assertAlive();
    return ["emulator-5554"];
  }

  async shell(serial: string, cmd: string): Promise<string> {
    this.assertAlive();
    const app = this.appFor(serial);

    if (cmd.startsWith("uiautomator dump")) {
      return uiautomatorXml(app);
    }

    if (cmd.startsWith("am force-stop") || cmd.startsWith("pm clear")) {
      this.apps.set(serial, initialApp());
      return "Success";
    }

    if (cmd.startsWith("input tap")) {
      const [, , xs, ys] = cmd.split(/\s+/);
      const x = Number(xs);
      const y = Number(ys);
      this.tap(app, serial, x, y);
      return "";
    }

    if (cmd.startsWith("input text")) {
      const value = cmd.slice("input text".length).trim();
      if (!app.focused || app.screen !== "login") {
        throw new Error(`ERROR: no focused field for input text '${value}'`);
      }
      if (app.focused === "username") app.username = value;
      else if (app.focused === "password") app.password = value;
      else throw new Error("ERROR: unknown focused field");
      return "";
    }

    if (cmd.startsWith("input keyevent")) {
      return ""; // accepted, no-op on the mock
    }

    throw new Error(`unsupported shell command: ${cmd}`);
  }

  async screencap(): Promise<Buffer> {
    this.assertAlive();
    // Minimal valid PNG header bytes stand in for a screenshot.
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  async logcat(serial: string, lines = 20): Promise<string[]> {
    this.assertAlive();
    return (this.logs.get(serial) ?? []).slice(-lines);
  }

  async appErrors(serial: string): Promise<string[]> {
    return [...this.appFor(serial).errors];
  }

  async install(serial: string): Promise<void> {
    this.assertAlive();
    if (!this.apps.has(serial)) this.apps.set(serial, initialApp());
  }

  async uninstall(serial: string): Promise<void> {
    this.assertAlive();
    this.apps.set(serial, initialApp());
  }

  /** Test/diagnostic hook: current app state. */
  stateFor(serial: string): MockApp {
    return this.appFor(serial);
  }

  private appFor(serial: string): MockApp {
    let app = this.apps.get(serial);
    if (!app) {
      app = initialApp();
      this.apps.set(serial, app);
    }
    return app;
  }

  private log(serial: string, line: string): void {
    const arr = this.logs.get(serial) ?? [];
    arr.push(`${Date.now()} E SeedDroid: ${line}`);
    this.logs.set(serial, arr);
  }

  private assertAlive(): void {
    if (this.deviceCrashed) throw new Error("error: device offline (injected fault)");
  }

  private tap(app: MockApp, serial: string, x: number, y: number): void {
    const hit = render(app).find(
      (el) =>
        !el.hidden &&
        x >= el.bounds[0] &&
        x <= el.bounds[0] + el.bounds[2] &&
        y >= el.bounds[1] &&
        y <= el.bounds[1] + el.bounds[3],
    );
    if (!hit) throw new Error(`ERROR: nothing tappable at ${x},${y}`);

    if (hit.cls === "EditText") {
      app.focused = hit.id;
      return;
    }
    if (hit.cls !== "Button") return;

    switch (hit.id) {
      case "login": {
        if (app.username.length >= 64 || app.username === "CRASH") {
          app.errors.push("HiddenValidationCrash");
          this.log(serial, "HiddenValidationCrash");
          return;
        }
        if (app.username && app.password) {
          app.screen = "dashboard";
          app.focused = null;
        } else {
          app.message = "invalid credentials";
        }
        return;
      }
      case "increment": {
        app.count += 1;
        if (app.count >= 8) {
          app.count = Number.NaN;
          app.errors.push("IncrementOverflowCrash");
          this.log(serial, "IncrementOverflowCrash");
        }
        return;
      }
      case "save":
        return;
      case "boom": {
        app.errors.push("IntentionalAppCrash");
        this.log(serial, "IntentionalAppCrash");
        return;
      }
      case "logout":
        this.apps.set(serial, initialApp());
        return;
      default:
        return;
    }
  }
}
