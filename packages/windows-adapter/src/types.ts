/**
 * Injectable UI Automation backend (M6 C3). Mirrors the subset of the
 * Windows UI Automation API Inspector needs: tree inspection, invocation,
 * value setting. A production implementation binds to a UIA client
 * (or an Appium Windows driver); conformance runs against the mock.
 */
export interface UiaNode {
  id: string;
  type: "Edit" | "Button" | "Text";
  text: string;
  enabled: boolean;
}

/** A top-level window as reported by the backend's window enumeration. */
export interface UiaWindowRef {
  pid: number;
  title: string;
}

/** Typed failure codes surfaced by windows-adapter backends. */
export type WindowsErrorCode =
  | "DEAD_WINDOW"
  | "MODAL_BLOCKING"
  | "WINDOW_NOT_FOUND"
  | "REATTACH_FAILED";

/**
 * Typed backend error so consumers can branch on code instead of parsing
 * messages (e.g. DEAD_WINDOW after the target process died).
 */
export class WindowsBackendError extends Error {
  readonly code: WindowsErrorCode;
  constructor(code: WindowsErrorCode, message: string) {
    super(message);
    this.name = "WindowsBackendError";
    this.code = code;
  }
}

/** Parameters for waitForWindow. */
export interface WaitForWindowParams {
  pid?: number;
  titleContains?: string;
  /** Bounded poll deadline in milliseconds. Default 10000, clamped to 60000. */
  timeoutMs?: number;
}

export interface UiaBackend {
  /** Current control tree of the focused window. */
  tree(): Promise<UiaNode[]>;
  /** Invoke (press) a control by automation id. */
  invoke(id: string): Promise<void>;
  /** Set the value of an edit control. */
  setValue(id: string, value: string): Promise<void>;
  /** Fatal application errors recorded since launch. */
  errors(): Promise<string[]>;
  /** Restore the seeded fixture state. */
  reset(): Promise<void>;
}

/**
 * Optional extended capabilities. RealUiaBackend and MockUiaBackend both
 * implement them; injected fakes may omit them.
 */
export interface UiaBackendWindowOps {
  /** Enumerate enabled top-level windows. */
  listWindows(): Promise<UiaWindowRef[]>;
  /**
   * Bounded poll (250ms interval) until a top-level window matching pid or
   * title substring appears; throws WINDOW_NOT_FOUND on timeout. Handles the
   * UWP launcher-pid gap where a freshly spawned app is absent from the
   * window list for several seconds.
   */
  waitForWindow(params: WaitForWindowParams): Promise<UiaWindowRef>;
  /** Liveness of the attached window and its owning process. */
  windowStatus(): Promise<{ alive: boolean; pid: number }>;
}
