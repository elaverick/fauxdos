import { PALETTE } from "./graphics.js";

// Browser presentation effect only. The guest palette and framebuffer remain
// RGB-capable; this table is used only when composing pixels for the CRT view.
const REC709_LUMA = Object.freeze({ r: 0.2126, g: 0.7152, b: 0.0722 });

export function toGreenPhosphor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new TypeError(`Expected a six-digit RGB colour, received ${String(hex)}`);
  }
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  // Rec.709 luma weighting preserves relative brightness while discarding hue.
  const intensity = Math.max(0, Math.min(255, Math.round(
    r * REC709_LUMA.r + g * REC709_LUMA.g + b * REC709_LUMA.b,
  )));
  return `#00${intensity.toString(16).padStart(2, "0")}00`;
}

// A presentation lookup table. PALETTE itself is deliberately not modified.
export const GREEN_PHOSPHOR_PALETTE = Object.freeze(PALETTE.map(toGreenPhosphor));
