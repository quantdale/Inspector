import { PROTOCOL_VERSION, type CapabilityDoc } from "@inspector/protocol";

export const ELECTRON_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "electron-chromium",
  capabilities: {
    observe: ["uiTree", "screenshot", "console", "network", "storage", "trace"],
    act: ["click", "fill", "press", "select", "navigate", "back", "forward", "reload", "wait"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
  },
};
