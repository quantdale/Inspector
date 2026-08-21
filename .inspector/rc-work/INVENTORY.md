# Production Backend Inventory — RC Dogfood Machine

Probed empirically on 2026-08-21 (Windows 11, Git Bash, Node v22.23.2, pnpm 9.15.9).
Every claim below was verified by running a command; nothing is assumed.

## Matrix

| Platform | Production backend | Available? | Evidence | Notes / gaps |
|---|---|---|---|---|
| Web | Playwright + Chromium | **YES** | `%LOCALAPPDATA%/ms-playwright` has `chromium-1217`, `chromium-1234`, `chromium_headless_shell-1217/1234`, `ffmpeg-1011`. Repo has `playwright@1.62.1` in `node_modules/.pnpm`. End-to-end launch test passed: `CHROMIUM_LAUNCH_OK 151.0.7922.34`, page navigation + DOM read worked. | Fully production-ready. Note: `playwright` is not hoisted to root `node_modules`; resolve via `node_modules/.pnpm/playwright@1.62.1/node_modules/playwright` or a workspace package dep. `npx playwright --version` fails outside a package that declares it; use `pnpm exec` inside the right package. |
| CLI | Real PTY via `@lydell/node-pty` | **YES** | Fresh install into `$TEMP/pty-probe` (`npm install @lydell/node-pty`) succeeded; `pty.spawn('cmd.exe', ['/c','echo hello'])` returned `hello\r\n` with exit code 0 and full VT sequences. Prebuilt win32-x64 binary for Node 22 works out of the box. | Proven end-to-end. `node-pty` (original) not tested since @lydell succeeded on first try. |
| Electron | Electron runtime | **PARTIAL** (fetchable, not installed) | No `electron*` in `node_modules/.pnpm`; `%LOCALAPPDATA%/electron/Cache` empty. Registry reachable: `npm view electron version` → `43.4.1`. GitHub releases binary host reachable: HEAD on `electron-v33.0.0-win32-x64.zip` → 302 → 200. | Binary download path (github.com/releases → objects.githubusercontent.com) confirmed working, so `pnpm add electron` should succeed. Not yet actually installed — do it as part of adapter bring-up. |
| Android | ADB + SDK + emulator | **YES** (toolchain), emulator not currently running | `adb` at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`, v1.0.41 / 37.0.1-15733141. `ANDROID_HOME`/`ANDROID_SDK_ROOT` set. Emulator binary present; system images for API 36 (default, google_apis, google_apis_playstore, all x86_64); two AVDs exist: `CRBABot_API_36`, `Nitro_API_36`. | Surprise: `adb devices` initially showed `emulator-5554 device`, but `adb shell` hung forever and no `qemu-system-x86_64.exe` process existed — a stale adb-server entry. After `adb kill-server`, zero devices. Boot an AVD fresh before any Android dogfooding; treat "device listed" as insufficient evidence of liveness. |
| Windows | UI Automation (UIA) | **YES** | PowerShell `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes` works (.NET Framework built in). Enumerated root-level windows with names + PIDs (Brave, NitroSense, Apple Software Update observed). Launched Paint via `Start-Process mspaint`: window found by name, control tree walked (55 Button elements found). Closed it. Also launched Calculator (`calc`) successfully. | Gap: classic Win32 **Notepad is NOT installed** — `start notepad` opens a Store "Pick an app" picker (closed it programmatically). Use Paint/Calculator or another real app for UIA dogfood. API note: use `element.GetCurrentPattern(WindowPattern.Pattern)`, not `.GetPattern()` (doesn't exist on AutomationElement). |
| CLI targets | git | YES | git 2.55.0.windows.3 | |
| CLI targets | python | YES | Python 3.13.15 (`AppData\Local\Programs\Python\Python313`) | |
| CLI targets | sqlite3 | YES | 3.50.6 (via Android platform-tools on PATH) | |
| CLI targets | gh CLI | **NO** | `where gh` empty | Install if GitHub API work needed beyond curl (api.github.com itself is reachable). |
| CLI targets | vim | YES | Git-bundled vim (`Git\usr\bin\vim.exe`) — good interactive PTY target. | |
| Windows apps | notepad / calc / mspaint | calc YES, mspaint YES, notepad NO | `where` hits for `calc.exe` and `mspaint.exe`; notepad resolves only to Git's shim and fails to launch a real editor. | Both calc and mspaint are modern Store-backed apps (UIA-accessible, proven above). |
| Network | registry.npmjs.org | **YES** | HTTPS 200; package tarball downloaded and extracted (`left-pad-1.3.0.tgz`). | Full egress proven end-to-end. |
| Network | cdn.jsdelivr.net / unpkg.com | **YES** | Both return HTTP 200 for package files. | |
| Network | github.com codeload/archive/git-clone tarballs | **NO** | `codeload.github.com/.../tar.gz/*` returns literal `404: Not Found` (14-byte body) for valid repos/tags; `github.com/<repo>/archive/...tar.gz` also 404s; `git clone --depth 1` of a public repo → "Repository not found". Meanwhile `api.github.com` JSON works and github.com HTML returns 200. | Egress filter/proxy blocks repo-content endpoints but allows API + releases binaries. Consequence: vendor open-source dogfood targets via **npm registry tarballs** or **GitHub release assets**, not source archives. |

## Surprises & action items

1. **Notepad missing** — the canonical UIA smoke-test app isn't installed. Pick Paint, Calculator, or install Notepad from the Store.
2. **Stale adb emulator entry** — adb can report a dead emulator as `device`. Inspector's Android adapter must verify shell responsiveness (e.g., `getprop sys.boot_completed` with timeout), not just device presence.
3. **GitHub source-tarball egress blocked** while release-asset downloads work — pin vendored targets to npm tarballs or GitHub Releases.
4. **Electron not yet installed** but its entire fetch chain (npm metadata + binary CDN) is proven; installation is low-risk.
5. **gh CLI absent** — fine for now; api.github.com is directly reachable.
6. Two AVDs (`CRBABot_API_36`, `Nitro_API_36`) already exist on API 36 x86_64 — candidate Android dogfood targets may already be provisioned on them.
