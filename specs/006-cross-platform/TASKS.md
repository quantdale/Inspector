# Specification 006 — Task Graph

## C0 — Common conformance contract

- [x] `runCommonConformance` in `@inspector/adapter-sdk`: protocol version negotiation, deterministic seeded baseline + reset restoration, semantic uiTree observation model, TARGET_FAILURE vs ACTION_FAILED classification — parameterized per interaction model.

## C1 — CLI/PTY adapter

- [x] Injectable `PtyBackend` (spawn/write/readScreen/isAlive/kill); production wrapper binds node-pty/ConPTY to the same contract.
- [x] `MockPtyBackend` simulating the seeded "seedcli" REPL with hidden defects (boundary login crash, counter overflow at >=8 printing NaN and aborting, boom abort).
- [x] `CliAdapterHandler`: line-entry interaction model (fill = submit command), fixed-height screen buffer as semantic uiTree, process death -> TARGET_FAILURE, command-not-found -> ACTION_FAILED.
- [x] Counter overflow defect confirmed through the adapter boundary.

## C2 — Electron adapter

- [x] `ElectronAdapterHandler` deliberately reuses web browser semantics (delegates sensing/acting to the Chromium-backed handler) with Electron identity (`electron-chromium` caps, `electron:` URL scheme, main-process log channel) and injectable app content.
- [x] Passes common conformance; injected app-quit fault classified separately from target failures.

## C3 — Windows adapter

- [x] Injectable `UiaBackend` (tree/invoke/setValue/errors/reset); production wrapper binds a UIA client or Appium Windows driver to the same contract.
- [x] `MockUiaBackend` simulating the SeedBank Win32 dialog with mirrored hidden defects.
- [x] `WindowsAdapterHandler`: invoke-by-id clicks, value-set fills, control-tree observations; counter overflow defect confirmed through the UIA boundary.

## Acceptance (all passing)

- all three adapters pass the common conformance contract;
- evidence produced in the same schema (IAP outcomes/observations/uiTree);
- no platform branching in core finding semantics (all platform logic inside adapter packages);
- reset produces deterministic fixture state for each platform;
- genuine target failures differ from automation misses and adapter crashes on every platform.

Gate: M6 exit gate satisfied — CLI, Electron, and Windows adapters pass the common conformance contract with clean boundaries.
