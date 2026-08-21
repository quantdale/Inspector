# Dogfood Targets

Real, independently developed applications that Inspector hunts against during the
RC1 dogfood campaign. These are **not** Inspector's seeded fixtures — they are
third-party apps acquired from npm or preinstalled local programs, so findings
against them exercise the full unscripted exploration pipeline.

This directory is harness-only. Acquired target sources live in the gitignored
scratch area `.inspector/rc-work/targets/`; nothing under `packages/**` is touched.

## Target manifest format

One YAML file per target in `dogfood/targets/<id>.yaml` (`.template.yaml` suffix for
not-yet-real targets). Fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier used by hunt tooling and state files |
| `platform` | `web` \| `cli` \| `windows-uia` \| `android` |
| `source` | Provenance (origin/package) and license note |
| `acquisition` | Exact commands to fetch/build the target (or "none — preinstalled") |
| `serve` / `launch` | Command + working dir to bring the target up |
| `readiness_check` | URL/content to poll (web) or process/UIA condition (native) |
| `reset_strategy` | How to return the target to a clean pre-hunt state |
| `teardown` | How to shut it down cleanly |
| `recommended_hunt_budget` | `max_actions` / `max_minutes` for a single hunt |
| `authorized_for_repair` | Always `false` for external targets — their repos are read-only for us; Inspector reports findings, never patches them |
| `notes` | Gotchas a hunt-running agent must know |

## Current roster

| id | platform | what | where |
| --- | --- | --- | --- |
| `todomvc-react` | web | React TodoMVC SPA (`todomvc-react@1.0.4`, MIT), static bundle, in-memory state | `.inspector/rc-work/targets/todomvc-react/` |
| `todomvc-backbone` | web | Backbone TodoMVC with localStorage persistence (official `todomvc@0.1.1` example, MIT) | `.inspector/rc-work/targets/todomvc-backbone/` |
| `vim-scratch` | cli | Interactive vim session on a sandbox file (vim 9.2 at `/usr/bin/vim`) | `.inspector/rc-work/targets/vim-sandbox/` |
| `mspaint-uia` | windows-uia | Microsoft Paint (WindowsApps install, verified present) | local |
| `calc-uia` | windows-uia | Windows Calculator (`C:\Windows\System32\calc.exe`, verified present) | local |
| `android-settings-template` | android | Template for com.android.settings on a booted AVD; boot procedure lives with the adapter | emulator |

## Serving a web target

Use the stdlib-only server (no dependencies):

```sh
node dogfood/bin/serve-static.mjs --port 8123 --dir .inspector/rc-work/targets/todomvc-react
node dogfood/bin/serve-static.mjs --port 8124 --dir .inspector/rc-work/targets/todomvc-backbone/app
```

It binds `127.0.0.1`, serves correct MIME types for html/js/css/json/svg, returns
404 for missing paths, and rejects path traversal outside `--dir`.

## Pointing a hunt at a target

Web hunts are pointed at a running target via the CLI `--url` flag, e.g.
`inspector hunt --url http://127.0.0.1:8123/`. The CLI hunt command is being built
in parallel — until it lands, this is the contract the target manifests are written
against. CLI/UIA/Android targets are launched per their manifest and reached through
the corresponding platform adapter (PTY, UIA tree, accessibility tree).

## Re-acquiring the web targets

Both come from npm tarballs on registry.npmjs.org (no GitHub access needed):

```sh
TARGETS=.inspector/rc-work/targets   # or any scratch dir outside the repo
mkdir -p /tmp/cand "$TARGETS/todomvc-backbone" && cd /tmp/cand
curl -sO https://registry.npmjs.org/todomvc-react/-/todomvc-react-1.0.4.tgz
tar xzf todomvc-react-1.0.4.tgz && cp -r package/dist/* "$OLDPWD/$TARGETS/todomvc-react/"
curl -sO https://registry.npmjs.org/todomvc/-/todomvc-0.1.1.tgz
tar xzf todomvc-0.1.1.tgz package/examples/backbone package/license.md
cp -r package/examples/backbone "$OLDPWD/$TARGETS/todomvc-backbone/app"
```

Once fetched, both run fully offline (all assets served locally).

## Cleanup

- Kill any `serve-static.mjs` processes (`node dogfood/bin/serve-static.mjs ...`).
- Delete scratch acquisitions: `rm -rf .inspector/rc-work/targets/` (gitignored;
  re-acquire via the commands above).
- Native targets: ensure mspaint/calc/vim processes have exited and no vim swap
  files remain in `vim-sandbox/`.

## Dropped candidates (quality over quota)

- `react-shopping-cart@1.9.5` — a component library shipping JS modules, not a
  servable SPA demo; nothing to point a browser at.
- `jsonplaceholder`-style APIs — require runtime network; violates offline rule.
- `todomvc-express` — viable but needs an `npm install` of express deps at runtime
  setup; the two static TodoMVC targets cover the same surface with less machinery.
