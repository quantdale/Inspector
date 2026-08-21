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
