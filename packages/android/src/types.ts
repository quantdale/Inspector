/**
 * Injectable ADB backend (M5). The adapter speaks to this interface only, so
 * conformance and the finding/reproduction pipeline run against a mock
 * backend without real hardware or an emulator. A production backend wraps
 * the `adb` CLI with the same contract.
 */
export interface AdbBackend {
  /** Connected device serials. */
  devices(): Promise<string[]>;
  /** Run a shell command on the device; returns stdout. */
  shell(serial: string, cmd: string): Promise<string>;
  /** Capture a PNG screenshot of the current display. */
  screencap(serial: string): Promise<Buffer>;
  /** Read recent logcat lines. */
  logcat(serial: string, lines?: number): Promise<string[]>;
  /** Install an APK. */
  install(serial: string, apkPath: string): Promise<void>;
  /** Uninstall a package (resets app data). */
  uninstall(serial: string, pkg: string): Promise<void>;
  /**
   * Fatal application errors recorded since launch (real backends grep logcat
   * for FATAL EXCEPTION). Used by the adapter to classify genuine app crashes
   * (TARGET_FAILURE) separately from automation misses (ACTION_FAILED).
   */
  appErrors(serial: string): Promise<string[]>;
}

export interface AndroidFaults {
  crashDevice?: boolean;
}
