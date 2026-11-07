/** 160x100, 16-colour attribute graphics device. All storage is in guest RAM. */
export const GRAPHICS = Object.freeze({
  WIDTH: 160, HEIGHT: 100, CELL: 8, COLS: 20, ROWS: 13,
  BITMAP: 0x8000, BITMAP_BYTES: 2000,
  ATTRIBUTES: 0x87d0, ATTRIBUTE_BYTES: 520,
  MASK: 0x89d8, MASK_BYTES: 2000,
  FG: 0xd020, BG: 0xd021, COMMAND: 0xd022,
  X: 0xd023, Y: 0xd024, X2: 0xd025, Y2: 0xd026, MASK_MODE: 0xd027,
  MODE: 0xd028,
});

export const PALETTE = ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa", "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"];

export class GraphicsDisplay {
  constructor(memory) { this.memory = memory; this.revision = 0; this.penForeground = 7; this.penBackground = 0; this.maskEnabled = false; this.enabled = false; this.lastCommand = 0; this.reset(); }
  reset() {
    this.penForeground = 7; this.penBackground = 0; this.maskEnabled = false;
    this.enabled = false; this.lastCommand = 0;
    this.bitmap.fill(0);
    this.mask.fill(0xff);
    for (let c = 0; c < GRAPHICS.COLS * GRAPHICS.ROWS; c++) {
      this.attributes[c * 2] = 7; this.attributes[c * 2 + 1] = 0;
    }
    this.memory[GRAPHICS.FG] = 7; this.memory[GRAPHICS.BG] = 0;
    this.memory[GRAPHICS.COMMAND] = 0; this.memory[GRAPHICS.MASK_MODE] = 0;
    this.memory[GRAPHICS.MODE] = 0;
    this.revision++;
  }
  get bitmap() { return this.memory.subarray(GRAPHICS.BITMAP, GRAPHICS.BITMAP + GRAPHICS.BITMAP_BYTES); }
  get attributes() { return this.memory.subarray(GRAPHICS.ATTRIBUTES, GRAPHICS.ATTRIBUTES + GRAPHICS.ATTRIBUTE_BYTES); }
  get mask() { return this.memory.subarray(GRAPHICS.MASK, GRAPHICS.MASK + GRAPHICS.MASK_BYTES); }
  colour(fg, bg) { this.penForeground = fg & 15; this.penBackground = bg & 15; this.memory[GRAPHICS.FG] = this.penForeground; this.memory[GRAPHICS.BG] = this.penBackground; }
  setMask(enabled) { this.maskEnabled = !!enabled; this.memory[GRAPHICS.MASK_MODE] = enabled ? 1 : 0; }
  clear() {
    this.bitmap.fill(0); this.mask.fill(0xff);
    for (let c = 0; c < GRAPHICS.COLS * GRAPHICS.ROWS; c++) { this.attributes[c * 2] = this.penForeground; this.attributes[c * 2 + 1] = this.penBackground; }
    this.enabled = true; this.memory[GRAPHICS.MODE] = 1; this.revision++;
  }
  pixelIndex(x, y) { return y * GRAPHICS.WIDTH + x; }
  bitGet(array, index) { return (array[index >> 3] >> (index & 7)) & 1; }
  bitSet(array, index, value) { const i = index >> 3, b = 1 << (index & 7); array[i] = value ? array[i] | b : array[i] & ~b; }
  putPixel(x, y, bit = 1, { transparent = this.maskEnabled, colour = true } = {}) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= GRAPHICS.WIDTH || y >= GRAPHICS.HEIGHT) return;
    const p = this.pixelIndex(x, y);
    if (transparent && !this.bitGet(this.mask, p)) return;
    const cell = (y >> 3) * GRAPHICS.COLS + (x >> 3);
    if (colour) { this.attributes[cell * 2] = this.penForeground; this.attributes[cell * 2 + 1] = this.penBackground; }
    this.bitSet(this.bitmap, p, bit);
    this.enabled = true; this.memory[GRAPHICS.MODE] = 1;
  }
  plot(x, y, options) { this.putPixel(x, y, 1, options); }
  line(x0, y0, x1, y1, options) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) { this.plot(x0, y0, options); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    this.revision++;
  }
  rect(x0, y0, x1, y1, fill = false, options) {
    let left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    left = Math.max(0, left); right = Math.min(GRAPHICS.WIDTH - 1, right); top = Math.max(0, top); bottom = Math.min(GRAPHICS.HEIGHT - 1, bottom);
    if (fill) for (let y = top; y <= bottom; y++) this.line(left, y, right, y, options);
    else { this.line(left, top, right, top, options); this.line(left, bottom, right, bottom, options); this.line(left, top, left, bottom, options); this.line(right, top, right, bottom, options); }
    this.revision++;
  }
  circle(cx, cy, radius, fill = false, options) {
    radius = Math.max(0, Math.min(255, radius | 0));
    if (fill) {
      for (let y = -radius; y <= radius; y++) { const span = Math.floor(Math.sqrt(radius * radius - y * y)); this.line(cx - span, cy + y, cx + span, cy + y, options); }
    } else {
      let x = radius, y = 0, err = 1 - radius;
      while (x >= y) {
        for (const [px, py] of [[x,y],[y,x],[-y,x],[-x,y],[-x,-y],[-y,-x],[y,-x],[x,-y]]) this.plot(cx + px, cy + py, options);
        y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    }
    this.revision++;
  }
  blit(x, y, ptr, width, height) {
    const rowBytes = Math.ceil(width / 8), bitmapStart = ptr & 0xffff, maskStart = bitmapStart + rowBytes * height;
    for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
      const bit = sx & 7, byte = sy * rowBytes + (sx >> 3);
      const sourceMask = (this.memory[(maskStart + byte) & 0xffff] >> bit) & 1;
      if (!sourceMask) continue;
      const sourcePixel = (this.memory[(bitmapStart + byte) & 0xffff] >> bit) & 1;
      this.putPixel(x + sx, y + sy, sourcePixel, { transparent: this.maskEnabled });
    }
    this.revision++;
  }
  execute() {
    const m = this.memory, cmd = m[GRAPHICS.COMMAND]; if (!cmd) { this.enabled = !!m[GRAPHICS.MODE]; return; }
    this.penForeground = m[GRAPHICS.FG] & 15; this.penBackground = m[GRAPHICS.BG] & 15; this.maskEnabled = !!m[GRAPHICS.MASK_MODE];
    const x = m[GRAPHICS.X], y = m[GRAPHICS.Y], x2 = m[GRAPHICS.X2], y2 = m[GRAPHICS.Y2];
    const opts = { transparent: this.maskEnabled };
    switch (cmd) {
      case 1: this.clear(); break;
      case 2: this.plot(x, y, opts); this.revision++; break;
      case 3: this.line(x, y, x2, y2, opts); break;
      case 4: this.rect(x, y, x2, y2, false, opts); break;
      case 5: this.rect(x, y, x2, y2, true, opts); break;
      case 6: this.setMask(m[GRAPHICS.MASK_MODE]); break;
      case 7: this.circle(x, y, m[0x14], false, opts); break;
      case 8: this.circle(x, y, m[0x14], true, opts); break;
      case 9: this.blit(x, y, m[0x16] | (m[0x17] << 8), m[0x18], m[0x19]); break;
    }
    this.lastCommand = cmd; m[GRAPHICS.COMMAND] = 0; this.enabled = !!m[GRAPHICS.MODE];
  }
  render(context, width, height, presentationPalette = PALETTE) {
    if (!this.enabled) return;
    const image = context.createImageData(GRAPHICS.WIDTH, GRAPHICS.HEIGHT), data = image.data;
    const bits = this.bitmap, attrs = this.attributes;
    for (let y = 0; y < GRAPHICS.HEIGHT; y++) for (let x = 0; x < GRAPHICS.WIDTH; x++) {
      const p = y * GRAPHICS.WIDTH + x, cell = ((y >> 3) * GRAPHICS.COLS + (x >> 3)) * 2;
      const ci = attrs[cell + (this.bitGet(bits, p) ? 0 : 1)] & 15;
      const hex = presentationPalette[ci], q = p * 4;
      data[q] = parseInt(hex.slice(1, 3), 16); data[q + 1] = parseInt(hex.slice(3, 5), 16); data[q + 2] = parseInt(hex.slice(5, 7), 16); data[q + 3] = 255;
    }
    const offscreen = document.createElement('canvas'); offscreen.width = GRAPHICS.WIDTH; offscreen.height = GRAPHICS.HEIGHT;
    offscreen.getContext('2d').putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false; context.drawImage(offscreen, 0, 0, width, height);
  }
}
