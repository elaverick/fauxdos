/** Convert browser key events into the compact byte values consumed by guest apps. */
export function keyToCode(event) {
  const special = {
    Enter: 0x0d,
    Backspace: 0x08,
    Delete: 0x7f,
    Tab: 0x09,
    Escape: 0x1b,
    ArrowUp: 0x11,
    ArrowDown: 0x12,
    ArrowLeft: 0x13,
    ArrowRight: 0x14,
    F1: 0x15,
  };
  if (Object.hasOwn(special, event.key)) return special[event.key];
  if (typeof event.key === "string" && event.key.length === 1) {
    const code = event.key.charCodeAt(0);
    return code > 0 && code < 256 ? code : 0;
  }
  return 0;
}
