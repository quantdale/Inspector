/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 640,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.loadFile(path.join(__dirname, "renderer.html"));
  console.log("inspector-electron-fixture:ready");
});

app.on("window-all-closed", () => app.quit());
