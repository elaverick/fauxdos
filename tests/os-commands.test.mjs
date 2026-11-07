import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Fake6502Computer, TextDisplay } from '../src/computer.js';
import { DiskImage, FLAG_DIRECTORY } from '../src/disk.js';

const wasm = new Uint8Array(fs.readFileSync(new URL('../build/fake6502mp.wasm', import.meta.url)));
const rom = new Uint8Array(fs.readFileSync(new URL('../build/rom.bin', import.meta.url)));
const diskBytes = new Uint8Array(fs.readFileSync(new URL('../build/disk.dsk', import.meta.url)));

async function boot() {
  const display = new TextDisplay(80, 25);
  const machine = await Fake6502Computer.create({ wasm, rom, disk: new DiskImage(diskBytes), display });
  machine.runCycles(200000);
  return { machine, display };
}

function screenText(display) {
  return Array.from({ length: display.rows }, (_, y) =>
    Array.from(display.cells.slice(y * display.columns, (y + 1) * display.columns), c => String.fromCharCode(c)).join(''))
    .join('\n');
}

function command(machine, text, cycles = 500000) {
  machine.enqueueText(`${text}\r`);
  machine.runCycles(cycles);
}

test('ROM file-system built-ins create directories, manage nested files and protect non-empty directories', async () => {
  const { machine, display } = await boot();
  command(machine, 'mkdir notes');
  let entry = machine.disk.entries().find(item => item.name === 'NOTES');
  assert.ok(entry);
  assert.equal(entry.flags & FLAG_DIRECTORY, FLAG_DIRECTORY);
  assert.match(screenText(display), /DIRECTORY CREATED/);

  command(machine, 'write notes/ideas.txt 6502 rocks');
  assert.equal(new TextDecoder().decode(machine.disk.readFile('notes/ideas.txt')), '6502 rocks');

  command(machine, 'rmdir notes');
  assert.ok(machine.disk.entries().some(item => item.name === 'NOTES'));
  assert.match(screenText(display), /\? DISK ERROR/);

  command(machine, 'rm notes/ideas.txt');
  assert.equal(machine.disk.readFile('notes/ideas.txt'), null);
  command(machine, 'rmdir notes');
  assert.equal(machine.disk.entries().some(item => item.name === 'NOTES'), false);
  assert.equal(machine.lastDiskError, null);
});

test('DIR marks directory records and CLS clears text and homes the prompt', async () => {
  const { machine, display } = await boot();
  command(machine, 'mkdir work');
  command(machine, 'dir');
  assert.match(screenText(display), /WORK\//);

  command(machine, 'cls');
  assert.equal(display.cursorX, 3);
  assert.equal(display.cursorY, 0);
  const firstRow = Array.from(display.cells.slice(0, display.columns), c => String.fromCharCode(c)).join('').trimEnd();
  assert.equal(firstRow, 'C>');
  assert.equal(display.cells.slice(display.columns).every(c => c === 32), true);
  assert.equal(machine.graphics.enabled, false);
});

test('DEMO runs a moving masked sprite and returns to the ROM prompt on a key', async () => {
  const { machine, display } = await boot();
  assert.equal(machine.graphics.mask.every(value => value === 0xff), true);
  command(machine, 'demo');
  assert.equal(machine.graphics.enabled, true);
  assert.ok(machine.graphics.revision > 0);
  assert.ok(machine.memory[0x30] > 0, 'sprite should have moved from its starting X position');
  assert.ok(machine.graphics.bitmap.some(value => value !== 0), 'demo should draw pixels');

  machine.enqueueKey(27);
  machine.runCycles(250000);
  assert.equal(machine.graphics.enabled, false);
  assert.equal(display.cursorY, 0);
  assert.equal(display.cursorX, 3);
});
