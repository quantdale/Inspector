process.stdin.setRawMode?.(true);
process.stdin.resume();

let frame = 1;

function draw() {
  // Cursor-addressed redraw is intentional: the PTY backend must model the
  // viewport rather than append these frames to scrollback.
  process.stdout.write(`\u001b[2J\u001b[H\u001b[?25lInspector TUI fixture\r\nFrame ${frame}\r\nPress n for the next frame or q to quit`);
}

draw();
process.stdin.on("data", (data) => {
  for (const byte of data) {
    if (byte === 0x6e) {
      frame += 1;
      draw();
    } else if (byte === 0x71) {
      process.stdin.setRawMode?.(false);
      process.exit(0);
    }
  }
});
