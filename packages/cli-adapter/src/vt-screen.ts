import type { TerminalSnapshot } from "./types.js";

const MAX_SCROLLBACK = 1000;

function blankRow(cols: number): string[] {
  return Array.from({ length: cols }, () => " ");
}

/** Small deterministic VT/ANSI screen model for PTY observations. */
export class VirtualTerminal {
  private cols: number;
  private rows: number;
  private cells: string[][];
  private scrollback: string[] = [];
  private row = 0;
  private col = 0;
  private visible = true;
  private savedCursor = { row: 0, col: 0 };
  private escape: "normal" | "csi" | "osc" | "esc" = "normal";
  private csi = "";

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.cells = Array.from({ length: this.rows }, () => blankRow(this.cols));
  }

  feed(text: string): void {
    for (const char of text) this.consume(char);
  }

  resize(cols: number, rows: number): void {
    const nextCols = Math.max(1, Math.floor(cols));
    const nextRows = Math.max(1, Math.floor(rows));
    const next = Array.from({ length: nextRows }, (_, row) => {
      const old = this.cells[row] ?? [];
      return Array.from({ length: nextCols }, (_, col) => old[col] ?? " ");
    });
    if (nextRows < this.cells.length) {
      for (const old of this.cells.slice(0, this.cells.length - nextRows)) {
        this.scrollback.push(this.rowText(old));
      }
      this.scrollback = this.scrollback.slice(-MAX_SCROLLBACK);
    }
    this.cols = nextCols;
    this.rows = nextRows;
    this.cells = next;
    this.row = Math.min(this.row, nextRows - 1);
    this.col = Math.min(this.col, nextCols - 1);
  }

  snapshot(): TerminalSnapshot {
    const cells = this.cells.map((line) => line.slice());
    return {
      cols: this.cols,
      rows: this.rows,
      viewport: cells.map((line) => this.rowText(line)),
      cells,
      scrollback: this.scrollback.slice(),
      cursor: { row: this.row, col: this.col, visible: this.visible },
    };
  }

  private consume(char: string): void {
    if (this.escape === "csi") {
      this.csi += char;
      if (/[A-Za-z@~]/.test(char)) {
        this.applyCsi(this.csi.slice(0, -1), char);
        this.escape = "normal";
        this.csi = "";
      }
      return;
    }
    if (this.escape === "osc") {
      if (char === "\u0007") this.escape = "normal";
      return;
    }
    if (this.escape === "esc") {
      if (char === "[") {
        this.escape = "csi";
        this.csi = "";
        return;
      }
      if (char === "]") {
        this.escape = "osc";
        return;
      }
      if (char === "7") this.savedCursor = { row: this.row, col: this.col };
      else if (char === "8") this.restoreCursor();
      else if (char === "D") this.lineFeed();
      else if (char === "M") this.reverseLineFeed();
      else if (char === "E") { this.col = 0; this.lineFeed(); }
      this.escape = "normal";
      return;
    }
    if (char === "\u001b") {
      this.escape = "esc";
      return;
    }
    switch (char) {
      case "\r": this.col = 0; return;
      case "\n": this.lineFeed(); return;
      case "\b": this.col = Math.max(0, this.col - 1); return;
      case "\t": this.col = Math.min(this.cols - 1, this.col + (8 - (this.col % 8))); return;
      case "\u0007": return;
      default:
        if (char >= " " && char !== "\u007f") this.write(char);
    }
  }

  private write(char: string): void {
    if (this.col >= this.cols) {
      this.col = 0;
      this.lineFeed();
    }
    this.cells[this.row]![this.col] = char;
    this.col += 1;
  }

  private lineFeed(): void {
    if (this.row < this.rows - 1) {
      this.row += 1;
      return;
    }
    const removed = this.cells.shift()!;
    this.scrollback.push(this.rowText(removed));
    this.scrollback = this.scrollback.slice(-MAX_SCROLLBACK);
    this.cells.push(blankRow(this.cols));
  }

  private reverseLineFeed(): void {
    if (this.row > 0) this.row -= 1;
    else this.cells.unshift(blankRow(this.cols));
    if (this.cells.length > this.rows) this.cells.pop();
  }

  private applyCsi(raw: string, final: string): void {
    const privateMode = raw.startsWith("?");
    const params = raw.replace(/^\?/, "").split(";").map((value) => {
      const parsed = Number(value);
      return value === "" || !Number.isFinite(parsed) ? 0 : parsed;
    });
    const first = (fallback: number) => params[0] === 0 ? fallback : params[0]!;
    switch (final) {
      case "A": this.row = Math.max(0, this.row - first(1)); break;
      case "B": this.row = Math.min(this.rows - 1, this.row + first(1)); break;
      case "C": this.col = Math.min(this.cols - 1, this.col + first(1)); break;
      case "D": this.col = Math.max(0, this.col - first(1)); break;
      case "E": this.row = Math.min(this.rows - 1, this.row + first(1)); this.col = 0; break;
      case "F": this.row = Math.max(0, this.row - first(1)); this.col = 0; break;
      case "G": this.col = Math.min(this.cols - 1, Math.max(0, first(1) - 1)); break;
      case "H":
      case "f":
        this.row = Math.min(this.rows - 1, Math.max(0, (params[0] || 1) - 1));
        this.col = Math.min(this.cols - 1, Math.max(0, (params[1] || 1) - 1));
        break;
      case "J": this.clearScreen(first(0)); break;
      case "K": this.clearLine(first(0)); break;
      case "m": break;
      case "s": this.savedCursor = { row: this.row, col: this.col }; break;
      case "u": this.restoreCursor(); break;
      case "h": if (privateMode && params.includes(25)) this.visible = true; break;
      case "l": if (privateMode && params.includes(25)) this.visible = false; break;
      case "S": for (let i = 0; i < first(1); i++) this.lineFeed(); break;
      case "T": for (let i = 0; i < first(1); i++) this.reverseLineFeed(); break;
      default: break;
    }
  }

  private clearScreen(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.cells = Array.from({ length: this.rows }, () => blankRow(this.cols));
      this.row = 0;
      this.col = 0;
      return;
    }
    const start = mode === 1 ? 0 : this.row;
    const end = mode === 1 ? this.row : this.rows - 1;
    for (let row = start; row <= end; row++) {
      const from = row === this.row && mode !== 1 ? this.col : 0;
      const to = row === this.row && mode === 1 ? this.col : this.cols - 1;
      for (let col = from; col <= to; col++) this.cells[row]![col] = " ";
    }
  }

  private clearLine(mode: number): void {
    const from = mode === 1 ? 0 : this.col;
    const to = mode === 1 ? this.col : this.cols - 1;
    for (let col = from; col <= to; col++) this.cells[this.row]![col] = " ";
  }

  private restoreCursor(): void {
    this.row = Math.min(this.rows - 1, this.savedCursor.row);
    this.col = Math.min(this.cols - 1, this.savedCursor.col);
  }

  private rowText(row: string[]): string {
    return row.join("").replace(/\s+$/, "");
  }
}
