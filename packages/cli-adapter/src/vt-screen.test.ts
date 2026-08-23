import { describe, expect, it } from "vitest";
import { VirtualTerminal } from "./vt-screen.js";

describe("VirtualTerminal", () => {
  it("models cursor-addressed redraws without stale scrollback fragments", () => {
    const terminal = new VirtualTerminal(12, 4);
    terminal.feed("old output\r\nsecond line");
    terminal.feed("\u001b[2J\u001b[H\u001b[?25lDashboard\u001b[3;2Hcount=8");
    const state = terminal.snapshot();

    expect(state.viewport[0]).toBe("Dashboard");
    expect(state.viewport[2]).toBe(" count=8");
    expect(state.viewport.join("\n")).not.toContain("old output");
    expect(state.scrollback).toEqual([]);
    expect(state.cursor).toEqual({ row: 2, col: 8, visible: false });
    expect(state.cells).toHaveLength(4);
    expect(state.cells[0]).toHaveLength(12);
  });

  it("keeps scrollback separate and preserves state across chunk boundaries", () => {
    const terminal = new VirtualTerminal(6, 2);
    terminal.feed("one\r\ntw");
    terminal.feed("o\r\nthree");
    const state = terminal.snapshot();

    expect(state.viewport).toEqual(["two", "three"]);
    expect(state.scrollback).toEqual(["one"]);
  });

  it("supports bounded resize while retaining the current semantic viewport", () => {
    const terminal = new VirtualTerminal(8, 3);
    terminal.feed("hello\u001b[2;1Hworld");
    terminal.resize(12, 4);
    const state = terminal.snapshot();

    expect(state.cols).toBe(12);
    expect(state.rows).toBe(4);
    expect(state.viewport[0]).toBe("hello");
    expect(state.viewport[1]).toBe("world");
  });
});
