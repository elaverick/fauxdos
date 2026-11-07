import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsDisplay, GRAPHICS } from '../src/graphics.js';

test('graphics bitmap, Spectrum-style attributes and current pen', () => {
  const memory = new Uint8Array(65536);
  const gfx = new GraphicsDisplay(memory);
  gfx.colour(12, 1);
  gfx.plot(9, 10);
  const p = 10 * GRAPHICS.WIDTH + 9;
  assert.equal(gfx.bitGet(gfx.bitmap, p), 1);
  const cell = ((10 >> 3) * GRAPHICS.COLS + (9 >> 3)) * 2;
  assert.equal(gfx.attributes[cell], 12);
  assert.equal(gfx.attributes[cell + 1], 1);
});

test('mask-zero pixels preserve the destination during overlap', () => {
  const memory = new Uint8Array(65536);
  const gfx = new GraphicsDisplay(memory);
  gfx.colour(2, 0);
  gfx.plot(4, 4);
  const p = 4 * GRAPHICS.WIDTH + 4;
  gfx.bitSet(gfx.mask, p, 0);
  gfx.colour(14, 3);
  gfx.setMask(true);
  gfx.plot(4, 4);
  assert.equal(gfx.bitGet(gfx.bitmap, p), 1);
  const cell = 0;
  assert.equal(gfx.attributes[cell], 2);
  assert.equal(gfx.attributes[cell + 1], 0);
});

test('memory-mapped graphics commands execute and clear the command register', () => {
  const memory = new Uint8Array(65536);
  const gfx = new GraphicsDisplay(memory);
  memory[GRAPHICS.FG] = 10; memory[GRAPHICS.BG] = 4;
  memory[GRAPHICS.X] = 20; memory[GRAPHICS.Y] = 30; memory[GRAPHICS.COMMAND] = 2;
  gfx.execute();
  assert.equal(memory[GRAPHICS.COMMAND], 0);
  assert.equal(gfx.bitGet(gfx.bitmap, 30 * GRAPHICS.WIDTH + 20), 1);
  assert.equal(gfx.attributes[(3 * GRAPHICS.COLS + 2) * 2], 10);
  assert.equal(gfx.attributes[(3 * GRAPHICS.COLS + 2) * 2 + 1], 4);
});

test('circle primitives and masked packed sprite blit', () => {
  const memory = new Uint8Array(65536);
  const gfx = new GraphicsDisplay(memory);
  gfx.colour(15, 0);
  gfx.circle(20, 20, 3, true);
  assert.equal(gfx.bitGet(gfx.bitmap, 20 * GRAPHICS.WIDTH + 20), 1);
  // 8x1 source: bitmap bit 0 set; opacity bit 0 set, bit 1 clear.
  memory[0x3000] = 0b00000001;
  memory[0x3001] = 0b00000001;
  gfx.blit(40, 40, 0x3000, 8, 1);
  assert.equal(gfx.bitGet(gfx.bitmap, 40 * GRAPHICS.WIDTH + 40), 1);
  assert.equal(gfx.bitGet(gfx.bitmap, 40 * GRAPHICS.WIDTH + 41), 0);
});

test('graphics reset defaults mask to opaque and pen to white on black', () => {
  const memory = new Uint8Array(65536);
  const gfx = new GraphicsDisplay(memory);
  assert.equal(memory[GRAPHICS.FG], 7);
  assert.equal(memory[GRAPHICS.BG], 0);
  assert.equal(gfx.mask.every(value => value === 0xff), true);
  gfx.setMask(true);
  gfx.plot(3, 3);
  assert.equal(gfx.bitGet(gfx.bitmap, 3 * GRAPHICS.WIDTH + 3), 1);
});
