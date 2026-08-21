/**
 * Injectable PTY backend (M6 C1). The adapter speaks to this interface only;
 * a production implementation wraps node-pty or the platform ConPTY API.
 */
export interface PtySession {
  id: string;
}

export interface PtyBackend {
  spawn(program: string): Promise<PtySession>;
  /** Write input to the session; include "\n" to submit a line. */
  write(sessionId: string, data: string): Promise<void>;
  /** Visible screen buffer lines (fixed height, padded). */
  readScreen(sessionId: string): Promise<string[]>;
  isAlive(sessionId: string): Promise<boolean>;
  kill(sessionId: string): Promise<void>;
}
