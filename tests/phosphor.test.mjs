import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../src/graphics.js';
import { GREEN_PHOSPHOR_PALETTE, toGreenPhosphor } from '../src/phosphor.js';

test('browser phosphor palette maps RGB colours to green-only luma', () => {
  assert.equal(toGreenPhosphor('#000000'), '#000000');
  assert.equal(toGreenPhosphor('#ffffff'), '#00ff00');
  assert.equal(toGreenPhosphor('#00aa00'), '#007a00');
  assert.equal(toGreenPhosphor('#aa0000'), '#002400');
  assert.equal(toGreenPhosphor('#0000aa'), '#000c00');
  for (const colour of GREEN_PHOSPHOR_PALETTE) {
    assert.match(colour, /^#00[0-9a-f]{2}00$/);
  }
});

test('phosphor mapping leaves the guest colour palette unchanged', () => {
  assert.equal(GREEN_PHOSPHOR_PALETTE.length, 16);
  assert.deepEqual(PALETTE, [
    '#000000', '#0000aa', '#00aa00', '#00aaaa',
    '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
    '#555555', '#5555ff', '#55ff55', '#55ffff',
    '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
  ]);
  assert.notEqual(GREEN_PHOSPHOR_PALETTE[2], PALETTE[2]);
});

test('invalid presentation colours fail explicitly', () => {
  assert.throws(() => toGreenPhosphor('green'), TypeError);
  assert.throws(() => toGreenPhosphor('#fff'), TypeError);
});
