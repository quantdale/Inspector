import type { UiaBackend, UiaNode } from "./types.js";

interface MockWinApp {
  screen: "login" | "dashboard";
  username: string;
  password: string;
  message: string;
  count: number;
  errors: string[];
}

function initial(): MockWinApp {
  return { screen: "login", username: "", password: "", message: "", count: 0, errors: [] };
}

/**
 * Seeded Win32 target ("SeedBank dialog"). Hidden defects mirror the other
 * seeded targets so the common finding pipeline proves out on Windows.
 */
export class MockUiaBackend implements UiaBackend {
  deviceCrashed = false;
  private app: MockWinApp = initial();

  async tree(): Promise<UiaNode[]> {
    this.assertAlive();
    const a = this.app;
    if (a.screen === "login") {
      return [
        { id: "usernameLabel", type: "Text", text: "Username", enabled: true },
        { id: "username", type: "Edit", text: a.username, enabled: true },
        { id: "password", type: "Edit", text: a.password, enabled: true },
        { id: "loginBtn", type: "Button", text: "Log in", enabled: true },
        { id: "msg", type: "Text", text: a.message, enabled: true },
      ];
    }
    return [
      { id: "welcome", type: "Text", text: `Welcome ${a.username}`, enabled: true },
      { id: "count", type: "Text", text: Number.isNaN(a.count) ? "NaN" : String(a.count), enabled: true },
      { id: "incrementBtn", type: "Button", text: "Increment", enabled: true },
      { id: "saveBtn", type: "Button", text: "Save preference", enabled: true },
      { id: "boomBtn", type: "Button", text: "Trigger crash", enabled: true },
      { id: "logoutBtn", type: "Button", text: "Log out", enabled: true },
    ];
  }

  async invoke(id: string): Promise<void> {
    this.assertAlive();
    const a = this.app;
    const visible = await this.tree();
    const node = visible.find((n) => n.id === id && n.type === "Button");
    if (!node) throw new Error(`element not found or not invokable: ${id}`);
    switch (id) {
      case "loginBtn": {
        if (a.username.length >= 64 || a.username === "CRASH") {
          a.errors.push("HiddenValidationCrash");
          return;
        }
        if (a.username && a.password) {
          a.screen = "dashboard";
        } else {
          a.message = "invalid credentials";
        }
        return;
      }
      case "incrementBtn": {
        a.count += 1;
        if (a.count >= 8) {
          a.count = Number.NaN;
          a.errors.push("IncrementOverflowCrash");
        }
        return;
      }
      case "boomBtn":
        a.errors.push("IntentionalAppCrash");
        return;
      case "logoutBtn":
        this.app = initial();
        return;
      default:
        return;
    }
  }

  async setValue(id: string, value: string): Promise<void> {
    this.assertAlive();
    if (this.app.screen !== "login") throw new Error(`element not found: ${id}`);
    if (id === "username") this.app.username = value;
    else if (id === "password") this.app.password = value;
    else throw new Error(`element not found or not editable: ${id}`);
  }

  async errors(): Promise<string[]> {
    return [...this.app.errors];
  }

  async reset(): Promise<void> {
    this.app = initial();
  }

  private assertAlive(): void {
    if (this.deviceCrashed) throw new Error("UIA client disconnected (injected fault)");
  }
}
