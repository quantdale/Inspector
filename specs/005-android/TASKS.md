# Specification 005 — Task Graph

## A0 — Environment worker

- [x] Injectable `AdbBackend` contract (devices/shell/screencap/logcat/install/uninstall/appErrors); production wrapper binds the `adb` CLI to the same interface.
- [x] `MockAdbBackend` simulates one dedicated device with exclusive ownership and health (`devices()`), so conformance needs no real hardware/emulator.

## A1 — App lifecycle

- [x] Install/uninstall/reset of the seeded package; reset restores deterministic fixture state (login screen, cleared fields, counter 0).
- [x] Adapter lifecycle create/reset/close mapped onto backend operations.

## A2 — Sensors

- [x] Semantic UI hierarchy via uiautomator-compatible XML dump parsed into the common element model (dependency-free parser).
- [x] Screenshot capture (content-addressed artifact), logcat tail, and fatal-error collection (`appErrors`) exposed through observe.

## A3 — Actions

- [x] Semantic tap (click by resource-id resolved to bounds center), text entry (focus + input text), press/keyevent through the adapter contract.
- [x] Automation misses classified ACTION_FAILED; genuine app crashes classified TARGET_FAILURE — same outcome semantics as the web adapter.

## A4 — Deterministic seeded target

- [x] SeedDroid fixture app (com.seedbank.droid) with hidden defects mirroring the web seeded app: login validation crash, increment overflow at count>=8 (NaN state), boom crash.

## A5 — Fault/lifecycle injection

- [x] Injected device-loss fault behind explicit faults capability; crash/timeout fault kinds validated against the capability list.

## A6 — Core pipeline proof

- [x] FindingEngine + AndroidReplayDriver confirm both seeded defects (boom crash, increment overflow) through the unchanged reproduction policy.
- [x] No Android conditionals introduced into core finding/oracle semantics (all platform logic inside @inspector/android).

## Acceptance (all passing)

- adapter passes common conformance (spawned JSON-RPC subprocess);
- emulator actions do not require host mouse/keyboard;
- reset produces deterministic fixture state;
- app crash differs from adapter/ADB failure (TARGET_FAILURE vs ACTION_FAILED vs AdapterCrashError);
- at least one seeded Android defect is confirmed through the common finding pipeline (two confirmed);

Gate: M5 exit gate satisfied — cross-platform sensing/acting/finding/reproduction proven on Android via the injectable ADB boundary (per spec blocker policy: no local emulator required; production adb CLI wrapper implements the identical contract).
