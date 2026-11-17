import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
export const PROTOCOL = 1;
export const MAX_FRAME = 3 * 1024 * 1024;
export function address(directory) {
  const hash = createHash("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\runhuddle-${hash}`
    : path.join(os.tmpdir(), `rh-${process.getuid()}-${hash}.sock`);
}
export function frames(socket, receive) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_FRAME) return socket.destroy();
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        receive(JSON.parse(line));
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}
export function send(socket, value) {
  if (!socket.destroyed) {
    if (socket.writableLength > MAX_FRAME * 2) return socket.destroy();
    socket.write(JSON.stringify(value) + "\n");
  }
}
export function dimensions(cols, rows) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    rows < 2 ||
    cols > 500 ||
    rows > 300
  )
    throw new Error("Invalid terminal dimensions");
}
