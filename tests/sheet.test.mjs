import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Fake6502Computer, TextDisplay } from '../src/computer.js';
import { DiskImage, FLAG_EXECUTABLE } from '../src/disk.js';
import { keyToCode } from '../src/keyboard.js';

const wasm = new Uint8Array(fs.readFileSync(new URL('../build/fake6502mp.wasm', import.meta.url)));
const rom = new Uint8Array(fs.readFileSync(new URL('../build/rom.bin', import.meta.url)));
const diskBytes = new Uint8Array(fs.readFileSync(new URL('../build/disk.dsk', import.meta.url)));

function text(display) {
  return Array.from({ length: display.rows }, (_, y) =>
    Array.from(display.cells.slice(y * display.columns, (y + 1) * display.columns), c => String.fromCharCode(c)).join(''))
    .join('\n');
}

async function launchSheet() {
  const display = new TextDisplay(80, 25);
  const disk = new DiskImage(diskBytes);
  const machine = await Fake6502Computer.create({ wasm, rom, disk, display });
  machine.runCycles(200000);
  machine.enqueueText('SHEET\r');
  machine.runCycles(1200000);
  return { machine, display, disk };
}

test('SHEET is packaged as a disk-resident executable and renders an 8x16 worksheet', async () => {
  const disk = new DiskImage(diskBytes);
  const app = disk.entries().find(entry => entry.name === 'SHEET');
  assert.ok(app, 'SHEET should be present in the starter disk image');
  assert.ok(app.flags & FLAG_EXECUTABLE);

  const { display, machine } = await launchSheet();
  const screen = text(display);
  assert.match(screen, /FAUXSHEET 1\.0/);
  assert.match(screen, /CELL A1\s+fx: PRODUCT/);
  assert.match(screen, /01 \|\[PRODU\]\|QTY\s+\|PRICE/);
  assert.match(screen, /16 \|/);
  assert.match(screen, /ARROWS MOVE.*ESC EXIT/);
  assert.equal(display.cursorY, 24, 'the screen should fit without scrolling the title off the top');
  assert.equal(machine.cpu.getThread(0).state, machine.cpu.threadStates.RUNNING);
});

test('SHEET supports keyboard navigation, cell replacement, deletion and exit', async () => {
  const { machine, display } = await launchSheet();

  machine.enqueueKey('H'.charCodeAt(0));
  machine.enqueueKey('I'.charCodeAt(0));
  machine.runCycles(800000);
  assert.equal(new TextDecoder().decode(machine.memory.slice(0x6000, 0x6007)), 'HI     ');
  assert.match(text(display), /CELL A1\s+fx: HI/);

  machine.enqueueKey(0x14); // Right arrow -> B1.
  machine.enqueueKey('5'.charCodeAt(0));
  machine.runCycles(800000);
  assert.equal(new TextDecoder().decode(machine.memory.slice(0x6007, 0x600e)), '5      ');
  assert.match(text(display), /CELL B1\s+fx: 5/);

  machine.enqueueKey(0x7f); // Delete the selected B1 cell.
  machine.runCycles(500000);
  assert.equal(new TextDecoder().decode(machine.memory.slice(0x6007, 0x600e)), '       ');

  machine.enqueueKey(0x1b); // Escape returns to the DOS shell.
  machine.runCycles(500000);
  assert.match(text(display).split('\n')[0], /^C> /);
  assert.equal(machine.graphics.enabled, false);
});

test('saved disks gain new bundled apps without losing user files', () => {
  const bundled = new DiskImage(diskBytes);
  const saved = new DiskImage(diskBytes);
  saved.removeFile('SHEET');
  saved.writeFile('MYNOTE.TXT', new TextEncoder().encode('keep this file'));

  const installed = saved.installMissingExecutables(bundled);
  assert.ok(installed.includes('SHEET'));
  assert.ok(saved.entries().some(entry => entry.name === 'SHEET' && (entry.flags & FLAG_EXECUTABLE)));
  assert.equal(new TextDecoder().decode(saved.readFile('MYNOTE.TXT')), 'keep this file');
});

test('browser arrow, function, editing and escape keys map to guest control codes', () => {
  assert.equal(keyToCode({ key: 'ArrowUp' }), 0x11);
  assert.equal(keyToCode({ key: 'ArrowDown' }), 0x12);
  assert.equal(keyToCode({ key: 'ArrowLeft' }), 0x13);
  assert.equal(keyToCode({ key: 'ArrowRight' }), 0x14);
  assert.equal(keyToCode({ key: 'F1' }), 0x15);
  assert.equal(keyToCode({ key: 'Tab' }), 0x09);
  assert.equal(keyToCode({ key: 'Delete' }), 0x7f);
  assert.equal(keyToCode({ key: 'Escape' }), 0x1b);
});
