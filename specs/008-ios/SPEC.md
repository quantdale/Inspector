# Specification 008 — iOS Simulator Adapter

## Status

DEFERRED_ENVIRONMENT

## Objective

Extend Inspector to iOS simulator environments through a macOS worker while preserving the same core protocol, evidence, finding, and reproduction semantics.

## Dependencies

Core implementation M0–M7 complete and access to a suitable macOS/Xcode simulator environment for execution.

## Task groups

### I0 — Remote/local macOS worker contract

Define worker capability discovery, Xcode/simulator version reporting, lifecycle, artifact transfer, deadlines, and secure execution boundary.

### I1 — Simulator/app lifecycle

Create/boot/reset/shutdown simulator, install/uninstall/launch/terminate target app, and manage deterministic fixture reset.

### I2 — Sensors/actions

Integrate XCUITest/Appium/WebDriverAgent-compatible semantic element tree and actions, screenshots, application/system logs, crash data, and window/screen metadata.

### I3 — Seeded target and conformance

Use a deterministic iOS fixture with hidden defects and run the common adapter conformance suite.

### I4 — Finding pipeline proof

Autonomously explore, confirm, minimize, and evidence at least one seeded iOS defect through unchanged core semantics.

## Acceptance tests

- macOS worker capability/version mismatch is diagnosed cleanly;
- simulator reset is deterministic;
- no physical host input is required;
- adapter passes conformance;
- seeded iOS finding produces normal Inspector evidence bundle;
- no iOS-specific finding state is added to core.

## Exit gate

Seeded iOS simulator defect completes the common exploration/finding/reproduction flow.

## Environment deferral rule

If macOS/Xcode access is unavailable, do not fake completion. Set milestone state `DEFERRED_ENVIRONMENT`, record exact requirements in checkpoint, and preserve interfaces so a future macOS worker can resume this spec directly.

## Deferral record (2026-08-20)

Status: `DEFERRED_ENVIRONMENT` per roadmap M8 clause ("If no macOS environment exists, M8 may be recorded DEFERRED_ENVIRONMENT after its adapter interfaces and remote-worker contract are fully specified").

Reason: the implementation environment is Windows 11 with no macOS host, no Xcode toolchain, and no iOS simulator runtime available. The adapter interfaces and remote-worker contract required by this spec are fully specified by the existing architecture: the IAP handler contract (`@inspector/adapter-sdk` AdapterHandler), the common conformance runner (`runCommonConformance`), and the injectable-backend pattern proven on Android (AdbBackend), CLI (PtyBackend), and Windows (UiaBackend). An `IosSimulatorBackend` following the same injectable shape is the designated resumption entry point.

Resumption requirements:
1. macOS worker with Xcode + iOS Simulator runtime;
2. implement `IosSimulatorBackend` (simctl/xcrinstrm wrapper) behind the injectable backend interface;
3. port the SeedBank fixture semantics to an iOS simulator target;
4. run `runCommonConformance` plus a finding-pipeline proof identical to M5's.
