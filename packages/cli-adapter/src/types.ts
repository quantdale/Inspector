/**
 * Injectable PTY backend (M6 C1). The adapter speaks to this interface only;
 * a production implementation wraps node-pty or the platform ConPTY API.
 */
export interface PtySession {
  id: string;
}

/** Deterministic terminal state rather than accumulated scrollback alone. */
export interface TerminalSnapshot {
  cols: number;
  rows: number;
  /** Current viewport as trimmed display rows. */
  viewport: string[];
  /** Cell contents, including trailing spaces, for stable redraw semantics. */
  cells: string[][];
  scrollback: string[];
  cursor: { row: number; col: number; visible: boolean };
}

export interface PtyBackend {
  spawn(program: string, args?: string[]): Promise<PtySession>;
  /** Write input to the session; include "\n" to submit a line. */
  write(sessionId: string, data: string): Promise<void>;
  /** Visible screen buffer lines (fixed height, padded). */
  readScreen(sessionId: string): Promise<string[]>;
  /** Optional VT-aware snapshot. Legacy injected backends may omit it. */
  readTerminal?(sessionId: string): Promise<TerminalSnapshot>;
  /** Optional deterministic resize support for full-screen TUIs. */
  resize?(sessionId: string, cols: number, rows: number): Promise<void>;
  isAlive(sessionId: string): Promise<boolean>;
  kill(sessionId: string): Promise<void>;
}
